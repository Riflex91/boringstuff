$ErrorActionPreference = "Stop"

$Target = "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt"

function Resolve-PackageRoot {
    if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "game\main.js"))) {
        return $PSScriptRoot
    }

    $current = (Get-Location).Path
    if (Test-Path (Join-Path $current "game\main.js")) {
        return $current
    }

    $candidate = Get-ChildItem -Path $current -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "game\main.js") } |
        Select-Object -First 1

    if ($candidate) { return $candidate.FullName }

    throw @"
Could not find the bot package root.

Run this installer from the extracted Screeps bot folder, for example:
  cd "$env:USERPROFILE\Desktop\screeps-chatgpt-bot-v0.2.16-node18"
  powershell -ExecutionPolicy Bypass -File .\install.ps1
"@
}

$Here = Resolve-PackageRoot
$GameDir = Join-Path $Here "game"
$ToolsSource = Join-Path $Here "tools"
$ToolsTarget = Join-Path $Target "tools"
$LogsTarget = Join-Path $Target "logs"

Write-Host "Source package: $Here"
Write-Host "Target branch:  $Target"

New-Item -ItemType Directory -Force -Path $Target | Out-Null
New-Item -ItemType Directory -Force -Path $LogsTarget | Out-Null
New-Item -ItemType Directory -Force -Path $ToolsTarget | Out-Null

$gameFiles = Get-ChildItem -Path $GameDir -Filter "*.js" -File
if (-not $gameFiles) { throw "No game JavaScript files found in $GameDir" }
foreach ($file in $gameFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $Target $file.Name) -Force
}

$toolFiles = Get-ChildItem -Path $ToolsSource -File | Where-Object {
    $_.Name -match '\.(mjs|json|ps1)$' -or $_.Name -eq '.gitignore'
}
foreach ($file in $toolFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $ToolsTarget $file.Name) -Force
}

$readme = Join-Path $Here "README.md"
if (Test-Path $readme) { Copy-Item -LiteralPath $readme -Destination (Join-Path $Target "README.md") -Force }

$installedMain = Join-Path $Target "main.js"
$installedPlanner = Join-Path $ToolsTarget "initial-spawn-planner.mjs"
$installedVerifier = Join-Path $ToolsTarget "spawn-verify.mjs"
if (-not (Test-Path $installedMain)) { throw "Installation verification failed: main.js was not copied." }
if (-not (Test-Path $installedPlanner)) { throw "Installation verification failed: initial-spawn-planner.mjs was not copied." }
if (-not (Test-Path $installedVerifier)) { throw "Installation verification failed: spawn-verify.mjs was not copied." }

$installedCount = (Get-ChildItem -Path $Target -Filter "*.js" -File).Count
Write-Host ""
Write-Host "Installation successful." -ForegroundColor Green
Write-Host "Game modules:     $installedCount JavaScript files"
Write-Host "Main module:      $installedMain"
Write-Host "Initial planner:  $installedPlanner"
Write-Host "Spawn verifier:   $installedVerifier"
Write-Host "Logs:             $LogsTarget"
Write-Host "Tools:            $ToolsTarget"
Write-Host ""
Write-Host "Next: cd into tools, run npm install, npm test, npm run doctor"
Write-Host "Then deploy directly with: npm run deploy"
Write-Host "After verification, start the collector with: npm run logs"
