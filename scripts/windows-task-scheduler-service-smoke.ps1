[CmdletBinding()]
param(
  [string]$ServerEntry = "apps/server/dist/bin.mjs",
  [string]$WorkRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:RUNNER_OS -ne "Windows" -or (node.exe -p "process.arch") -ne "x64") {
  throw "Task Scheduler service smoke requires a native Windows x64 runner."
}

$resolvedServerEntry = (Resolve-Path -LiteralPath $ServerEntry).Path
$serverRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $resolvedServerEntry) "..")).Path
$serverPackage = Get-Content -LiteralPath (Join-Path $serverRoot "package.json") -Raw |
  ConvertFrom-Json
$version = [string]$serverPackage.version
$taskName = "\T3 Code Server"

if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
  $WorkRoot = Join-Path $env:RUNNER_TEMP "t3-task-scheduler-smoke-$([guid]::NewGuid())"
}
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$baseDir = Join-Path $WorkRoot "t3-home"
$runtimeRoot = Join-Path $baseDir "runtime"
$versionRoot = Join-Path $runtimeRoot "versions\$version"
$runtimeNodeModules = Join-Path $versionRoot "node_modules"
$runtimePackage = Join-Path $runtimeNodeModules "t3"
$runtimeSentinel = Join-Path $versionRoot ".install-complete"
$launcherPath = Join-Path $runtimeRoot "service-launcher.mjs"
$taskXmlPath = Join-Path $runtimeRoot "t3code-task.xml"
$serviceLogPath = Join-Path $baseDir "userdata\logs\boot-service.log"
$readyMarker = "T3 Code server is ready."
$installed = $false
$completed = $false
$trackedProcessTrees = @()

function Invoke-ServiceCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  & node.exe $resolvedServerEntry service $Command --base-dir $baseDir
  if ($LASTEXITCODE -ne 0) {
    throw "t3 service $Command failed with exit code $LASTEXITCODE."
  }
}

function Write-TaskRegistrationDiagnostic {
  if (-not (Test-Path -LiteralPath $taskXmlPath -PathType Leaf)) {
    return
  }
  Write-Host "Direct schtasks diagnostic after service registration failure:"
  $output = & schtasks.exe /Create /TN $taskName /XML $taskXmlPath /F 2>&1
  $exitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-Host $_ }
  Write-Host "Direct schtasks exit code: $exitCode"
}

function Wait-Until {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description."
}

function Get-ReadyCount {
  if (-not (Test-Path -LiteralPath $serviceLogPath -PathType Leaf)) {
    return 0
  }
  $contents = Get-Content -LiteralPath $serviceLogPath -Raw
  return ([regex]::Matches($contents, [regex]::Escape($readyMarker))).Count
}

function Test-CommandLineContains {
  param(
    [AllowNull()][string]$CommandLine,
    [Parameter(Mandatory = $true)][string]$Value
  )
  return $null -ne $CommandLine -and
    $CommandLine.IndexOf($Value, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-ManagedNodeProcesses {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -ieq "node.exe" -and
      (Test-CommandLineContains -CommandLine $_.CommandLine -Value $baseDir)
    })
}

function Get-ServiceLauncherProcesses {
  return @(Get-ManagedNodeProcesses | Where-Object {
      Test-CommandLineContains -CommandLine $_.CommandLine -Value $launcherPath
    })
}

function Get-ProcessTreeSnapshot {
  param([Parameter(Mandatory = $true)][int]$RootProcessId)

  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $ids = [Collections.Generic.HashSet[int]]::new()
  $pending = [Collections.Generic.Queue[int]]::new()
  $ids.Add($RootProcessId) | Out-Null
  $pending.Enqueue($RootProcessId)
  while ($pending.Count -gt 0) {
    $parentId = $pending.Dequeue()
    foreach ($candidate in $allProcesses) {
      $candidateId = [int]$candidate.ProcessId
      if ([int]$candidate.ParentProcessId -eq $parentId -and $ids.Add($candidateId)) {
        $pending.Enqueue($candidateId)
      }
    }
  }
  return @($allProcesses | Where-Object { $ids.Contains([int]$_.ProcessId) })
}

function Assert-ProcessTreeExited {
  param(
    [Parameter(Mandatory = $true)][object[]]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $survivors = @()
  foreach ($previous in $Snapshot) {
    $current = Get-CimInstance Win32_Process `
      -Filter "ProcessId = $([int]$previous.ProcessId)" `
      -ErrorAction SilentlyContinue
    if ($null -ne $current -and $current.CreationDate -eq $previous.CreationDate) {
      $survivors += $current
    }
  }
  if ($survivors.Count -gt 0) {
    $survivorIds = ($survivors | ForEach-Object { $_.ProcessId }) -join ", "
    throw "$Description left child processes alive: $survivorIds"
  }
}

function Remove-SmokeTaskAndProcesses {
  foreach ($process in Get-ManagedNodeProcesses) {
    & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
  }
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
}

New-Item -ItemType Directory -Path $runtimeNodeModules -Force | Out-Null
New-Item -ItemType Junction -Path $runtimePackage -Target $serverRoot | Out-Null
Set-Content -LiteralPath $runtimeSentinel -Value $version -Encoding utf8NoBOM

try {
  try {
    Invoke-ServiceCommand -Command "install"
  }
  catch {
    Write-TaskRegistrationDiagnostic
    throw
  }
  $installed = $true

  & schtasks.exe /Query /TN $taskName /XML | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The per-user Task Scheduler task was not registered."
  }
  Wait-Until -Description "the initially installed service to become ready" -Condition {
    (Get-ReadyCount) -ge 1
  }

  $initialLaunchers = @(Get-ServiceLauncherProcesses)
  if ($initialLaunchers.Count -ne 1) {
    throw "Expected exactly one service launcher, found $($initialLaunchers.Count)."
  }
  $initialLauncherPid = [int]$initialLaunchers[0].ProcessId
  $crashedTree = @(Get-ProcessTreeSnapshot -RootProcessId $initialLauncherPid)
  $trackedProcessTrees += ,$crashedTree
  $readyBeforeCrash = Get-ReadyCount

  Stop-Process -Id $initialLauncherPid -Force
  Wait-Until `
    -Description "Task Scheduler to restart the crashed launcher" `
    -TimeoutSeconds 150 `
    -Condition {
      $launchers = @(Get-ServiceLauncherProcesses | Where-Object {
          [int]$_.ProcessId -ne $initialLauncherPid
        })
      $launchers.Count -eq 1
    }
  Wait-Until `
    -Description "the restarted service to become ready" `
    -TimeoutSeconds 90 `
    -Condition { (Get-ReadyCount) -gt $readyBeforeCrash }
  Assert-ProcessTreeExited -Snapshot $crashedTree -Description "Launcher crash recovery"

  $managedAfterCrash = @(Get-ManagedNodeProcesses)
  if ($managedAfterCrash.Count -ne 2) {
    throw "Launcher crash recovery left an unexpected managed process count: $($managedAfterCrash.Count)."
  }

  Add-Content -LiteralPath $taskXmlPath -Value "<!-- deliberate repair drift -->"
  $repairLauncher = @(Get-ServiceLauncherProcesses)
  if ($repairLauncher.Count -ne 1) {
    throw "Expected exactly one launcher before repair, found $($repairLauncher.Count)."
  }
  $repairedTree = @(
    Get-ProcessTreeSnapshot -RootProcessId ([int]$repairLauncher[0].ProcessId)
  )
  $trackedProcessTrees += ,$repairedTree
  $readyBeforeRepair = Get-ReadyCount
  Invoke-ServiceCommand -Command "update"
  Wait-Until -Description "the repaired service to become ready" -Condition {
    (Get-ReadyCount) -gt $readyBeforeRepair
  }
  if ((Get-Content -LiteralPath $taskXmlPath -Raw).Contains("deliberate repair drift")) {
    throw "t3 service update did not repair the scheduled task definition."
  }
  Assert-ProcessTreeExited -Snapshot $repairedTree -Description "Service repair"

  Invoke-ServiceCommand -Command "status"
  $uninstallLauncher = @(Get-ServiceLauncherProcesses)
  if ($uninstallLauncher.Count -ne 1) {
    throw "Expected exactly one launcher before uninstall, found $($uninstallLauncher.Count)."
  }
  $uninstalledTree = @(
    Get-ProcessTreeSnapshot -RootProcessId ([int]$uninstallLauncher[0].ProcessId)
  )
  $trackedProcessTrees += ,$uninstalledTree
  Invoke-ServiceCommand -Command "uninstall"
  $installed = $false
  Wait-Until -Description "all managed service processes to exit" -Condition {
    @(Get-ManagedNodeProcesses).Count -eq 0
  }
  Assert-ProcessTreeExited -Snapshot $uninstalledTree -Description "Service uninstall"
  & schtasks.exe /Query /TN $taskName 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    throw "Task Scheduler registration remained after service uninstall."
  }

  $completed = $true
  Write-Host "Windows Task Scheduler service smoke passed."
}
finally {
  if (-not $completed) {
    if ($installed) {
      try {
        Invoke-ServiceCommand -Command "uninstall"
      }
      catch {
        Write-Warning "Graceful smoke cleanup failed: $($_.Exception.Message)"
      }
    }
    Remove-SmokeTaskAndProcesses
    foreach ($snapshot in $trackedProcessTrees) {
      foreach ($previous in $snapshot) {
        $current = Get-CimInstance Win32_Process `
          -Filter "ProcessId = $([int]$previous.ProcessId)" `
          -ErrorAction SilentlyContinue
        if ($null -ne $current -and $current.CreationDate -eq $previous.CreationDate) {
          & taskkill.exe /PID $current.ProcessId /T /F | Out-Null
        }
      }
    }
  }
}
exit 0
