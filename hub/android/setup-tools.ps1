# Installs everything needed to build the tablet app into hub/tools, nothing system-wide:
#   tools/jdk          Eclipse Temurin JDK 21
#   tools/android-sdk  Android command-line tools, platform 35, build-tools 35.0.0
#   tools/android-user sdkmanager's own settings (instead of ~/.android)
# Re-running is safe: finished parts are skipped.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tools = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools'
$dl = Join-Path $tools 'download'
New-Item -ItemType Directory -Force $dl | Out-Null

function Get-Zip($url, $name) {
  $zip = Join-Path $dl $name
  if (-not (Test-Path $zip)) { Write-Host "downloading $name"; Invoke-WebRequest -UseBasicParsing $url -OutFile $zip }
  return $zip
}

# ---- JDK ----
$jdk = Join-Path $tools 'jdk'
if (-not (Test-Path (Join-Path $jdk 'bin\javac.exe'))) {
  $zip = Get-Zip 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' 'jdk21.zip'
  # tar (built into Windows) unpacks straight into place; Expand-Archive trips over long paths here
  Remove-Item -Recurse -Force $jdk -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $jdk | Out-Null
  tar -xf $zip -C $jdk --strip-components=1
  if ($LASTEXITCODE) { throw "unpacking the JDK failed" }
}
Write-Host "jdk ok"

# ---- Android command-line tools ----
$sdk = Join-Path $tools 'android-sdk'
$latest = Join-Path $sdk 'cmdline-tools\latest'
if (-not (Test-Path (Join-Path $latest 'bin\sdkmanager.bat'))) {
  $zip = $null
  foreach ($v in '13114758', '11076708') {
    try { $zip = Get-Zip "https://dl.google.com/android/repository/commandlinetools-win-${v}_latest.zip" "cmdline-tools-$v.zip"; break } catch { Write-Host "cmdline-tools $v not available" }
  }
  Remove-Item -Recurse -Force $latest -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $latest | Out-Null
  tar -xf $zip -C $latest --strip-components=1
  if ($LASTEXITCODE) { throw "unpacking cmdline-tools failed" }
}
Write-Host "cmdline-tools ok"

# ---- SDK packages (the user accepted the Android SDK License Agreement) ----
$env:JAVA_HOME = $jdk
$env:ANDROID_USER_HOME = Join-Path $tools 'android-user'
$env:ANDROID_HOME = $sdk
$sm = Join-Path $latest 'bin\sdkmanager.bat'
if (-not (Test-Path (Join-Path $sdk 'build-tools\35.0.0\aapt2.exe')) -or -not (Test-Path (Join-Path $sdk 'platforms\android-35\android.jar'))) {
  # sdkmanager ignores piped input from PowerShell; feed the answers from a file instead
  $yes = Join-Path $dl 'yes.txt'; [IO.File]::WriteAllText($yes, ("y`r`n" * 30))
  Start-Process -FilePath $sm -ArgumentList "--sdk_root=$sdk", '--licenses' -RedirectStandardInput $yes `
    -RedirectStandardOutput (Join-Path $dl 'licenses-out.txt') -NoNewWindow -Wait | Out-Null
  & $sm --sdk_root=$sdk 'platforms;android-35' 'build-tools;35.0.0'
}
Write-Host "sdk ok"
Get-ChildItem $tools | Select-Object Name
