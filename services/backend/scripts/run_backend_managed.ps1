param(
    [int]$HealthIntervalSeconds = 15,
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Continue'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $backendRoot '..\..')).Path
$logDirectory = Join-Path $backendRoot 'logs'
$logFile = Join-Path $logDirectory 'fastapi-managed.log'
$python = Join-Path $backendRoot '.venv\Scripts\python.exe'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$tunnelConfig = Join-Path $projectRoot '.cloudflared\config.yml'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-ManagedLog {
    param([string]$Message)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message"
}

function Test-FastApiHealth {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 3
        return $health.status -eq 'ok'
    } catch {
        return $false
    }
}

function Test-CloudflaredRunning {
    $procs = Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue
    return ($procs -ne $null -and $procs.Count -gt 0)
}

function Start-FastApiProcess {
    Write-ManagedLog 'Starting FastAPI process (uvicorn)...'
    $args = @('-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000')
    Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $backendRoot -WindowStyle Hidden
}

function Start-CloudflaredProcess {
    if ((Test-Path -LiteralPath $cloudflared) -and (Test-Path -LiteralPath $tunnelConfig)) {
        Write-ManagedLog 'Starting Cloudflare Tunnel (sic-fastapi)...'
        $args = @('tunnel', '--config', $tunnelConfig, 'run', 'sic-fastapi')
        Start-Process -FilePath $cloudflared -ArgumentList $args -WorkingDirectory $projectRoot -WindowStyle Hidden
    }
}

Write-ManagedLog 'FastAPI & Cloudflare Tunnel 24/7 supervisor started.'

while ($true) {
    if (-not (Test-FastApiHealth)) {
        Write-ManagedLog 'FastAPI is offline or unresponsive. Initiating launch...'
        Start-FastApiProcess
        Start-Sleep -Seconds $RestartDelaySeconds
    }

    if (-not (Test-CloudflaredRunning)) {
        Write-ManagedLog 'Cloudflare Tunnel is not running. Starting tunnel...'
        Start-CloudflaredProcess
        Start-Sleep -Seconds 3
    }

    Start-Sleep -Seconds $HealthIntervalSeconds
}
