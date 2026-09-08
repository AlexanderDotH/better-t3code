[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedPublisher,

  [Parameter(Mandatory = $true)]
  [string]$ProductName,

  [ValidateSet("startup", "update")]
  [string]$Mode = "startup",

  [string]$TargetVersion,
  [int]$UpdatePort = 0,
  [string]$WorkRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$authenticodeScript = Join-Path $PSScriptRoot "windows-assert-authenticode.mjs"
$desktopDriverScript = Join-Path $PSScriptRoot "windows-desktop-smoke-driver.mjs"

function Assert-AuthenticodePublisher {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Publisher
  )

  & node.exe $authenticodeScript --path $Path --publisher $Publisher
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticode verification failed for '$Path' with exit code $LASTEXITCODE."
  }
}

function Invoke-CheckedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @()
  )

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -Wait `
    -PassThru `
    -NoNewWindow
  if ($null -eq $process -or $process.ExitCode -ne 0) {
    $exitCode = if ($null -eq $process) { "unknown" } else { $process.ExitCode }
    throw "'$FilePath' failed with exit code $exitCode."
  }
}

function Find-InstalledExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][datetime]$InstalledAfter
  )

  $expected = Join-Path $env:LOCALAPPDATA "Programs\$Name\$Name.exe"
  if (Test-Path -LiteralPath $expected -PathType Leaf) {
    return (Resolve-Path -LiteralPath $expected).Path
  }

  $programsRoot = Join-Path $env:LOCALAPPDATA "Programs"
  $candidate = Get-ChildItem `
    -LiteralPath $programsRoot `
    -Filter "$Name.exe" `
    -File `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -ge $InstalledAfter.ToUniversalTime().AddMinutes(-1) } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if ($null -eq $candidate) {
    throw "Could not locate the installed '$Name.exe' below '$programsRoot'."
  }
  return $candidate.FullName
}

function Assert-NoInstallProcesses {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)

  $installDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $ExecutablePath)).TrimEnd("\") + "\"
  $survivors = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and
      ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith(
        $installDirectory,
        [StringComparison]::OrdinalIgnoreCase
      )
    })
  if ($survivors.Count -gt 0) {
    $ids = ($survivors | ForEach-Object { $_.ProcessId }) -join ", "
    throw "Installed desktop smoke left processes below '$installDirectory' alive: $ids"
  }
}

function Find-Uninstaller {
  param([Parameter(Mandatory = $true)][string]$InstallDirectory)

  $uninstaller = Get-ChildItem `
    -LiteralPath $InstallDirectory `
    -Filter "Uninstall*.exe" `
    -File `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $uninstaller) {
    throw "Could not locate the NSIS uninstaller in '$InstallDirectory'."
  }
  return $uninstaller.FullName
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
  $temporaryDirectory = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    [IO.Path]::GetTempPath()
  } else {
    $env:RUNNER_TEMP
  }
  $WorkRoot = Join-Path $temporaryDirectory "t3-windows-release-smoke-$([guid]::NewGuid())"
}
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$t3Home = Join-Path $WorkRoot "t3-home"
$electronUserData = Join-Path $WorkRoot "electron-user-data"
$installStartedAt = Get-Date
$installedExecutable = $null
$uninstaller = $null

New-Item -ItemType Directory -Path $t3Home, $electronUserData -Force | Out-Null

try {
  Assert-AuthenticodePublisher -Path $resolvedInstaller -Publisher $ExpectedPublisher
  Invoke-CheckedProcess -FilePath $resolvedInstaller -ArgumentList @("/S")

  $installedExecutable = Find-InstalledExecutable `
    -Name $ProductName `
    -InstalledAfter $installStartedAt
  Assert-AuthenticodePublisher -Path $installedExecutable -Publisher $ExpectedPublisher
  $uninstaller = Find-Uninstaller -InstallDirectory (Split-Path -Parent $installedExecutable)

  $driverArgs = @(
    $desktopDriverScript,
    "--exe", $installedExecutable,
    "--t3-home", $t3Home,
    "--user-data-dir", $electronUserData,
    "--mode", $Mode
  )
  if ($Mode -eq "update") {
    if ([string]::IsNullOrWhiteSpace($TargetVersion) -or $UpdatePort -lt 1) {
      throw "Update smoke requires TargetVersion and a positive UpdatePort."
    }
    $driverArgs += @("--target-version", $TargetVersion, "--update-port", "$UpdatePort")
  }

  & node.exe @driverArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Windows desktop smoke driver failed with exit code $LASTEXITCODE."
  }
  Assert-NoInstallProcesses -ExecutablePath $installedExecutable
  Assert-AuthenticodePublisher -Path $installedExecutable -Publisher $ExpectedPublisher
}
finally {
  if ($null -ne $installedExecutable) {
    $installDirectory = [IO.Path]::GetFullPath(
      (Split-Path -Parent $installedExecutable)
    ).TrimEnd("\") + "\"
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath -and
        ([IO.Path]::GetFullPath($_.ExecutablePath)).StartsWith(
          $installDirectory,
          [StringComparison]::OrdinalIgnoreCase
        )
      } |
      ForEach-Object {
        & taskkill.exe /PID $_.ProcessId /T /F | Out-Null
      }
  }
  if ($null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    Invoke-CheckedProcess -FilePath $uninstaller -ArgumentList @("/S")
  }
}

if ($null -ne $installedExecutable -and (Test-Path -LiteralPath $installedExecutable)) {
  throw "NSIS uninstall left the installed executable at '$installedExecutable'."
}

Write-Host "Windows NSIS $Mode smoke passed with isolated state at '$WorkRoot'."
