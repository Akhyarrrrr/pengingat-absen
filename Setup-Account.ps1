param([Parameter(Mandatory)][string]$Account)

$ErrorActionPreference = 'Stop'
$privateDirectory = Join-Path $PSScriptRoot '.private'
$null = New-Item -ItemType Directory -Force -Path $privateDirectory
$password = Read-Host 'Masukkan password akun absensi' -AsSecureString
$credential = [PSCredential]::new($Account, $password)
$credential | Export-Clixml -LiteralPath (Join-Path $privateDirectory 'simkuliah.xml')
$password = $null
$credential = $null
Write-Host 'Kredensial tersimpan terenkripsi untuk akun Windows ini.'
