param(
    [string]$ApkPath = 'work/android-release/IslandWorld-release.apk',
    [string]$DistDirectory = 'dist',
    [string]$SdkDirectory,
    [string]$BuildToolsVersion,
    [string]$ExpectedVersionName = '1.0.0-beta.1',
    [int]$ExpectedVersionCode = 1,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))

function Resolve-ProjectPath([string]$Path) {
    if ([IO.Path]::IsPathRooted($Path)) { return [IO.Path]::GetFullPath($Path) }
    return [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
}

function Get-StreamSha256([IO.Stream]$Stream) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Get-FileSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return Get-StreamSha256 $stream }
    finally { $stream.Dispose() }
}

function Test-BrowserOnlyFile([string]$RelativePath) {
    return ($RelativePath -in @('android.html', 'android-release.json')) `
        -or ($RelativePath -match '^downloads/.*\.apk$')
}

$apk = Resolve-ProjectPath $ApkPath
$dist = Resolve-ProjectPath $DistDirectory
if (-not [IO.File]::Exists($apk)) { throw 'The APK does not exist. Build the release first.' }
if (-not [IO.Directory]::Exists($dist)) { throw 'The production dist directory does not exist.' }

if (-not $SdkDirectory) { $SdkDirectory = $env:ANDROID_SDK_ROOT }
if (-not $SdkDirectory) { $SdkDirectory = $env:ANDROID_HOME }
if (-not $SdkDirectory) {
    $localProperties = Join-Path $projectRoot 'android/local.properties'
    if ([IO.File]::Exists($localProperties)) {
        $sdkLine = [IO.File]::ReadAllLines($localProperties) | Where-Object { $_ -match '^sdk\.dir\s*=' } | Select-Object -First 1
        if ($sdkLine) { $SdkDirectory = ($sdkLine -replace '^sdk\.dir\s*=\s*', '').Replace('\:', ':').Replace('\\', '\') }
    }
}
if (-not $SdkDirectory) { throw 'Set ANDROID_SDK_ROOT/ANDROID_HOME or pass -SdkDirectory.' }
$sdk = Resolve-ProjectPath $SdkDirectory
$toolsRoot = Join-Path $sdk 'build-tools'
if (-not $BuildToolsVersion) {
    $toolsVersions = Get-ChildItem -LiteralPath $toolsRoot -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending
    $selectedTools = $toolsVersions | Select-Object -First 1
    if (-not $selectedTools) { throw 'No Android SDK build tools are installed.' }
    $BuildToolsVersion = $selectedTools.Name
}
$tools = Join-Path $toolsRoot $BuildToolsVersion
$apksigner = Join-Path $tools 'apksigner.bat'
$aapt = Join-Path $tools 'aapt.exe'
if (-not [IO.File]::Exists($apksigner) -or -not [IO.File]::Exists($aapt)) { throw 'The selected SDK build tools lack apksigner/aapt.' }

# Verification needs no signing credentials. Capture SDK output to avoid printing
# unnecessary certificate identities or file paths; report public SHA256 only.
$signatureOutput = (& $apksigner verify --verbose --print-certs $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
if ($signatureOutput -notmatch 'Verified using v2 scheme.*:\s*true') { throw 'APK does not have a verified Android v2 signature.' }
$certificateMatch = [regex]::Match($signatureOutput, 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
if (-not $certificateMatch.Success) { throw 'The APK signing certificate SHA256 could not be read.' }
$certificateHash = $certificateMatch.Groups[1].Value.ToLowerInvariant()

$badging = (& $aapt dump badging $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not read the APK Android manifest.' }
$packageMatch = [regex]::Match($badging, "(?m)^package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'")
if (-not $packageMatch.Success) { throw 'The APK package metadata is missing.' }
if ($packageMatch.Groups[1].Value -ne 'com.islandworld.game') { throw 'The APK package is not IslandWorld.' }
if ([int]$packageMatch.Groups[2].Value -ne $ExpectedVersionCode) { throw 'The APK version code does not match the expected release.' }
if ($packageMatch.Groups[3].Value -ne $ExpectedVersionName) { throw 'The APK version name does not match the expected release.' }
if ($badging -notmatch "(?m)^sdkVersion:'29'" -or $badging -notmatch "(?m)^targetSdkVersion:'36'") { throw 'The APK must have minimum SDK29 and target SDK36.' }
if ($badging -match '(?m)^application-debuggable') { throw 'The APK is debuggable; use the signed release variant.' }
$permissions = @([regex]::Matches($badging, "(?m)^uses-permission(?:-sdk-\d+)?:\s+name='([^']+)'" ) | ForEach-Object { $_.Groups[1].Value })
foreach ($permission in $permissions) {
    if ($permission -eq 'android.permission.CAMERA' -or $permission -match '^android\.permission\.ACCESS_(FINE|COARSE|BACKGROUND)_LOCATION$') {
        throw 'The APK contains an unexpected camera or location permission.'
    }
}
foreach ($requiredPermission in @('android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS')) {
    if ($requiredPermission -notin $permissions) { throw "The APK is missing required permission $requiredPermission." }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
$assetCount = 0
$assetBytes = [long]0
$allowedNativeFiles = @('cordova.js', 'cordova_plugins.js')
$entryNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
try {
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        if (-not $entryNames.Add($name)) { throw 'The APK has duplicate archive entries.' }
        if ($name -match '(^|/)\.\.(/|$)' -or $name.Contains('\')) { throw 'The APK has an invalid archive path.' }
        if ($name -match '\.apk$') { throw 'The APK contains a nested APK.' }
        if ($name -match '(?i)(^|/)(?:\.env(?:\.[^/]*)?|signing\.properties|[^/]*\.(?:jks|keystore|p12|pem|key))$' `
            -or $name -match '(?i)(^|/)node_modules/' `
            -or $name -match '(?i)(^|/)(?:memes?|meme[-_]?audio|local[-_]memes?|local[-_]meme[-_]audio|private[-_]meme[-_]audio)(?:/|$)' `
            -or $name -match '(?i)(^|/)local[^/]*\.(?:mp3|ogg|wav|m4a|aac|flac)$') {
            throw 'The APK contains a private or development-only filename.'
        }
        if ($name.StartsWith('assets/public/', [StringComparison]::Ordinal)) {
            $relative = $name.Substring('assets/public/'.Length)
            if (-not $relative -or $name.EndsWith('/')) { continue }
            if (Test-BrowserOnlyFile $relative) { throw 'The APK contains browser-only download metadata.' }
            $builtFile = Join-Path $dist $relative
            if (-not [IO.File]::Exists($builtFile) -and $relative -notin $allowedNativeFiles) {
                throw "The APK contains an unexpected web asset: $relative"
            }
        }
    }

    foreach ($file in (Get-ChildItem -LiteralPath $dist -File -Recurse)) {
        $relative = $file.FullName.Substring($dist.TrimEnd('\', '/').Length + 1).Replace('\', '/')
        if (Test-BrowserOnlyFile $relative) { continue }
        $entry = $zip.GetEntry('assets/public/' + $relative)
        if ($null -eq $entry) { throw "The APK is missing a production web asset: $relative" }
        if ($entry.Length -ne $file.Length) { throw "The APK web asset size differs from dist: $relative" }
        $assetStream = $entry.Open()
        try { $assetHash = Get-StreamSha256 $assetStream }
        finally { $assetStream.Dispose() }
        if ($assetHash -ne (Get-FileSha256 $file.FullName)) { throw "The APK web asset bytes differ from dist: $relative" }
        $assetCount++
        $assetBytes += $file.Length
    }
    if (-not $entryNames.Contains('AndroidManifest.xml')) { throw 'The binary AndroidManifest.xml is missing.' }
    if (-not $entryNames.Contains('assets/capacitor.config.json')) { throw 'The native Capacitor configuration is missing.' }
    $configStream = $zip.GetEntry('assets/capacitor.config.json').Open()
    $reader = [IO.StreamReader]::new($configStream)
    try { $config = $reader.ReadToEnd() | ConvertFrom-Json }
    finally { $reader.Dispose() }
    if ($config.appId -ne 'com.islandworld.game' -or $config.webDir -ne 'dist' `
        -or $config.server.hostname -ne 'localhost' -or $config.server.androidScheme -ne 'https' `
        -or $config.server.cleartext -ne $false -or $config.android.allowMixedContent -ne $false `
        -or $config.android.captureInput -ne $false `
        -or $config.android.webContentsDebuggingEnabled -ne $false) {
        throw 'The APK native configuration is not the secure bundled release.'
    }
    if ($config.server.PSObject.Properties.Name -contains 'url') { throw 'The APK loads a remote web URL instead of the bundled world.' }
} finally { $zip.Dispose() }

$apkHash = Get-FileSha256 $apk
$size = [IO.FileInfo]::new($apk).Length
$report = [ordered]@{
    package = 'com.islandworld.game'
    versionName = $ExpectedVersionName
    versionCode = $ExpectedVersionCode
    minimumSdk = 29
    targetSdk = 36
    releaseDebuggable = $false
    signatureVerified = $true
    signerCertificateSha256 = $certificateHash
    apkSha256 = $apkHash
    apkSizeBytes = $size
    verifiedWebAssets = $assetCount
    verifiedWebAssetBytes = $assetBytes
    permissions = $permissions
    browserOnlyMetadataExcluded = $true
    nativeKeyboardInputPreserved = $true
    nestedApksAndPrivateFilesExcluded = $true
    buildTools = $BuildToolsVersion
}
$json = $report | ConvertTo-Json -Depth 4
if ($ReportPath) {
    $reportFile = Resolve-ProjectPath $ReportPath
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reportFile)) | Out-Null
    [IO.File]::WriteAllText($reportFile, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
[IO.File]::WriteAllText($apk + '.sha256', "$apkHash  $([IO.Path]::GetFileName($apk))" + [Environment]::NewLine, [Text.Encoding]::ASCII)
Write-Output $json
