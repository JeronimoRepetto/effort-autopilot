$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$brokerScript = Join-Path $projectRoot "bin\internal-interactive-broker.js"
$realClaude = (Get-Command claude -CommandType Application -ErrorAction Stop).Source
$nodeExecutable = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$shimDirectory = Join-Path $projectRoot ".effort-autopilot\isolated-shim"
$shimPath = Join-Path $shimDirectory "claude.cmd"

New-Item -ItemType Directory -Path $shimDirectory -Force | Out-Null
$shim = "@echo off`r`n`"$nodeExecutable`" `"$brokerScript`" %*`r`n"
[System.IO.File]::WriteAllText(
  $shimPath,
  $shim,
  [System.Text.UTF8Encoding]::new($false)
)

$workingDirectory = (Get-Location).Path
$sessionScript = @"
`$env:EFFORT_AUTOPILOT_REAL_CLAUDE = '$($realClaude.Replace("'", "''"))'
`$env:Path = '$($shimDirectory.Replace("'", "''"));' + `$env:Path
Set-Location -LiteralPath '$($workingDirectory.Replace("'", "''"))'
Write-Host 'Effort Autopilot isolated test is active in this window only.' -ForegroundColor Green
Write-Host 'Open any project folder, then run claude normally. Closing this window removes the test shim.'
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($sessionScript))

Start-Process powershell.exe -WindowStyle Normal -ArgumentList @(
  "-NoLogo",
  "-NoExit",
  "-EncodedCommand",
  $encoded
)
