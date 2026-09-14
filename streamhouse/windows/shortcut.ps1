# Creates the StreamHouse shortcuts (Desktop + Start Menu).
#
# Safe to run again at any time - it overwrites the existing shortcuts, which
# is exactly what you want after moving or re-cloning the repository.

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$target  = Join-Path $here 'StreamHouse.cmd'
$icon    = Join-Path $here 'streamhouse.ico'
$workdir = Split-Path -Parent $here

if (-not (Test-Path $target)) { throw "Cannot find the launcher at $target" }

function New-StreamHouseShortcut([string]$path) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath       = $target
  $lnk.WorkingDirectory = $workdir
  $lnk.Description      = 'StreamHouse - media centre with downloads'
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Save()
  Write-Host "  created  $path"
}

Write-Host ''
New-StreamHouseShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'StreamHouse.lnk')

# Also in the Start Menu, so tapping the Windows key and typing "stream" finds it.
$programs = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
if (Test-Path $programs) {
  New-StreamHouseShortcut (Join-Path $programs 'StreamHouse.lnk')
}
Write-Host ''
Write-Host '  Done. Double-click StreamHouse on your desktop to start it.'
Write-Host ''
