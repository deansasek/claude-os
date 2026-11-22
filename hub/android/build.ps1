# Builds the tablet app without Gradle, using only the tools in hub/tools (see setup-tools.ps1):
#   aapt2 (resources + manifest) -> javac -> d8 (dex) -> zipalign -> apksigner
# Output: android/build/claude-hub.apk
# Install / update it:   .\android\build.ps1 -Install
param([switch]$Install, [string]$Device = '')
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$tools = Join-Path (Split-Path $here -Parent) 'tools'
$sdk = Join-Path $tools 'android-sdk'
$bt = Join-Path $sdk 'build-tools\35.0.0'
$jar = Join-Path $sdk 'platforms\android-35\android.jar'
$env:JAVA_HOME = Join-Path $tools 'jdk'
$javac = Join-Path $env:JAVA_HOME 'bin\javac.exe'
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
$adb = Join-Path $tools 'platform-tools\adb.exe'

$out = Join-Path $here 'build'
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\gen", "$out\classes", "$out\dex" | Out-Null
function Assert-Ok($what) { if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)" } }

# voice (Vosk + JNA + the speech model), fetched by setup-voice.ps1 into tools/voice
$voice = Join-Path $tools 'voice'
if (-not (Test-Path (Join-Path $voice 'assets\model-en-us\uuid'))) { throw 'voice parts missing: run .\android\setup-voice.ps1 once' }
$voiceJars = @(Get-ChildItem (Join-Path $voice 'jars') -Filter *.jar | ForEach-Object FullName)
# androidx.webkit 1.12.1 (tools/webkit, fetched from Google's Maven: WebSettingsCompat, the X-Requested-With allow-list)
$webkitJars = @(Join-Path $tools 'webkit\webkit-classes.jar')
if (-not (Test-Path $webkitJars[0])) { throw 'androidx.webkit missing: see tools/webkit (webkit-1.12.1.aar, classes.jar)' }

# 1. resources and manifest
& "$bt\aapt2.exe" compile --dir (Join-Path $here 'res') -o "$out\res.zip"; Assert-Ok 'aapt2 compile'
& "$bt\aapt2.exe" link -o "$out\base.apk" -I $jar --manifest (Join-Path $here 'AndroidManifest.xml') --java "$out\gen" "$out\res.zip"; Assert-Ok 'aapt2 link'

# 2. java -> class files
$srcs = @(Get-ChildItem (Join-Path $here 'src'), "$out\gen" -Recurse -Filter *.java | ForEach-Object FullName)
& $javac -nowarn -Xlint:-options -source 17 -target 17 -encoding UTF-8 -cp (@($jar) + $voiceJars + $webkitJars -join ';') -d "$out\classes" @srcs; Assert-Ok 'javac'

# 3. class files (+ the voice libraries) -> classes.dex
# (packed into one jar first: listing every .class file overflows Windows' command-line limit)
& (Join-Path $env:JAVA_HOME 'bin\jar.exe') -cf "$out\app-classes.jar" -C "$out\classes" .; Assert-Ok 'jar'
& "$bt\d8.bat" --release --min-api 28 --lib $jar --output "$out\dex" "$out\app-classes.jar" @voiceJars @webkitJars; Assert-Ok 'd8'

# 4. put the dex into the apk, align, sign
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
Copy-Item "$out\base.apk" "$out\unsigned.apk"
$zip = [IO.Compression.ZipFile]::Open("$out\unsigned.apk", 'Update')
[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\dex\classes.dex", 'classes.dex', [IO.Compression.CompressionLevel]::NoCompression)
foreach ($so in Get-ChildItem (Join-Path $voice 'lib\arm64-v8a') -Filter *.so) {   # native speech recogniser (64-bit ARM tablets)
  [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $so.FullName, "lib/arm64-v8a/$($so.Name)", [IO.Compression.CompressionLevel]::Optimal)
}
# the speech model as assets (added here, not by aapt2 -A, which writes '\' into the paths on Windows),
# plus the app's own assets in android/assets (e.g. the recogniser's warm-up audio)
foreach ($root in (Join-Path $voice 'assets'), (Join-Path $here 'assets')) {
  if (-not (Test-Path $root)) { continue }
  $assetRoot = (Resolve-Path $root).Path
  foreach ($f in Get-ChildItem $assetRoot -Recurse -File) {
    $rel = 'assets/' + $f.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
  }
}
$zip.Dispose()
& "$bt\zipalign.exe" -p -f 4 "$out\unsigned.apk" "$out\aligned.apk"; Assert-Ok 'zipalign'

# the app's signing key: made once, kept next to this script (updates must be signed with the same key)
$ks = Join-Path $here 'hub.keystore'
if (-not (Test-Path $ks)) {
  $ErrorActionPreference = 'Continue'   # keytool chats on stderr
  & $keytool -genkeypair -keystore $ks -alias hub -storepass hubkiosk -keypass hubkiosk -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Claude Hub' 2>&1 | Out-Null
  Assert-Ok 'keytool'
  $ErrorActionPreference = 'Stop'
}
$apk = Join-Path $out 'claude-hub.apk'
& "$bt\apksigner.bat" sign --ks $ks --ks-pass pass:hubkiosk --key-pass pass:hubkiosk --out $apk "$out\aligned.apk"; Assert-Ok 'apksigner'
Write-Host ("built {0} ({1:N0} KB)" -f $apk, ((Get-Item $apk).Length / 1KB))

if ($Install) {
  $sel = if ($Device) { @('-s', $Device) } else { @() }
  & $adb @sel install -r $apk; Assert-Ok 'adb install'
  & $adb @sel shell am start -n hub.kiosk/.MainActivity | Out-Null
  Write-Host 'installed and started'
}
