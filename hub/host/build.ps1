# Compiles ClaudeHubHost.cs into ClaudeHubHost.exe with the .NET Framework 4.x csc.exe that ships with Windows.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$csc  = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$src  = Join-Path $here 'ClaudeHubHost.cs'
$out  = Join-Path $here 'ClaudeHubHost.exe'

if (-not (Test-Path -LiteralPath $csc)) { throw "csc.exe not found at $csc" }
if (-not (Test-Path -LiteralPath $src)) { throw "source not found: $src" }

# Icon: no .ico is embedded, so the tray uses SystemIcons.Application.
$cscArgs = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/debug-',
    '/warn:4',
    "/out:$out",
    '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
    $src
)

Write-Host "Compiling $src"
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $out)) { throw "build reported success but $out is missing" }
Write-Host "Built $out ($((Get-Item -LiteralPath $out).Length) bytes)"
