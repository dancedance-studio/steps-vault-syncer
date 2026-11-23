<#
  The release check's run of the installer on a clean Windows machine (GitHub's windows-latest), in order: a silent
  per-user install (/S) with both "What Sync sends" answers on, the installed app's signature (and, unsigned, its update
  settings), its name and version in its file details, the app starting and reporting its version (--print-version),
  then a silent uninstall.

  It stops at the first step that fails and writes that step's name to $env:GITHUB_OUTPUT as failed-step, for the
  "check failed" message. Never run it on a computer you use: it installs and uninstalls Sync for the current user.

  Usage: check-installer.ps1 -Installer <Setup.exe> -Version 0.2.0 [-ExpectedPublisher 'SignPath Foundation']
  Without -ExpectedPublisher the release is unsigned (docs/code-signing-policy.md): the installed app must then have no
  signature at all, so a half-signed build is caught, and its update settings must not ask for a publisher's signature.
#>
param(
  [Parameter(Mandatory = $true)] [string] $Installer,
  [Parameter(Mandatory = $true)] [string] $Version,
  [string] $ExpectedPublisher = ''
)

$ErrorActionPreference = 'Stop'
$ProductName = 'dancedance.studio Sync'
$UninstallEntries = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$ScriptsFolder = $PSScriptRoot
$WaitSeconds = 300

function Invoke-CheckStep([string] $StepName, [scriptblock] $Check) {
  Write-Host "::group::$StepName"
  try {
    & $Check
  } catch {
    Write-Host "::error::$($StepName): $($_.Exception.Message)"
    if ($env:GITHUB_OUTPUT) { "failed-step=$StepName" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8 }
    Write-Host '::endgroup::'
    exit 1
  }
  Write-Host '::endgroup::'
}

function Get-SyncUninstallEntry {
  Get-ItemProperty -Path $UninstallEntries -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $ProductName } | Select-Object -First 1
}

# Runs a program and waits for it, but never forever; returns its exit code (and its output, with -OutputFile).
function Invoke-Program([string] $FilePath, [string[]] $Arguments, [string] $OutputFile = '') {
  $options = @{ FilePath = $FilePath; ArgumentList = $Arguments; PassThru = $true }
  if ($OutputFile) { $options.RedirectStandardOutput = $OutputFile }
  $process = Start-Process @options
  $null = $process.Handle # without it PowerShell forgets the exit code
  if (-not $process.WaitForExit($WaitSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "$FilePath was still running after $WaitSeconds seconds."
  }
  return $process.ExitCode
}

function Wait-Until([scriptblock] $Condition, [string] $Problem) {
  $giveUpAt = (Get-Date).AddSeconds($WaitSeconds)
  while (-not (& $Condition)) {
    if ((Get-Date) -gt $giveUpAt) { throw $Problem }
    Start-Sleep -Seconds 2
  }
}

$script:UninstallerPath = ''
$script:InstallFolder = ''
$script:AppPath = ''

Invoke-CheckStep 'silent per-user install' {
  if (Get-SyncUninstallEntry) { throw "$ProductName is already installed on this machine; the check needs a clean one." }
  $exitCode = Invoke-Program -FilePath $Installer -Arguments @('/S')
  if ($exitCode -ne 0) { throw "The installer ended with exit code $exitCode." }
  $entry = Get-SyncUninstallEntry
  if (-not $entry) { throw "The installer added no $ProductName to this user's apps." }
  if ($entry.DisplayVersion -ne $Version) { throw "Windows lists version $($entry.DisplayVersion), not $Version." }
  if ($entry.QuietUninstallString -notmatch '^"([^"]+)"') { throw "The uninstall command looks wrong: $($entry.QuietUninstallString)" }
  $script:UninstallerPath = $Matches[1]
  $installFolder = Split-Path -Parent $script:UninstallerPath
  if (-not $installFolder.StartsWith($env:LOCALAPPDATA, [System.StringComparison]::OrdinalIgnoreCase)) { throw "It installed in $installFolder, not in this user's folder." }
  $script:InstallFolder = $installFolder
  $script:AppPath = Join-Path $installFolder "$ProductName.exe"
  if (-not (Test-Path -LiteralPath $script:AppPath)) { throw "There is no $script:AppPath." }
  $choices = Get-Content -LiteralPath (Join-Path $installFolder 'installer-choices.json') -Raw | ConvertFrom-Json
  if ($choices.isAutomaticUpdateCheckOn -ne $true -or $choices.shouldStartWithWindows -ne $true) { throw "A silent install must keep both choices on; installer-choices.json says $($choices | ConvertTo-Json -Compress)." }
  Write-Host "Installed in $installFolder."
}

Invoke-CheckStep 'the installed app''s signature' {
  $expectation = if ($ExpectedPublisher) { $ExpectedPublisher } else { '--not-signed' }
  & node (Join-Path $ScriptsFolder 'check-signature.mjs') $script:AppPath $expectation
  if ($LASTEXITCODE -ne 0) { throw 'The installed app is not signed as it should be.' }
}

# electron-updater checks an update's signature only when the installed app's app-update.yml names a publisherName
# (electron-builder writes one when it signs with a certificate itself). An unsigned app with one would refuse every
# unsigned update, so players would be stuck on it.
if (-not $ExpectedPublisher) {
  Invoke-CheckStep 'the app''s update settings' {
    $updateSettingsPath = Join-Path $script:InstallFolder 'resources\app-update.yml'
    if (-not (Test-Path -LiteralPath $updateSettingsPath)) { throw "There is no $updateSettingsPath, so the app can't update itself." }
    $updateSettings = Get-Content -LiteralPath $updateSettingsPath -Raw
    Write-Host $updateSettings
    if ($updateSettings -match '(?m)^\s*publisherName:') { throw 'app-update.yml names a publisherName, so this unsigned app would refuse every unsigned update.' }
    if ($updateSettings -notmatch '(?m)^provider: github\s*$' -or $updateSettings -notmatch '(?m)^owner: dancedance-studio\s*$' -or $updateSettings -notmatch '(?m)^repo: sync\s*$') { throw 'app-update.yml doesn''t point at this repo''s GitHub releases.' }
    Write-Host 'The app takes its updates from this repo''s GitHub releases, without asking for a signature.'
  }
}

Invoke-CheckStep 'the name and version in the files'' details' {
  $installerDetails = (Get-Item -LiteralPath $Installer).VersionInfo
  $appDetails = (Get-Item -LiteralPath $script:AppPath).VersionInfo
  if ($installerDetails.ProductName -ne $ProductName -or $appDetails.ProductName -ne $ProductName) { throw "The product names are '$($installerDetails.ProductName)' and '$($appDetails.ProductName)', not '$ProductName'." }
  if ($installerDetails.ProductVersion -ne $Version -or $appDetails.FileVersion -ne $Version) { throw "The versions are '$($installerDetails.ProductVersion)' and '$($appDetails.FileVersion)', not '$Version'." }
  Write-Host "Both say $ProductName $Version."
}

Invoke-CheckStep 'the app starts and reports its version' {
  $outputFile = Join-Path $env:RUNNER_TEMP 'print-version.txt'
  $exitCode = Invoke-Program -FilePath $script:AppPath -Arguments @('--print-version') -OutputFile $outputFile
  if ($exitCode -ne 0) { throw "--print-version ended with exit code $exitCode." }
  # Electron writes an empty line before the app's own output.
  $reportedVersion = (Get-Content -LiteralPath $outputFile | Where-Object { $_.Trim() } | Select-Object -Last 1)
  if ($null -eq $reportedVersion -or $reportedVersion.Trim() -ne $Version) { throw "The app says it is version '$reportedVersion', not $Version." }
  Write-Host "The app says $Version."
}

Invoke-CheckStep 'silent uninstall' {
  # The uninstaller copies itself to a temporary folder and runs from there, so the files are watched instead of it.
  $exitCode = Invoke-Program -FilePath $script:UninstallerPath -Arguments @('/currentuser', '/S')
  if ($exitCode -ne 0) { throw "The uninstaller ended with exit code $exitCode." }
  Wait-Until { -not (Test-Path -LiteralPath $script:AppPath) -and -not (Get-SyncUninstallEntry) } "The app or its entry in this user's apps was still there after $WaitSeconds seconds."
  if (Get-ItemProperty -Path 'HKCU:\Software\Classes\dancedance-sync' -ErrorAction SilentlyContinue) { throw 'The dancedance-sync link scheme is still registered.' }
  Write-Host 'Uninstalled.'
}
