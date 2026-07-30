param(
  [string]$PythonExe = "",
  [ValidateSet("tiny", "base", "small")]
  [string[]]$Models = @("tiny", "base", "small"),
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

function Get-PythonDetails([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $null
  }
  try {
    $details = & $Candidate -c "import compileall, ensurepip, json, platform, sys, venv; print(json.dumps({'major': sys.version_info.major, 'minor': sys.version_info.minor, 'bits': platform.architecture()[0]}))" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $details) { return $null }
    $parsed = ($details | Select-Object -Last 1) | ConvertFrom-Json
    return [pscustomobject]@{
      Path = [IO.Path]::GetFullPath($Candidate)
      Major = [int]$parsed.major
      Minor = [int]$parsed.minor
      Bits = [string]$parsed.bits
    }
  } catch {
    return $null
  }
}

function Assert-CompatiblePython([string]$Candidate, [switch]$Explicit) {
  if ($Explicit -and (Test-Path -LiteralPath $Candidate -PathType Container)) {
    throw "-PythonExe must point to the actual python.exe file, not its parent directory: $Candidate"
  }
  $details = Get-PythonDetails $Candidate
  if (-not $details) {
    if ($Explicit) {
      throw "The selected Python is missing or incomplete. Use the full path to a 64-bit Python 3.10-3.12 python.exe: $Candidate"
    }
    return $null
  }
  $compatibleVersion = $details.Major -eq 3 -and $details.Minor -ge 10 -and $details.Minor -le 12
  if (-not $compatibleVersion -or $details.Bits -ne "64bit") {
    if ($Explicit) {
      throw "Python $($details.Major).$($details.Minor) $($details.Bits) is not supported. Install 64-bit Python 3.10-3.12, or pass its exact python.exe path with -PythonExe."
    }
    return $null
  }
  return $details
}

function Resolve-CompatiblePython([string]$Requested) {
  if ($Requested) {
    return Assert-CompatiblePython $Requested -Explicit
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  $pyCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCommand) {
    foreach ($minor in 12, 11, 10) {
      try {
        $resolved = & $pyCommand.Source "-3.$minor" -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $resolved) {
          $candidates.Add([string]($resolved | Select-Object -Last 1))
        }
      } catch {}
    }
  }
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) { $candidates.Add($pythonCommand.Source) }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    $details = Assert-CompatiblePython $candidate
    if ($details) { return $details }
  }
  throw "No compatible Python was found. Install 64-bit Python 3.10-3.12. Python 3.13 and 3.14 are not supported by the pinned local Whisper dependencies. If multiple versions are installed, pass the exact python.exe path with -PythonExe."
}

function Test-CompatibleVenv([string]$Candidate) {
  if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
  try {
    & $Candidate -c "import compileall, ensurepip, platform, sys, venv; assert sys.version_info[:2] >= (3, 10) and sys.version_info[:2] < (3, 13); assert platform.architecture()[0] == '64bit'" 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

# Validate Python before stopping or changing a working helper.
$pythonDetails = Resolve-CompatiblePython $PythonExe
$PythonExe = $pythonDetails.Path
Write-Host "Using Python $($pythonDetails.Major).$($pythonDetails.Minor) 64-bit: $PythonExe"

if (-not $SkipModelDownload) {
  $selectedModels = @($Models | Select-Object -Unique)
  if ($selectedModels.Count -eq 0) { throw "Select at least one model, or use -SkipModelDownload." }
}

if (Test-Path -LiteralPath $configPath) {
  try {
    $oldConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:17891/v1/shutdown" -Headers @{ "X-Bili-Helper-Token" = $oldConfig.token } -TimeoutSec 3 | Out-Null
    Start-Sleep -Seconds 1
  } catch {
    Write-Host "No running previous helper detected; continuing."
  }
}

Write-Host "[1/6] Creating the free local helper environment..."
New-Item -ItemType Directory -Force -Path $appDir,$runtimeDir | Out-Null
$appDrive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($appDir))
if (-not $appDrive.IsReady -or $appDrive.AvailableFreeSpace -lt 5GB) {
  throw "At least 5 GB of free disk space is required on $($appDrive.Name)"
}
Copy-Item -LiteralPath (Join-Path $sourceDir "whisper_helper.py") -Destination $runtimeDir -Force
Copy-Item -LiteralPath (Join-Path $sourceDir "requirements.txt") -Destination $runtimeDir -Force

$venvPython = Join-Path $venvDir "Scripts\python.exe"
if ((Test-Path -LiteralPath $venvDir) -and -not (Test-CompatibleVenv $venvPython)) {
  $appFull = [IO.Path]::GetFullPath($appDir).TrimEnd("\") + "\"
  $venvFull = [IO.Path]::GetFullPath($venvDir)
  if (-not $venvFull.StartsWith($appFull, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $venvFull -Leaf) -ne "venv") {
    throw "Unsafe virtual environment cleanup target: $venvFull"
  }
  Write-Host "Existing helper environment is incompatible; rebuilding it without deleting models or results..."
  Remove-Item -LiteralPath $venvFull -Recurse -Force
}
if (-not (Test-Path -LiteralPath $venvPython)) {
  & $PythonExe -m venv $venvDir
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the isolated Python environment." }
}
if (-not (Test-CompatibleVenv $venvPython)) {
  throw "The isolated Python environment is incomplete. Reinstall 64-bit Python 3.10-3.12 and try again."
}
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
  Write-Host "[4/6] Downloading and loading Whisper models: $($selectedModels -join ', ')"
  $env:HF_HUB_DISABLE_XET = "1"
  $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
  $modelArguments = @("--config", $configPath)
  foreach ($modelName in $selectedModels) {
    $modelArguments += @("--prepare-model", $modelName)
  }
  & $venvPython (Join-Path $runtimeDir "whisper_helper.py") @modelArguments
  if ($LASTEXITCODE -ne 0) { throw "Whisper model download/load failed. Check network, memory, and logs." }
} else {
  Write-Host "[4/6] Model pre-download skipped; the selected model will download on first transcription."
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
  Write-Host "Whisper models ready: $($selectedModels -join ', ')"
}
