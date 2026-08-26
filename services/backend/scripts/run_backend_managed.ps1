param(
    [int]$HealthIntervalSeconds = 15,
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Continue'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run_backend.ps1'
$logDirectory = Join-Path $backendRoot 'logs'
$logFile = Join-Path $logDirectory 'fastapi-managed.log'

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

Write-ManagedLog 'FastAPI supervisor started.'

while ($true) {
    if (Test-FastApiHealth) {
        Start-Sleep -Seconds $HealthIntervalSeconds
        continue
    }

    Write-ManagedLog 'FastAPI is offline. Starting the backend.'
    try {
        & $runner 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    } catch {
        Write-ManagedLog "Backend launch failed: $($_.Exception.Message)"
    }

    Write-ManagedLog "Backend stopped. Retrying in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds $RestartDelaySeconds
}
