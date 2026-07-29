$ErrorActionPreference = "Stop"
$extensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $env:LOCALAPPDATA "BiliSubtitleWhisper"
$configPath = Join-Path $appDir "config.json"
$tokenScriptPath = Join-Path $extensionDir "helper-token.js"
$startupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "BiliSubtitleWhisper.lnk"

if (Test-Path -LiteralPath $configPath) {
  try {
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:17891/v1/shutdown" -Headers @{ "X-Bili-Helper-Token" = $config.token } -TimeoutSec 3 | Out-Null
    Start-Sleep -Seconds 1
  } catch {
    Write-Warning "The helper is not running; local cleanup will continue."
  }
}

if (Test-Path -LiteralPath $startupLink) { Remove-Item -LiteralPath $startupLink -Force }
if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
if (Test-Path -LiteralPath $tokenScriptPath) { Remove-Item -LiteralPath $tokenScriptPath -Force }

Write-Host "The local helper, cache, jobs, and startup shortcut were removed. Reload the extension."
