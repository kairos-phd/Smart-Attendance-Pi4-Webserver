# Setup 24/7 Uptime for SIC Smart Attendance AI Server
param(
    [ValidateSet('TaskScheduler', 'NSSM', 'Systemd')]
    [string]$Mode = 'TaskScheduler'
)

$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..')).Path
$python = Join-Path $backendRoot '.venv\Scripts\python.exe'
$managedScript = Join-Path $scriptRoot 'run_backend_managed.ps1'

Write-Host "=== SIC Smart Attendance AI Server - 24/7 Uptime Setup ===" -ForegroundColor Cyan
Write-Host "Mode: $Mode"
Write-Host "Backend Root: $backendRoot"

if ($Mode -eq 'TaskScheduler') {
    $taskName = "SIC_SmartAttendance_AI_Server"
    Write-Host "Registering Windows Scheduled Task: $taskName..." -ForegroundColor Yellow
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$managedScript`"" -WorkingDirectory $backendRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User "$env:COMPUTERNAME\$env:USERNAME" -RunLevel Highest
        Write-Host "Task '$taskName' registered successfully!" -ForegroundColor Green
        Write-Host "The AI Server will now automatically start on Windows boot and run 24/7." -ForegroundColor Green
        Write-Host "To start it immediately: Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Cyan
    } catch {
        Write-Warning "Could not register task with current user: $($_.Exception.Message)"
    }
}
elseif ($Mode -eq 'NSSM') {
    $serviceName = "SmartAttendanceAI"
    Write-Host "Creating Windows Service via NSSM: $serviceName..." -ForegroundColor Yellow
    Write-Host "Run the following commands in an Administrator terminal:" -ForegroundColor Cyan
    Write-Host "  nssm install $serviceName `"$python`" `"-m uvicorn app.main:app --host 0.0.0.0 --port 8000`""
    Write-Host "  nssm set $serviceName AppDirectory `"$backendRoot`""
    Write-Host "  nssm set $serviceName Start SERVICE_AUTO_START"
    Write-Host "  nssm set $serviceName AppStdout `"$backendRoot\logs\service-out.log`""
    Write-Host "  nssm set $serviceName AppStderr `"$backendRoot\logs\service-err.log`""
    Write-Host "  nssm start $serviceName"
}
elseif ($Mode -eq 'Systemd') {
    $serviceFile = @"
[Unit]
Description=SIC Smart Attendance AI Server (FastAPI + InsightFace)
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$backendRoot
ExecStart=$backendRoot/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3s
KillMode=process
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
"@
    $outPath = Join-Path $backendRoot "smart-attendance-ai.service"
    Set-Content -Path $outPath -Value $serviceFile -Encoding utf8
    Write-Host "Generated Linux systemd unit file at: $outPath" -ForegroundColor Green
    Write-Host "To install on Linux/Ubuntu/Debian/Pi:" -ForegroundColor Cyan
    Write-Host "  sudo cp smart-attendance-ai.service /etc/systemd/system/"
    Write-Host "  sudo systemctl daemon-reload"
    Write-Host "  sudo systemctl enable --now smart-attendance-ai"
}
