param([string]$ChatId = '1147234035')

$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Masukkan token bot Telegram' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($plain -notmatch '^\d+:[A-Za-z0-9_-]+$') { throw 'Format token bot tidak valid.' }
if ($ChatId -notmatch '^-?\d+$') { throw 'Format chat ID tidak valid.' }
$privateDirectory = Join-Path $PSScriptRoot '.private'
$null = New-Item -ItemType Directory -Force -Path $privateDirectory
[pscredential]::new($ChatId, $secure) | Export-Clixml -LiteralPath (Join-Path $privateDirectory 'telegram.xml')
$plain = $null
$secure = $null
Write-Host 'Kredensial Telegram tersimpan terenkripsi untuk akun Windows ini.'
