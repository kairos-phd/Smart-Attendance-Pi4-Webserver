$ErrorActionPreference = 'Continue'

$taskNames = @('SIC FastAPI', 'SIC Cloudflare Tunnel')

Write-Host 'Scheduled tasks:'
foreach ($taskName in $taskNames) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Host "- ${taskName}: not installed"
        continue
    }
    Write-Host "- ${taskName}: $($task.State), last result $($info.LastTaskResult)"
}

Write-Host ''
Write-Host 'Health endpoints:'
try {
    $local = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 5
    Write-Host "- Local FastAPI: $($local.status)"
} catch {
    Write-Host "- Local FastAPI: offline ($($_.Exception.Message))"
}

try {
    $public = Invoke-RestMethod -Uri 'https://api.sic4b.io.vn/health' -TimeoutSec 10
    Write-Host "- Public FastAPI: $($public.status)"
} catch {
    Write-Host "- Public FastAPI: offline ($($_.Exception.Message))"
}
