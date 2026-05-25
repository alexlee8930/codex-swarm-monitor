$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginJson = Join-Path (Split-Path -Parent $scriptDir) ".codex-plugin\plugin.json"
$requiredVersion = $null
if (Test-Path $pluginJson) {
  try {
    $requiredVersion = (Get-Content $pluginJson -Raw | ConvertFrom-Json).version
  } catch {
    $requiredVersion = $null
  }
}
$hasWorkspace = $false
$hasOpen = $false
$hasDoctor = $false
$hasConnect = $false
$hasSupport = $false
$hasExitOnly = $false

foreach ($arg in $args) {
  if ($arg -eq "--workspace" -or $arg -eq "-w" -or $arg.StartsWith("--workspace=")) {
    $hasWorkspace = $true
  }
  if ($arg -eq "--open") {
    $hasOpen = $true
  }
  if ($arg -eq "--doctor") {
    $hasDoctor = $true
  }
  if ($arg -eq "--connect") {
    $hasConnect = $true
  }
  if ($arg -eq "--support") {
    $hasSupport = $true
    $hasExitOnly = $true
  }
  if ($arg -eq "--help" -or $arg -eq "-h" -or $arg -eq "--version" -or $arg -eq "-v") {
    $hasExitOnly = $true
  }
}

$launcher = Get-Command codex-swarm-monitor.cmd -ErrorAction SilentlyContinue
if ($launcher -and $requiredVersion) {
  $versionText = try { & $launcher.Source --version 2>$null } catch { "" }
  if ($versionText -notmatch "(^|\s)$([regex]::Escape($requiredVersion))([\s,)]|$)") {
    $launcher = $null
  }
}
if (-not $launcher) {
  try {
    & (Join-Path $scriptDir "install-standalone.ps1")
  } catch {
    $releaseVersion = if ($env:CODEX_SWARM_RELEASE_VERSION) { $env:CODEX_SWARM_RELEASE_VERSION } else { "v0.1.0" }
    $pluginRepository = "https://github.com/codex-swarm-monitor/codex-swarm-monitor"
    if (Test-Path $pluginJson) {
      try {
        $pluginRepository = (Get-Content $pluginJson -Raw | ConvertFrom-Json).repository
      } catch {
        $pluginRepository = "https://github.com/codex-swarm-monitor/codex-swarm-monitor"
      }
    }
    $releaseBase = if ($env:CODEX_SWARM_RELEASE_BASE) { $env:CODEX_SWARM_RELEASE_BASE } else { "$pluginRepository/releases/download/$releaseVersion" }
    $releaseDir = if ($env:CODEX_SWARM_RELEASE_DIR) { $env:CODEX_SWARM_RELEASE_DIR } else { "<download from release base>" }
    $target = if ($env:CODEX_SWARM_TARGET) { $env:CODEX_SWARM_TARGET } else { "win32-x64" }
    $defaultPrefix = if ($env:PREFIX) { $env:PREFIX } else { Join-Path $env:LOCALAPPDATA "CodexSwarmMonitor" }
    throw @"
codex-swarm-monitor bootstrap failed before a launcher was available.
  release version: $releaseVersion
  release base: $releaseBase
  release dir: $releaseDir
  target: $target
  checked PATH plus: $(Join-Path $defaultPrefix "bin\codex-swarm-monitor.cmd")
Publish the matching release archive/checksum or set CODEX_SWARM_RELEASE_DIR for an offline install.
Original error: $($_.Exception.Message)
"@
  }
  $launcher = Get-Command codex-swarm-monitor.cmd -ErrorAction SilentlyContinue
}
if (-not $launcher) {
  $defaultPrefix = if ($env:PREFIX) { $env:PREFIX } else { Join-Path $env:LOCALAPPDATA "CodexSwarmMonitor" }
  $defaultLauncher = Join-Path $defaultPrefix "bin\codex-swarm-monitor.cmd"
  if (Test-Path $defaultLauncher) {
    $launcher = @{ Source = $defaultLauncher }
  }
}
if ($launcher -and $requiredVersion) {
  $versionText = try { & $launcher.Source --version 2>$null } catch { "" }
  if ($versionText -notmatch "(^|\s)$([regex]::Escape($requiredVersion))([\s,)]|$)") {
    throw "codex-swarm-monitor launcher version does not match plugin $requiredVersion after bootstrap: $($launcher.Source)"
  }
}
if (-not $launcher) {
  $defaultPrefix = if ($env:PREFIX) { $env:PREFIX } else { Join-Path $env:LOCALAPPDATA "CodexSwarmMonitor" }
  throw "codex-swarm-monitor.cmd was not installed after bootstrap. Checked PATH and $(Join-Path $defaultPrefix "bin\codex-swarm-monitor.cmd")."
}

$forwarded = @($args)
if (-not $hasWorkspace -and -not $hasExitOnly) {
  $forwarded += @("--workspace", (Get-Location).Path)
}
if (-not $hasConnect -and -not $hasDoctor -and -not $hasSupport -and -not $hasExitOnly) {
  $forwarded += "--connect"
}
if (-not $hasOpen -and -not $hasDoctor -and -not $hasSupport -and -not $hasExitOnly) {
  $forwarded += "--open"
}

& $launcher.Source @forwarded
