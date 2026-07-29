param(
  [string]$PythonExe = "",
  [switch]$SkipModelDownload
)

$ErrorActionPreference = "Stop"
$extensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir = Join-Path $extensionDir "helper"
$appDir = Join-Path $env:LOCALAPPDATA "BiliSubtitleWhisper"
$runtimeDir = Join-Path $appDir "runtime"
$venvDir = Join-Path $appDir "venv"
$configPath = Join-Path $appDir "config.json"
$tokenScriptPath = Join-Path $extensionDir "helper-token.js"
$startupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "BiliSubtitleWhisper.lnk"

if (Test-Path -LiteralPath $configPath) {
  try {
    $oldConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:17891/v1/shutdown" -Headers @{ "X-Bili-Helper-Token" = $oldConfig.token } -TimeoutSec 3 | Out-Null
    Start-Sleep -Seconds 1
  } catch {
    Write-Host "No running previous helper detected; continuing."
  }
}

if (-not $PythonExe) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $PythonExe = $pythonCommand.Source
  } else {
    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCommand) { $PythonExe = $pyCommand.Source }
  }
}
if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe)) {
  throw "Python 3.10+ was not found. Install 64-bit Python from python.org and run this script again."
}

$versionText = & $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0) { throw "Cannot run the selected Python: $PythonExe" }
if ([version]$versionText -lt [version]"3.10") {
  throw "Python 3.10+ is required. Current version: $versionText."
}

Write-Host "[1/6] Creating the free local helper environment..."
New-Item -ItemType Directory -Force -Path $appDir,$runtimeDir | Out-Null
$appDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($appDir).TrimEnd("\").TrimEnd(":"))
if ($appDrive.Free -lt 5GB) {
  throw "At least 5 GB of free disk space is required."
}
Copy-Item -LiteralPath (Join-Path $sourceDir "whisper_helper.py") -Destination $runtimeDir -Force
Copy-Item -LiteralPath (Join-Path $sourceDir "requirements.txt") -Destination $runtimeDir -Force

if (-not (Test-Path -LiteralPath (Join-Path $venvDir "Scripts\python.exe"))) {
  & $PythonExe -m venv $venvDir
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the isolated Python environment." }
}
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvPythonw = Join-Path $venvDir "Scripts\pythonw.exe"

Write-Host "[2/6] Installing pinned faster-whisper and yt-dlp versions..."
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $runtimeDir "requirements.txt")
if ($LASTEXITCODE -ne 0) {
  Write-Host "Official PyPI connection failed; retrying through the Aliyun PyPI mirror..."
  & $venvPython -m pip install --disable-pip-version-check --index-url "https://mirrors.aliyun.com/pypi/simple" -r (Join-Path $runtimeDir "requirements.txt")
}
if ($LASTEXITCODE -ne 0) { throw "Failed to install faster-whisper or yt-dlp. Check network and disk space." }

Write-Host "[3/6] Generating a local random token..."
$tokenBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($tokenBytes)
$random.Dispose()
$token = -join ($tokenBytes | ForEach-Object { $_.ToString("x2") })
$config = [ordered]@{ token = $token; port = 17891; model = "small" }
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
@"
"use strict";
globalThis.BILI_WHISPER_TOKEN = "$token";
"@ | Set-Content -LiteralPath $tokenScriptPath -Encoding UTF8

if (-not $SkipModelDownload) {
  Write-Host "[4/6] Downloading the free Whisper small model (several hundred MB)..."
  $env:HF_HUB_DISABLE_XET = "1"
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
  & $venvPython (Join-Path $runtimeDir "whisper_helper.py") --config $configPath --prepare-model
  if ($LASTEXITCODE -ne 0) { throw "Whisper small download/load failed. Check network, memory, and logs." }
} else {
  Write-Host "[4/6] Model pre-download skipped; it will download on first transcription."
}

Write-Host "[5/6] Registering silent startup for the current user..."
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startupLink)
$shortcut.TargetPath = $venvPythonw
$shortcut.Arguments = '"' + (Join-Path $runtimeDir "whisper_helper.py") + '" --config "' + $configPath + '" --serve'
$shortcut.WorkingDirectory = $appDir
$shortcut.Description = "Bilibili local subtitle helper"
$shortcut.Save()

Write-Host "[6/6] Starting the helper..."
Start-Process -FilePath $venvPythonw -ArgumentList @((Join-Path $runtimeDir "whisper_helper.py"), "--config", $configPath, "--serve") -WorkingDirectory $appDir -WindowStyle Hidden
Start-Sleep -Seconds 2

$headers = @{ "X-Bili-Helper-Token" = $token }
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:17891/v1/health" -Headers $headers -TimeoutSec 5
  if (-not $health.ok) { throw "The helper returned an unhealthy status." }
} catch {
  throw "The helper was installed but health check failed. See $appDir\logs\helper.log. Details: $($_.Exception.Message)"
}

Write-Host "Installation complete. Reload the extension in Chrome/Edge to read the local random token."
if ($SkipModelDownload) {
  Write-Host "Whisper models will download automatically when first selected."
} else {
  Write-Host "Whisper small is ready by default; tiny and base download automatically on first use."
}
