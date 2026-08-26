$ErrorActionPreference = 'Stop'

$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backendSupervisor = Join-Path $PSScriptRoot 'run_backend_managed.ps1'
$tunnelSupervisor = Join-Path $PSScriptRoot 'run_tunnel_managed.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$currentUser = "$env:USERDOMAIN\$env:USERNAME"

$tasks = @(
    @{
        Name = 'SIC FastAPI'
        Description = 'Starts and monitors the SIC FastAPI backend after Windows sign-in.'
        Script = $backendSupervisor
    },
    @{
        Name = 'SIC Cloudflare Tunnel'
        Description = 'Starts and monitors the HTTPS tunnel for api.sic4b.io.vn after Windows sign-in.'
        Script = $tunnelSupervisor
    }
)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 20 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

foreach ($task in $tasks) {
    if (-not (Test-Path -LiteralPath $task.Script)) {
        throw "Startup script not found: $($task.Script)"
    }

    $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$($task.Script)`""
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $backendRoot

    Register-ScheduledTask `
        -TaskName $task.Name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $task.Description `
        -Force | Out-Null

    Start-ScheduledTask -TaskName $task.Name
    Write-Host "Installed and started: $($task.Name)"
}

Write-Host ''
Write-Host 'Automatic startup is configured for the current Windows account.'
Write-Host "Logs: $backendRoot\logs"
Write-Host 'Use scripts\check_windows_autostart.ps1 to verify both services.'
