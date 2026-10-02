param(
    [string]$SigningDirectory = (Join-Path $env:LOCALAPPDATA 'IslandWorld/signing')
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$signingRoot = [IO.Path]::GetFullPath($SigningDirectory)
$keyPath = Join-Path $signingRoot 'islandworld-release.jks'
$propertiesPath = Join-Path $projectRoot 'android/signing.properties'
if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $propertiesPath)) {
    throw 'Signing material already exists. Keep this key for future updates; this script never replaces it.'
}
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
$randomBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
$password = [Convert]::ToBase64String($randomBytes)
$priorKeyPassword = $env:ISLANDWORLD_KEYSTORE_PASSWORD
$env:ISLANDWORLD_KEYSTORE_PASSWORD = $password
$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/keytool.exe' } else { 'keytool.exe' }
try {
    & $keytool -genkeypair -keystore $keyPath -storetype PKCS12 -alias islandworld-release -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=IslandWorld, OU=Game Development, O=IslandWorld' -storepass:env ISLANDWORLD_KEYSTORE_PASSWORD -keypass:env ISLANDWORLD_KEYSTORE_PASSWORD -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
    $javaKeyPath = $keyPath.Replace('\', '/')
    $properties = "storeFile=$javaKeyPath`nstorePassword=$password`nkeyAlias=islandworld-release`nkeyPassword=$password`n"
    [IO.File]::WriteAllText($propertiesPath, $properties, [Text.UTF8Encoding]::new($false))
    # Limit the local key and credential file to the current Windows account.
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $keyPath '/inheritance:r' '/grant:r' "${currentIdentity}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict signing key access.' }
    & icacls.exe $propertiesPath '/inheritance:r' '/grant:r' "${currentIdentity}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict signing properties access.' }
    Write-Output "Signing key created outside Git: $keyPath"
    Write-Output 'Back up the key and android/signing.properties privately. The same key is required for APK updates.'
} finally {
    if ($null -eq $priorKeyPassword) { Remove-Item Env:\ISLANDWORLD_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue }
    else { $env:ISLANDWORLD_KEYSTORE_PASSWORD = $priorKeyPassword }
    $password = $null
    $properties = $null
}
