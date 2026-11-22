# Control the Claude Hub Host tray app from the command line.
# Usage: hubctl.ps1 status|start|stop|restart|logs [-Lines N]|health
# Reads %APPDATA%\ClaudeHubHost\api.json for the API URL and token path, then calls the API.
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('status', 'start', 'stop', 'restart', 'logs', 'health')]
    [string]$Command,
    [int]$Lines = 100
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'ClaudeHubHost'
$apiFile = Join-Path $dir 'api.json'
if (-not (Test-Path -LiteralPath $apiFile)) {
    throw "No api.json at $apiFile. Is ClaudeHubHost running?"
}
$api = Get-Content -LiteralPath $apiFile -Raw | ConvertFrom-Json
$base = ([string]$api.url).TrimEnd('/')
$tokenPath = [string]$api.tokenPath
if (-not (Test-Path -LiteralPath $tokenPath)) { throw "Token file not found: $tokenPath" }
$token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
$headers = @{ Authorization = "Bearer $token" }

switch ($Command) {
    'status'  { $method = 'GET';  $path = '/status' }
    'start'   { $method = 'POST'; $path = '/start' }
    'stop'    { $method = 'POST'; $path = '/stop' }
    'restart' { $method = 'POST'; $path = '/restart' }
    'health'  { $method = 'GET';  $path = '/health' }
    'logs'    {
        $method = 'GET'
        $n = [Math]::Max(1, [Math]::Min(500, $Lines))
        $path = "/logs?lines=$n"
    }
}

try {
    $r = Invoke-RestMethod -Uri ($base + $path) -Method $method -Headers $headers -UseBasicParsing
} catch {
    $code = ''
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $detail = $_.ErrorDetails.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    Write-Host "API error $code : $detail" -ForegroundColor Red
    exit 1
}

function Format-Uptime([int]$s) {
    $ts = [TimeSpan]::FromSeconds($s)
    if ($ts.TotalHours -ge 1) { return ('{0}h {1:00}m {2:00}s' -f [int]$ts.TotalHours, $ts.Minutes, $ts.Seconds) }
    return ('{0}m {1:00}s' -f $ts.Minutes, $ts.Seconds)
}

if ($Command -eq 'logs') {
    foreach ($line in $r.lines) { Write-Output $line }
    exit 0
}

if ($Command -eq 'health') {
    if ($r.healthy) {
        Write-Host ("Hub server answers at {0} (HTTP {1})" -f $r.url, $r.httpStatus) -ForegroundColor Green
    } else {
        Write-Host ("Hub server NOT answering at {0}: {1}" -f $r.url, $r.error) -ForegroundColor Red
        exit 2
    }
    exit 0
}

# status / start / stop / restart all return the status object
$color = if ($r.state -eq 'Running') { 'Green' } elseif ($r.state -eq 'Restarting') { 'Yellow' } else { 'Gray' }
Write-Host ("State:      {0}" -f $r.state) -ForegroundColor $color
Write-Host ("PID:        {0}" -f $(if ($null -ne $r.pid) { $r.pid } else { '-' }))
Write-Host ("Uptime:     {0}" -f (Format-Uptime ([int]$r.uptimeSeconds)))
Write-Host ("Restarts:   {0}" -f $r.restartCount)
Write-Host ("Last exit:  {0}" -f $(if ($null -ne $r.lastExitCode) { $r.lastExitCode } else { '-' }))
if ($null -ne $r.nextRestartInSeconds) { Write-Host ("Next retry: in {0}s" -f $r.nextRestartInSeconds) }
Write-Host ("Server URL: {0}" -f $r.serverUrl)
if ($r.lastError) { Write-Host ("Last error: {0}" -f $r.lastError) -ForegroundColor Yellow }
exit 0
