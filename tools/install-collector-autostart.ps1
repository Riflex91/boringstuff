$ErrorActionPreference = "Stop"

$Startup = [Environment]::GetFolderPath('Startup')
if (-not $Startup) { throw "Could not resolve the current user's Startup folder." }

$Launcher = Join-Path $Startup "Screeps-Newbieland-Telemetry.cmd"
$StartScript = Join-Path $PSScriptRoot "start-collector.ps1"
if (-not (Test-Path -LiteralPath $StartScript)) { throw "Missing collector launcher: $StartScript" }

$Content = @"
@echo off
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$StartScript"
"@
Set-Content -LiteralPath $Launcher -Value $Content -Encoding ASCII

Write-Host "Collector autostart installed." -ForegroundColor Green
Write-Host "Startup launcher: $Launcher"
Write-Host "The collector will start automatically after the next Windows logon."
Write-Host "The collector singleton lock prevents duplicate instances."
