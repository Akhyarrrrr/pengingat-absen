param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9._-]{1,120}$')][string]$EventKey,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Text,
    [string]$StateDirectory
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($StateDirectory)) {
    $StateDirectory = Join-Path $PSScriptRoot 'runtime'
}
if ($Text.Length -gt 4096) { throw 'Telegram message exceeds 4096 characters.' }
$null = New-Item -ItemType Directory -Force -Path $StateDirectory
$lock = $null
try {
    # ponytail: one local sender lock; use shared storage if moved to multiple hosts.
    $lock = [IO.File]::Open((Join-Path $StateDirectory 'telegram.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $receiptPath = Join-Path $StateDirectory ($EventKey + '.json')
    if (Test-Path -LiteralPath $receiptPath) {
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        [pscustomobject]@{ status = 'already_attempted'; previous_status = $receipt.status; event = $EventKey }
        return
    }

    $credential = Import-Clixml -LiteralPath (Join-Path $PSScriptRoot '.private/telegram.xml')
    $token = $credential.GetNetworkCredential().Password
    $chatId = $credential.UserName
    if ($token -notmatch '^\d+:[A-Za-z0-9_-]+$' -or $chatId -notmatch '^\d+$') {
        throw 'Invalid local Telegram credential.'
    }
    $receipt = [ordered]@{ event = $EventKey; status = 'uncertain'; attempted_at = [DateTimeOffset]::UtcNow.ToString('o') }
    # Write before sending: a timeout may still mean delivery. Never blindly resend.
    $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
    try {
        $body = @{ chat_id = $chatId; text = $Text; parse_mode = 'HTML'; disable_web_page_preview = $true } | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri ('https://api.telegram.org/bot' + $token + '/sendMessage') -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20
        if (-not $response.ok -or -not $response.result.message_id -or [string]$response.result.chat.id -ne $chatId) {
            throw 'Telegram did not confirm delivery to the configured chat.'
        }
        $receipt.status = 'sent'
        $receipt.message_id = $response.result.message_id
        $receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
        [pscustomobject]@{ status = 'sent'; event = $EventKey; message_id = $response.result.message_id }
    } catch {
        # Suppress request URLs because Telegram places the secret in the URL.
        throw 'Telegram delivery was not confirmed. Receipt is uncertain; check Telegram before any manual retry.'
    }
} finally {
    $token = $null
    if ($lock) { $lock.Dispose() }
}
