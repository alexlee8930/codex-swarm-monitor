$ErrorActionPreference = "Stop"

$target = if ($env:CODEX_SWARM_TARGET) { $env:CODEX_SWARM_TARGET } else { "win32-x64" }
$prefix = if ($env:PREFIX) { $env:PREFIX } else { Join-Path $env:LOCALAPPDATA "CodexSwarmMonitor" }
$releaseDir = if ($env:CODEX_SWARM_RELEASE_DIR) { $env:CODEX_SWARM_RELEASE_DIR } else { "" }
$releaseVersion = if ($env:CODEX_SWARM_RELEASE_VERSION) { $env:CODEX_SWARM_RELEASE_VERSION } else { "v0.1.0" }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginJson = Join-Path (Split-Path -Parent $scriptDir) ".codex-plugin\plugin.json"
$pluginRepository = "https://github.com/codex-swarm-monitor/codex-swarm-monitor"
if (Test-Path $pluginJson) {
  try {
    $pluginRepository = (Get-Content $pluginJson -Raw | ConvertFrom-Json).repository
  } catch {
    $pluginRepository = "https://github.com/codex-swarm-monitor/codex-swarm-monitor"
  }
}
$releaseBase = if ($env:CODEX_SWARM_RELEASE_BASE) { $env:CODEX_SWARM_RELEASE_BASE } else { "$pluginRepository/releases/download/$releaseVersion" }

function Fail-Install($message) {
  $releaseDirLabel = if ($releaseDir) { $releaseDir } else { "<download from release base>" }
  throw @"
codex-swarm-monitor standalone install failed: $message
  target: $target
  release version: $releaseVersion
  release base: $releaseBase
  release dir: $releaseDirLabel
  install prefix: $prefix
Set CODEX_SWARM_RELEASE_DIR to a folder containing the archive/checksum, or publish the matching GitHub release assets.
"@
}

$name = "codex-swarm-monitor-$target"
$archive = "$name.tar.gz"
$checksum = "$archive.sha256"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-swarm-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $archivePath = Join-Path $tmp $archive
  $checksumPath = Join-Path $tmp $checksum

  if ($releaseDir) {
    if (!(Test-Path (Join-Path $releaseDir $archive))) {
      Fail-Install "release archive not found: $(Join-Path $releaseDir $archive)"
    }
    if (!(Test-Path (Join-Path $releaseDir $checksum))) {
      Fail-Install "release checksum not found: $(Join-Path $releaseDir $checksum)"
    }
    Copy-Item -Force (Join-Path $releaseDir $archive) $archivePath
    Copy-Item -Force (Join-Path $releaseDir $checksum) $checksumPath
  } else {
    try {
      Invoke-WebRequest -UseBasicParsing "$releaseBase/$archive" -OutFile $archivePath
      Invoke-WebRequest -UseBasicParsing "$releaseBase/$checksum" -OutFile $checksumPath
    } catch {
      Fail-Install "could not download $releaseBase/$archive and $releaseBase/$checksum"
    }
  }

  $expected = ((Get-Content $checksumPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Fail-Install "checksum mismatch for $archive"
  }

  tar -xzf $archivePath -C $tmp
  if ($LASTEXITCODE -ne 0) {
    Fail-Install "could not extract $archive"
  }
  $installer = Join-Path (Join-Path $tmp $name) "install.ps1"
  if (!(Test-Path $installer)) {
    Fail-Install "archive does not contain install.ps1"
  }

  $previousPrefix = $env:PREFIX
  $env:PREFIX = $prefix
  try {
    & $installer | Out-Null
  } finally {
    $env:PREFIX = $previousPrefix
  }

  Write-Host "Installed codex-swarm-monitor to $(Join-Path $prefix "bin")"
  Write-Host "Run: codex-swarm-monitor.cmd --workspace `"$PWD`" --connect --open"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
