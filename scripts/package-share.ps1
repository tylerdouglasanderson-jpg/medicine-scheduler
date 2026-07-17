# Assemble a shareable bundle of the Medicine Scheduler for non-technical users.
# Run AFTER `npm run build`. Produces share/ and Medicine-Scheduler.zip in the project root.
#   pwsh scripts/package-share.ps1
$ErrorActionPreference = 'Stop'
$root     = Split-Path $PSScriptRoot -Parent
$dist     = Join-Path $root 'dist'
$share    = Join-Path $root 'share'
$examples = Join-Path $share 'Example Schedules'

if (-not (Test-Path (Join-Path $dist 'med-scheduler.html'))) {
  throw "dist/med-scheduler.html missing - run 'npm run build' first."
}

Remove-Item $share -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $examples | Out-Null

Copy-Item (Join-Path $dist 'med-scheduler.html')       (Join-Path $share 'Medicine Scheduler.html')
Copy-Item (Join-Path $dist 'med-scheduler-guide.html') (Join-Path $share 'User Guide.html')

# A curated few examples (friendly names) so a new user can Load -> Solve before entering real data.
$pick = [ordered]@{
  '01-standard-medF.json'              = '1 - Standard team (1 senior, 2 interns).json'
  '05-medC-two-seniors.json'           = '2 - Medicine C (two seniors).json'
  '06-two-senior-one-intern-medE.json' = '3 - Two seniors, one intern.json'
  '08-with-pins-medF.json'             = '4 - Month with pinned assignments.json'
}
foreach ($k in $pick.Keys) {
  Copy-Item (Join-Path $root "scenarios/$k") (Join-Path $examples $pick[$k])
}

$startHere = @'
Medicine Team Scheduler
=======================

WHAT IT IS
  Builds an optimal monthly inpatient-medicine call schedule (6-day call cycle,
  pager, offs, clinics/didactics). Runs entirely in your browser. Nothing to
  install. Works offline. Your data never leaves your computer.

HOW TO START (2 minutes)
  1. Double-click  "Medicine Scheduler.html"  - it opens in your browser.
  2. Click  "Load example"  (or Load Scenario, then pick a file from
     the "Example Schedules" folder).
  3. Click  Solve.  Read the calendar and the totals on the right.
  4. Open  "User Guide.html"  any time for the full how-to.

TO BUILD YOUR OWN MONTH
  Set the team / month / anchor day, add each resident with their clinics and
  PTO, then Solve. Nudge any cell by pinning it and Solve again. When it looks
  right, Export to Excel or Print to PDF to share with the team.
  Step-by-step (every field, all pin types, export): see  User Guide.html

REQUIREMENTS
  Any modern browser (Chrome, Edge, Safari, Firefox). No internet connection
  needed. No account, no sign-in.
'@
Set-Content -Path (Join-Path $share 'START HERE.txt') -Value $startHere -Encoding UTF8

$zip = Join-Path $root 'Medicine-Scheduler.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $share '*') -DestinationPath $zip
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Bundle ready: $zip  ($mb MB)"
Get-ChildItem -Recurse $share | ForEach-Object { Write-Host "  $($_.FullName.Substring($share.Length + 1))" }
