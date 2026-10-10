param([switch]$RunGateway)
$ErrorActionPreference = 'Stop'
function Assert-Native([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed ($LASTEXITCODE). Existing release retained." }
}
function Set-EnvValue([string]$File, [string]$Name, [string]$Value) {
    $lines = @(Get-Content -LiteralPath $File | Where-Object { $_ -notmatch "^\s*$Name\s*=" })
    $lines += "$Name=$Value"
    [IO.File]::WriteAllLines($File, $lines, [Text.UTF8Encoding]::new($false))
}
$pointer = Join-Path $env:LOCALAPPDATA 'SIC-media-current.txt'
$previous = (Get-Content -LiteralPath $pointer -Raw).Trim()
if (-not (Test-Path "$previous\services\backend\.env.media")) { throw 'Existing gateway configuration missing.' }
if (-not (Test-Path "$previous\apps\web\.env")) { throw 'Existing website Firebase configuration missing.' }
$release = Join-Path $env:LOCALAPPDATA ("SIC-media-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$archive = Join-Path $env:TEMP ("sic-dashboard-" + [guid]::NewGuid() + '.zip')
Push-Location F:\SICWEB
try {
    git fetch --refmap= origin main
    Assert-Native 'Fetch'
    git archive --format=zip --output=$archive FETCH_HEAD
    Assert-Native 'Archive'
} finally { Pop-Location }
Expand-Archive -LiteralPath $archive -DestinationPath $release
Remove-Item -LiteralPath $archive
Copy-Item -LiteralPath "$previous\apps\web\.env" -Destination "$release\apps\web\.env"
Copy-Item -LiteralPath "$previous\services\backend\.env.media" -Destination "$release\services\backend\.env.media"
if (Test-Path "$previous\cloudflared.yml") { Copy-Item "$previous\cloudflared.yml" "$release\cloudflared.yml" }
Set-EnvValue "$release\apps\web\.env" 'VITE_DATA_SOURCE' 'pi'
Set-EnvValue "$release\apps\web\.env" 'VITE_PI_API_BASE_URL' 'https://sic4b.io.vn'
Set-EnvValue "$release\apps\web\.env" 'VITE_API_BASE_URL' 'https://sic4b.io.vn/attendance-api'
Set-EnvValue "$release\apps\web\.env" 'VITE_FIREBASE_DATABASE_URL' 'https://sicccc-30fed-default-rtdb.asia-southeast1.firebasedatabase.app'
Set-EnvValue "$release\services\backend\.env.media" 'WEB_STATIC_DIR' "$release\apps\web\web-build"
Push-Location "$release\apps\web"
try {
    npm ci
    Assert-Native 'Install web dependencies'
    npm run build
    Assert-Native 'Build website'
} finally { Pop-Location }
$python = Join-Path $previous '.venv-media\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Existing gateway Python environment missing; previous release retained.' }
& $python -m venv "$release\.venv-media"
Assert-Native 'Create gateway environment'
& "$release\.venv-media\Scripts\python.exe" -m pip install -r "$release\services\backend\requirements-media.txt"
Assert-Native 'Install gateway dependencies'
[IO.File]::WriteAllText($pointer, $release, [Text.UTF8Encoding]::new($false))
Write-Host "New release: $release"
Write-Host "Previous release (rollback): $previous"
Write-Host 'Keep the SSH forward and Cloudflare Tunnel running. Stop only the old gateway with Ctrl+C.'
if ($RunGateway) {
    $env:GATEWAY_ENV_FILE = "$release\services\backend\.env.media"
    Push-Location "$release\services\backend"
    try { & "$release\.venv-media\Scripts\python.exe" -m uvicorn app.pi_gateway:create_app --factory --host 127.0.0.1 --port 8081 }
    finally { Pop-Location }
}
