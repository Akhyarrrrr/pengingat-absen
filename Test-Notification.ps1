$ErrorActionPreference = 'Stop'
$testState = Join-Path ([IO.Path]::GetTempPath()) ('simkuliah-notify-test-' + [guid]::NewGuid())
$testProbe = @{ Calls = 0; Fail = $false }
function Import-Clixml {
    param($LiteralPath)
    [pscredential]::new('12345', (ConvertTo-SecureString '12345:test_token' -AsPlainText -Force))
}
function Invoke-RestMethod {
    param($Uri, $Method, $ContentType, $Body, $TimeoutSec)
    $testProbe.Calls++
    if ($testProbe.Fail) { throw 'Simulated network timeout' }
    $payload = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
    if ($payload.chat_id -ne '12345' -or $payload.text -ne 'Tes notifikasi') { throw 'Wrong notification payload' }
    @{ ok = $true; result = @{ message_id = 1; chat = @{ id = 12345 } } }
}

$sender = Join-Path $PSScriptRoot 'Send-Telegram.ps1'
$first = & $sender -EventKey 'test-open' -Text 'Tes notifikasi' -StateDirectory $testState
$duplicate = & $sender -EventKey 'test-open' -Text 'Tes notifikasi' -StateDirectory $testState
if ($first.status -ne 'sent' -or $duplicate.status -ne 'already_attempted' -or $testProbe.Calls -ne 1) {
    throw 'Successful delivery / duplicate suppression failed'
}
$testProbe.Fail = $true
$failed = $false
try { & $sender -EventKey 'test-timeout' -Text 'Tes notifikasi' -StateDirectory $testState } catch { $failed = $true }
$retry = & $sender -EventKey 'test-timeout' -Text 'Tes notifikasi' -StateDirectory $testState
if (-not $failed -or $retry.previous_status -ne 'uncertain' -or $testProbe.Calls -ne 2) {
    throw 'Uncertain delivery must not be reported as sent or retried blindly'
}
$rejected = $false
try { & $sender -EventKey '../escape' -Text 'Tes notifikasi' -StateDirectory $testState } catch { $rejected = $true }
if (-not $rejected) { throw 'Unsafe event key was accepted' }
Write-Output 'PASS: delivery payload, duplicate suppression, uncertain delivery, event-key validation. No network used.'
Write-Output ('Temporary test receipts: ' + $testState)
