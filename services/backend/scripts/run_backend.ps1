param(
    [switch]$Reload,
    [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $backendRoot

$python = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Backend environment is missing. Run scripts\install_backend.ps1 first.'
}

try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
    Write-Host "FastAPI is already running on http://localhost:8000 (status: $($health.status))."
    Write-Host 'Do not start a second copy. Stop the existing backend before restarting it after configuration changes.'
    exit 0
} catch {
    # No existing SIC health endpoint responded, so starting the service is safe.
}

$listenHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$arguments = @('-m', 'uvicorn', 'app.main:app', '--host', $listenHost, '--port', '8000')
if ($Reload) { $arguments += '--reload' }
if ($Lan) {
    Write-Host 'FastAPI LAN mode enabled. Access is controlled by the Windows firewall rule for TCP port 8000.'
}

# Uvicorn writes normal startup and access logs to stderr. PowerShell 5 can
# convert those lines into error records, so do not treat them as fatal unless
# the process itself exits with a non-zero code.
$ErrorActionPreference = 'Continue'
& $python @arguments
$backendExitCode = $LASTEXITCODE
if ($backendExitCode -ne 0) {
    throw "FastAPI exited with code $backendExitCode."
}
