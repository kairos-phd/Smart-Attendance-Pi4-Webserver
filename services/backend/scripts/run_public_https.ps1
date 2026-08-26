param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $backendRoot '..\..')).Path
$config = Join-Path $projectRoot '.cloudflared\config.yml'

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    if ($health.status -ne 'ok') {
        throw "FastAPI returned status '$($health.status)'."
    }
} catch {
    throw "FastAPI is not healthy on http://127.0.0.1:$Port. Start it with services\backend\scripts\run_backend.ps1 first. $($_.Exception.Message)"
}

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw 'cloudflared is not installed. Install it with: winget install --id Cloudflare.cloudflared --exact'
}
if (-not (Test-Path -LiteralPath $config)) {
    throw "Tunnel configuration was not found: $config"
}

Write-Host "FastAPI is healthy on http://127.0.0.1:$Port."
Write-Host 'Starting api.sic4b.io.vn through Cloudflare Tunnel. Keep this window open.'

# cloudflared writes normal operational logs to stderr. Do not let PowerShell's
# Stop preference misclassify those informational messages as terminating errors.
$ErrorActionPreference = 'Continue'
& $cloudflared tunnel --config $config run sic-fastapi
$cloudflaredExitCode = $LASTEXITCODE
if ($cloudflaredExitCode -ne 0) {
    throw "cloudflared exited with code $cloudflaredExitCode."
}
