#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'

$ethernet = Get-NetIPConfiguration |
    Where-Object {
        $_.IPv4DefaultGateway -ne $null -and
        $_.InterfaceAlias -notmatch 'Radmin|VPN|Virtual'
    } |
    Select-Object -First 1

if ($null -eq $ethernet) {
    throw 'No physical network adapter with an IPv4 gateway was found.'
}

Set-NetIPInterface `
    -InterfaceIndex $ethernet.InterfaceIndex `
    -AddressFamily IPv4 `
    -AutomaticMetric Disabled `
    -InterfaceMetric 10

Set-DnsClientServerAddress `
    -InterfaceIndex $ethernet.InterfaceIndex `
    -ServerAddresses @('1.1.1.1', '1.0.0.1')

$radminAdapters = Get-NetAdapter |
    Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -match 'Radmin' }

foreach ($adapter in $radminAdapters) {
    Set-NetIPInterface `
        -InterfaceIndex $adapter.InterfaceIndex `
        -AddressFamily IPv4 `
        -AutomaticMetric Disabled `
        -InterfaceMetric 50
}

Clear-DnsClientCache
Start-Sleep -Seconds 2

$addresses = [System.Net.Dns]::GetHostAddresses('api.sic4b.io.vn')
$health = Invoke-RestMethod -Uri 'https://api.sic4b.io.vn/health' -TimeoutSec 20

Write-Host "Primary adapter: $($ethernet.InterfaceAlias)"
Write-Host "Resolved addresses: $($addresses.IPAddressToString -join ', ')"
Write-Host "Public FastAPI: $($health.status)"
