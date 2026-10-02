param(
    [ValidateSet('Debug', 'Release')][string]$BuildType = 'Debug',
    [string]$OutputDirectory = 'work/android-release',
    [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $projectRoot
try {
    if (-not $SkipWebBuild) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Web production build failed.' }
    }
    & npx.cmd cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor Android sync failed.' }

    # APK downloads are distributed separately (for example through Drive),
    # never inside another bundled APK. Firebase Spark blocks APK hosting.
    $bundledDownloads = [IO.Path]::GetFullPath((Join-Path $projectRoot 'android/app/src/main/assets/public/downloads'))
    $bundledRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'android/app/src/main/assets/public'))
    # Browser-only download metadata refers to the finished APK, so it cannot
    # be bundled in the APK itself (its own checksum would be recursive).
    foreach ($webOnlyFile in @('android.html', 'android-release.json')) {
        $webOnlyPath = Join-Path $bundledRoot $webOnlyFile
        if (Test-Path -LiteralPath $webOnlyPath) { Remove-Item -LiteralPath $webOnlyPath }
    }
    if ($bundledDownloads.StartsWith($bundledRoot + [IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $bundledDownloads)) {
        Get-ChildItem -LiteralPath $bundledDownloads -File -Filter '*.apk' -Recurse | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    }

    Push-Location (Join-Path $projectRoot 'android')
    try {
        & .\gradlew.bat ("assemble$BuildType") 'testDebugUnitTest' '--console=plain' '--no-daemon'
        if ($LASTEXITCODE -ne 0) { throw 'Android assembly or native tests failed.' }
    } finally { Pop-Location }

    $variant = $BuildType.ToLowerInvariant()
    $apk = Join-Path $projectRoot "android/app/build/outputs/apk/$variant/app-$variant.apk"
    if (-not (Test-Path -LiteralPath $apk)) { throw "Expected signed APK not found: $apk" }
    $outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
        [IO.Path]::GetFullPath($OutputDirectory)
    } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory)) }
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    $outputApk = Join-Path $outputRoot "IslandWorld-$variant.apk"
    Copy-Item -LiteralPath $apk -Destination $outputApk -Force
    $hashStream = [IO.File]::OpenRead($outputApk)
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-', '').ToLowerInvariant() }
    finally { $hashStream.Dispose(); $hashAlgorithm.Dispose() }
    Set-Content -LiteralPath ($outputApk + '.sha256') -Value "$hash  $([IO.Path]::GetFileName($outputApk))" -Encoding Ascii
    Write-Output "APK: $outputApk"
    Write-Output "SHA256: $hash"
} finally { Pop-Location }
