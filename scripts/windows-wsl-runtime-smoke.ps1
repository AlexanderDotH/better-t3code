[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RootfsPath,
  [Parameter(Mandatory = $true)][string]$NodePtyBinary,
  [Parameter(Mandatory = $true)][string]$ResourceMonitorBinary,
  [string]$WorkRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:RUNNER_OS -ne "Windows" -or (node.exe -p "process.arch") -ne "x64") {
  throw "WSL runtime smoke requires a native Windows x64 runner."
}

function Resolve-RequiredFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing $Description at '$Path'."
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Convert-ToWslMountPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "WSL smoke payload must be on a local Windows drive: '$fullPath'."
  }
  $drive = $Matches[1].ToLowerInvariant()
  $relativePath = $Matches[2].Replace('\', '/')
  return "/mnt/$drive/$relativePath"
}

$resolvedRootfs = Resolve-RequiredFile -Path $RootfsPath -Description "WSL rootfs"
$resolvedNodePty = Resolve-RequiredFile -Path $NodePtyBinary -Description "Linux node-pty binary"
$resolvedResourceMonitor = Resolve-RequiredFile `
  -Path $ResourceMonitorBinary `
  -Description "Linux resource monitor"

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
  $WorkRoot = Join-Path $env:RUNNER_TEMP "t3-wsl-runtime-smoke-$([guid]::NewGuid())"
}
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$runId = ([guid]::NewGuid().ToString("N"))
$distroName = "T3Code-Wsl-Smoke-$runId"
$installRoot = Join-Path $WorkRoot "distro-$runId"
$payloadRoot = Join-Path $WorkRoot "payload-$runId"
$nodePtyRoot = Join-Path $payloadRoot "node-pty"
$registered = $false
$completed = $false

New-Item -ItemType Directory -Path $installRoot, $nodePtyRoot -Force | Out-Null

$resolveNodePty = @'
process.stdout.write(require.resolve("node-pty/package.json", {
  paths: [process.cwd() + "/apps/server"],
}));
'@
$nodePtyPackageJson = (& node.exe -e $resolveNodePty | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($nodePtyPackageJson)) {
  throw "Could not resolve the installed node-pty package."
}
$nodePtySource = Split-Path -Parent (Resolve-Path -LiteralPath $nodePtyPackageJson).Path
Get-ChildItem -LiteralPath $nodePtySource -Force |
  Copy-Item -Destination $nodePtyRoot -Recurse -Force

$nodePtyRelease = Join-Path $nodePtyRoot "build\Release"
if (Test-Path -LiteralPath (Join-Path $nodePtyRoot "build")) {
  Remove-Item -LiteralPath (Join-Path $nodePtyRoot "build") -Recurse -Force
}
New-Item -ItemType Directory -Path $nodePtyRelease -Force | Out-Null
Copy-Item -LiteralPath $resolvedNodePty -Destination (Join-Path $nodePtyRelease "pty.node")
Copy-Item `
  -LiteralPath $resolvedResourceMonitor `
  -Destination (Join-Path $payloadRoot "t3-resource-monitor")

$probeSource = Join-Path $PSScriptRoot "wsl-runtime-probe.cjs"
Copy-Item -LiteralPath $probeSource -Destination (Join-Path $payloadRoot "probe.cjs")

try {
  & wsl.exe --import $distroName $installRoot $resolvedRootfs --version 1
  if ($LASTEXITCODE -ne 0) {
    throw "wsl --import failed with exit code $LASTEXITCODE."
  }
  $registered = $true

  $architecture = (& wsl.exe -d $distroName --user root -- /bin/uname -m | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $architecture -ne "x86_64") {
    throw "Imported WSL distro must report x86_64, received '$architecture'."
  }

  $payloadWslPath = Convert-ToWslMountPath -Path $payloadRoot
  $wslProbe = @'
set -euo pipefail
source_path="$1"
mkdir -p /opt/t3-smoke
cp -R "$source_path"/. /opt/t3-smoke/
chmod 0755 /opt/t3-smoke/t3-resource-monitor
/usr/local/bin/node \
  /opt/t3-smoke/probe.cjs \
  /opt/t3-smoke/node-pty \
  /opt/t3-smoke/t3-resource-monitor
'@
  & wsl.exe -d $distroName --user root -- /bin/bash -lc $wslProbe t3-wsl-smoke $payloadWslPath
  if ($LASTEXITCODE -ne 0) {
    throw "WSL terminal/telemetry probe failed with exit code $LASTEXITCODE."
  }
  $completed = $true
} finally {
  if ($registered) {
    & wsl.exe --terminate $distroName 2>$null | Out-Null
    & wsl.exe --unregister $distroName 2>$null | Out-Null
  }
  if (-not $completed) {
    Write-Error "WSL runtime smoke failed. Payload retained at '$payloadRoot'."
  }
}

Write-Output "WSL x64/glibc node-pty and resource-monitor smoke passed."
