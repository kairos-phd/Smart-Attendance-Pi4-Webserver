param(
    [int]$HealthIntervalSeconds = 15,
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Continue'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run_public_https.ps1'
$logDirectory = Join-Path $backendRoot 'logs'
$logFile = Join-Path $logDirectory 'cloudflare-tunnel-managed.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-ManagedLog {
    param([string]$Message)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message"
}

function Test-LocalFastApi {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 3
        return $health.status -eq 'ok'
    } catch {
        return $false
    }
}

function Test-PublicFastApi {
    try {
        $health = Invoke-RestMethod -Uri 'https://api.sic4b.io.vn/health' -TimeoutSec 8
        return $health.status -eq 'ok'
    } catch {
        return $false
    }
}

Write-ManagedLog 'Cloudflare Tunnel supervisor started.'

while ($true) {
    if (-not (Test-LocalFastApi)) {
        Write-ManagedLog 'Waiting for local FastAPI before starting the tunnel.'
        Start-Sleep -Seconds $RestartDelaySeconds
        continue
    }

    if (Test-PublicFastApi) {
        Start-Sleep -Seconds $HealthIntervalSeconds
        continue
    }

    Write-ManagedLog 'Public API is offline. Starting Cloudflare Tunnel.'
    try {
        & $runner 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    } catch {
        Write-ManagedLog "Tunnel launch failed: $($_.Exception.Message)"
    }

    Write-ManagedLog "Tunnel stopped. Retrying in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds $RestartDelaySeconds
}
