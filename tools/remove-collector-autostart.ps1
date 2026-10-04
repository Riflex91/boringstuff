$ErrorActionPreference = "Stop"
$Startup = [Environment]::GetFolderPath('Startup')
$Launcher = Join-Path $Startup "Screeps-Newbieland-Telemetry.cmd"
if (Test-Path -LiteralPath $Launcher) {
    Remove-Item -LiteralPath $Launcher -Force
    Write-Host "Collector autostart removed." -ForegroundColor Green
} else {
    Write-Host "Collector autostart was not installed: $Launcher"
}
