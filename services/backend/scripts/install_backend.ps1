param([switch]$WithAI)

$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $backendRoot

$venvPython = Join-Path $backendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pyLauncher) {
        throw 'Python 3.11 is required. Install it from python.org, then run this script again.'
    }
    py -3.11 -m venv .venv
}
& '.\.venv\Scripts\python.exe' -m pip install --upgrade pip wheel
& '.\.venv\Scripts\python.exe' -m pip install -e '.'

if ($WithAI) {
    & '.\.venv\Scripts\python.exe' -m pip install -e '.[ai]'
}

Write-Host 'Backend installed. Copy .env.example to .env, configure it, then run scripts\run_backend.ps1.'
if (-not $WithAI) {
    Write-Host 'AI packages were skipped. Rerun this script with -WithAI when you are ready to install them.'
}
