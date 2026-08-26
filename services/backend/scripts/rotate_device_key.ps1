[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environmentFile = [IO.Path]::GetFullPath((Join-Path $backendRoot '.env'))

if (-not $environmentFile.StartsWith($backendRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected environment file path: $environmentFile"
}
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw "Backend environment file was not found: $environmentFile"
}

$bytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $generator.GetBytes($bytes)
}
finally {
    $generator.Dispose()
}
$deviceKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })

$contents = [IO.File]::ReadAllText($environmentFile)
if ($contents -notmatch '(?m)^DEVICE_API_KEY=.*$') {
    throw 'DEVICE_API_KEY is missing from services/backend/.env'
}

$updated = [regex]::Replace(
    $contents,
    '(?m)^DEVICE_API_KEY=.*$',
    "DEVICE_API_KEY=$deviceKey"
)
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($environmentFile, $updated, $utf8WithoutBom)

Write-Output 'DEVICE_API_KEY rotated successfully (64 hexadecimal characters).'
Write-Output 'Restart FastAPI and every authorized capture/Pi service that uses this key.'
