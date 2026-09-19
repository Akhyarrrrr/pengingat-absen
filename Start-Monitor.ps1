param([Parameter(Mandatory)][ValidateSet('measure-idle', 'measure-active', 'monitor-class', 'monitor-all')][string]$Mode)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$null = New-Item -ItemType Directory -Force -Path $runtime
$log = Join-Path $runtime ("$Mode-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Push-Location $PSScriptRoot
try {
    & node (Join-Path $PSScriptRoot 'monitor.js') $Mode *>&1 | Tee-Object -LiteralPath $log
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
