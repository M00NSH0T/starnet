# StockBlitz fork: start the station as a read-only window on the StockBlitz work board.
# Uses a local scratch workspace seeded from the dev fixture, so there is no onboarding and no model key.
# Open http://127.0.0.1:8787 once it prints the banner. The StockBlitz dashboard must be up on :8765.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ws = Join-Path $PSScriptRoot '.stockblitz-workspaces'
if (-not (Test-Path (Join-Path $ws 'agent.save.json'))) {
    New-Item -ItemType Directory -Force $ws | Out-Null
    Copy-Item -Recurse -Force (Join-Path $PSScriptRoot 'dev\fixtures\seed-workspace\*') $ws
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    npm ci --ignore-scripts --no-audit --no-fund
}
$env:STARNET_WORKSPACES = $ws
$env:SKYNET_WORKSPACES = $ws
$env:SKYNET_DEV = '1'
$env:SKYNET_QUEST_REFRESH = '0'
$env:SKYNET_ENV_DISCOVERY = '0'
node sidecar/index.js
