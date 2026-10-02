param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._:-]+$')][string]$DeviceSerial,
    [string]$ApkPath = 'work/android-release/IslandWorld-release.apk',
    [string]$SdkDirectory,
    [string]$BuildToolsVersion,
    [ValidatePattern('^$|^[A-Za-z0-9]{6}$')][string]$JoinCode = '',
    [string]$ReportDirectory = 'work/android-release/signed-device-test',
    [switch]$SkipTestBuild
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
function Resolve-ProjectPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Invoke-CapturedTool([string]$Tool, [string[]]$Arguments) {
    $priorPreference = $ErrorActionPreference
    try {
        # Windows PowerShell treats redirected native stderr as ErrorRecords.
        # Capture diagnostics and inspect the real exit code even on that host.
        $ErrorActionPreference = 'Continue'
        $output = (& $Tool @Arguments 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $priorPreference }
    return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
}

if (-not $SdkDirectory) { $SdkDirectory = $env:ANDROID_SDK_ROOT }
if (-not $SdkDirectory) { $SdkDirectory = $env:ANDROID_HOME }
if (-not $SdkDirectory) {
    $propertiesFile = Join-Path $projectRoot 'android/local.properties'
    if ([IO.File]::Exists($propertiesFile)) {
        $sdkLine = [IO.File]::ReadAllLines($propertiesFile) | Where-Object { $_ -match '^sdk\.dir\s*=' } | Select-Object -First 1
        if ($sdkLine) { $SdkDirectory = ($sdkLine -replace '^sdk\.dir\s*=\s*', '').Replace('\:', ':').Replace('\\', '\') }
    }
}
if (-not $SdkDirectory) { throw 'Set ANDROID_SDK_ROOT/ANDROID_HOME or pass -SdkDirectory.' }
$sdk = Resolve-ProjectPath $SdkDirectory
$adb = Join-Path $sdk 'platform-tools/adb.exe'
if (-not [IO.File]::Exists($adb)) { throw 'Android SDK platform tools are missing.' }
$deviceState = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'get-state')
if ($deviceState.ExitCode -ne 0 -or $deviceState.Output -notmatch '(?m)^device\s*$') {
    throw 'The selected Android device is not connected and authorized for ADB.'
}

$apk = Resolve-ProjectPath $ApkPath
$reports = Resolve-ProjectPath $ReportDirectory
[IO.Directory]::CreateDirectory($reports) | Out-Null
if (-not $BuildToolsVersion) {
    $selectedTools = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory `
        | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } `
        | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $selectedTools) { throw 'Android SDK build tools are missing.' }
    $BuildToolsVersion = $selectedTools.Name
}
$apksigner = Join-Path $sdk "build-tools/$BuildToolsVersion/apksigner.bat"
$aapt = Join-Path $sdk "build-tools/$BuildToolsVersion/aapt.exe"

# Validate the actual production APK before installing any package. This also
# confirms that its payload matches the production website being distributed.
$verifyScript = Join-Path $PSScriptRoot 'verify-apk.ps1'
$verifiedJson = & $verifyScript -ApkPath $apk -SdkDirectory $sdk -BuildToolsVersion $BuildToolsVersion `
    -ReportPath (Join-Path $reports 'release-apk-verification.json')
$verified = ($verifiedJson -join [Environment]::NewLine) | ConvertFrom-Json
if (-not $verified.signatureVerified -or $verified.releaseDebuggable) {
    throw 'Device tests require the signed, non-debuggable release APK.'
}

if (-not $SkipTestBuild) {
    Push-Location (Join-Path $projectRoot 'android')
    try {
        & .\gradlew.bat ':app:assembleDebugAndroidTest' '--console=plain' '--no-daemon'
        if ($LASTEXITCODE -ne 0) { throw 'Android instrumentation APK build failed.' }
    } finally { Pop-Location }
}
$testSource = Join-Path $projectRoot 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
if (-not [IO.File]::Exists($testSource)) { throw 'The instrumentation APK does not exist.' }
$testSigned = Join-Path $reports 'IslandWorld-release-instrumentation.apk'
$testBadging = Invoke-CapturedTool $aapt @('dump', 'badging', $testSource)
if ($testBadging.ExitCode -ne 0 -or $testBadging.Output -notmatch "(?m)^package:\s+name='com\.islandworld\.game\.test'") {
    throw 'The instrumentation APK package is not the IslandWorld test package.'
}

# Re-sign only a copy of the test APK. The app's debug signing configuration and
# production APK are never modified. Credentials are never command-line values.
$signing = @{}
$signingFile = Join-Path $projectRoot 'android/signing.properties'
if ([IO.File]::Exists($signingFile)) {
    foreach ($line in [IO.File]::ReadAllLines($signingFile)) {
        if ($line.TrimStart().StartsWith('#') -or $line.TrimStart().StartsWith('!')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -gt 0) { $signing[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim() }
    }
}
$keyFile = if ($signing.ContainsKey('storeFile')) { $signing['storeFile'].Replace('\:', ':').Replace('\\', '\') } else { $env:ISLANDWORLD_KEYSTORE_FILE }
$keyAlias = if ($signing.ContainsKey('keyAlias')) { $signing['keyAlias'] } else { $env:ISLANDWORLD_KEY_ALIAS }
$storePassword = if ($signing.ContainsKey('storePassword')) { $signing['storePassword'] } else { $env:ISLANDWORLD_KEYSTORE_PASSWORD }
$keyPassword = if ($signing.ContainsKey('keyPassword')) { $signing['keyPassword'] } else { $env:ISLANDWORLD_KEY_PASSWORD }
if (-not $keyFile -or -not $keyAlias -or -not $storePassword -or -not $keyPassword) {
    throw 'Release signing credentials are required to authorize tests against the production APK.'
}
if (-not [IO.Path]::IsPathRooted($keyFile)) { $keyFile = [IO.Path]::GetFullPath((Join-Path $projectRoot "android/app/$keyFile")) }
if (-not [IO.File]::Exists($keyFile)) { throw 'The configured release signing key does not exist.' }
$previousStorePassword = $env:ISLANDWORLD_TEST_STORE_PASSWORD
$previousKeyPassword = $env:ISLANDWORLD_TEST_KEY_PASSWORD
try {
    $env:ISLANDWORLD_TEST_STORE_PASSWORD = $storePassword
    $env:ISLANDWORLD_TEST_KEY_PASSWORD = $keyPassword
    $signResult = Invoke-CapturedTool $apksigner @('sign', '--ks', $keyFile, '--ks-key-alias', $keyAlias,
        '--ks-pass', 'env:ISLANDWORLD_TEST_STORE_PASSWORD', '--key-pass', 'env:ISLANDWORLD_TEST_KEY_PASSWORD',
        '--out', $testSigned, $testSource)
    if ($signResult.ExitCode -ne 0) { throw 'Signing the isolated instrumentation APK failed.' }
} finally {
    if ($null -eq $previousStorePassword) { Remove-Item Env:\ISLANDWORLD_TEST_STORE_PASSWORD -ErrorAction SilentlyContinue }
    else { $env:ISLANDWORLD_TEST_STORE_PASSWORD = $previousStorePassword }
    if ($null -eq $previousKeyPassword) { Remove-Item Env:\ISLANDWORLD_TEST_KEY_PASSWORD -ErrorAction SilentlyContinue }
    else { $env:ISLANDWORLD_TEST_KEY_PASSWORD = $previousKeyPassword }
    $storePassword = $null
    $keyPassword = $null
    $signing.Clear()
}
$testSignature = Invoke-CapturedTool $apksigner @('verify', '--verbose', '--print-certs', $testSigned)
if ($testSignature.ExitCode -ne 0) { throw 'Instrumentation APK signature verification failed.' }
$testCertificate = [regex]::Match($testSignature.Output, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
if (-not $testCertificate.Success -or $testCertificate.Groups[1].Value.ToLowerInvariant() -ne $verified.signerCertificateSha256) {
    throw 'The instrumentation signer does not match the production APK signer.'
}

$testInstalled = $false
$instrumentationStarted = $false
$passed = $false
$startedAt = [DateTime]::UtcNow
try {
    $installResult = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'install', '-r', $apk)
    if ($installResult.ExitCode -ne 0 -or $installResult.Output -notmatch '(?m)^Success\s*$') {
        throw 'Production APK installation failed. An existing development copy may need to be removed explicitly; this script never uninstalls the game.'
    }
    # The .test package contains this project's disposable instrumentation only.
    $existingTest = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'shell', 'pm', 'path', 'com.islandworld.game.test')
    if ($existingTest.Output -match '(?m)^package:') {
        $removeOldTest = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'uninstall', 'com.islandworld.game.test')
        if ($removeOldTest.ExitCode -ne 0) { throw 'Could not replace the disposable IslandWorld test package.' }
    }
    $testInstallResult = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'install', '-r', '-t', $testSigned)
    if ($testInstallResult.ExitCode -ne 0 -or $testInstallResult.Output -notmatch '(?m)^Success\s*$') { throw 'Instrumentation APK installation failed.' }
    $testInstalled = $true

    $instrumentArguments = @('-s', $DeviceSerial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
        'com.islandworld.game.IslandWorldSmokeTest')
    if ($JoinCode) { $instrumentArguments += @('-e', 'joinCode', $JoinCode.ToUpperInvariant()) }
    $instrumentArguments += 'com.islandworld.game.test/androidx.test.runner.AndroidJUnitRunner'
    $instrumentationStarted = $true
    $instrumentResult = Invoke-CapturedTool $adb $instrumentArguments
    $instrumentOutput = $instrumentResult.Output
    $instrumentExit = $instrumentResult.ExitCode
    [IO.File]::WriteAllText((Join-Path $reports 'instrumentation-results.txt'), $instrumentOutput, [Text.UTF8Encoding]::new($false))
    Write-Output $instrumentOutput
    $passed = $instrumentExit -eq 0 -and $instrumentOutput -match '(?m)^OK\s*\(2 tests\)\s*$' `
        -and $instrumentOutput -notmatch '(?m)^FAILURES!!!|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED'
    if (-not $passed) { throw 'The signed release device smoke tests did not pass both tests. See the saved instrumentation results.' }
} finally {
    if ($instrumentationStarted) {
        $screenshotDirectory = Join-Path $reports 'device-artifacts'
        [IO.Directory]::CreateDirectory($screenshotDirectory) | Out-Null
        $pullResult = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'pull', '/sdcard/Android/data/com.islandworld.game/files/instrumentation/.', $screenshotDirectory)
        if ($pullResult.ExitCode -ne 0) { Write-Warning 'Could not pull all device screenshots/reports; instrumentation results remain saved.' }
    }
    if ($testInstalled) {
        $removeTest = Invoke-CapturedTool $adb @('-s', $DeviceSerial, 'uninstall', 'com.islandworld.game.test')
        if ($removeTest.ExitCode -ne 0) { Write-Warning 'The disposable test package could not be removed.' }
    }
    $deviceReport = [ordered]@{
        deviceSerial = $DeviceSerial
        targetPackage = 'com.islandworld.game'
        productionApkSha256 = $verified.apkSha256
        signerCertificateSha256 = $verified.signerCertificateSha256
        productionReleaseDebuggable = $false
        testSignerMatchesProduction = $true
        expectedTests = 2
        testsPassed = $passed
        sharedBrowserRoomRequested = [bool]$JoinCode
        productionGameUninstalled = $false
        startedUtc = $startedAt.ToString('o')
        finishedUtc = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText((Join-Path $reports 'signed-device-verification.json'), ($deviceReport | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
}
Write-Output 'Two signed-release Android smoke tests passed. Test package removed; the production game remains installed.'
