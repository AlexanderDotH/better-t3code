[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$requiredEnvironmentVariables = @(
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
  "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"
)
$missing = @($requiredEnvironmentVariables | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_))
  })
if ($missing.Count -gt 0) {
  throw "Official Windows releases require Azure Trusted Signing. Missing: $($missing -join ', ')"
}

try {
  Install-PackageProvider `
    -Name NuGet `
    -MinimumVersion 2.8.5.201 `
    -Force `
    -Scope CurrentUser `
    -ErrorAction Stop
}
catch {
  Write-Warning "Could not bootstrap the NuGet package provider; checking the existing provider. $($_.Exception.Message)"
  Get-PackageProvider -Name NuGet -ErrorAction Stop | Out-Null
}

Install-Module `
  -Name TrustedSigning `
  -MinimumVersion 0.5.0 `
  -Force `
  -AllowClobber `
  -Repository PSGallery `
  -Scope CurrentUser `
  -ErrorAction Stop

Import-Module TrustedSigning -MinimumVersion 0.5.0 -Force
Get-Command Invoke-TrustedSigning -ErrorAction Stop | Out-Null

$moduleRoots = @(
  [IO.Path]::Combine([Environment]::GetFolderPath("MyDocuments"), "PowerShell", "Modules"),
  [IO.Path]::Combine([Environment]::GetFolderPath("MyDocuments"), "WindowsPowerShell", "Modules"),
  [IO.Path]::Combine($env:ProgramFiles, "PowerShell", "Modules"),
  [IO.Path]::Combine($env:ProgramFiles, "WindowsPowerShell", "Modules")
)
$modulePathEntries = @($moduleRoots + ($env:PSModulePath -split ";")) |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
  Select-Object -Unique
"PSModulePath=$($modulePathEntries -join ';')" >> $env:GITHUB_ENV

Write-Host "Azure Trusted Signing is configured for publisher '$env:AZURE_TRUSTED_SIGNING_PUBLISHER_NAME'."
