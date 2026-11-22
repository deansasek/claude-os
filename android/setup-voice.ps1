# Fetches what voice needs into tools/voice (nothing is installed on the PC):
#   - Vosk for Android (offline speech recognition, Apache 2.0) and JNA, which it uses, from Maven Central
#   - a small English Vosk model (~40 MB), from alphacephei.com
# build.ps1 picks these up when they are there: the jars go on the classpath, the arm64 .so files
# into the APK's lib/, and the model into the APK's assets (unpacked on the tablet on first use).
#
# -Model picks another Vosk model, e.g. the larger, more accurate (and ~4x bigger) one:
#   .\android\setup-voice.ps1 -Model vosk-model-en-us-0.22-lgraph
param([string]$Model = 'vosk-model-small-en-us-0.15')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tools = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools'
$voice = Join-Path $tools 'voice'
$dl = Join-Path $voice 'download'
New-Item -ItemType Directory -Force $dl | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @(
  @{ url = 'https://repo1.maven.org/maven2/com/alphacephei/vosk-android/0.3.75/vosk-android-0.3.75.aar'; name = 'vosk-android.aar' },
  @{ url = 'https://repo1.maven.org/maven2/net/java/dev/jna/jna/5.18.1/jna-5.18.1.aar'; name = 'jna.aar' },
  @{ url = "https://alphacephei.com/vosk/models/$Model.zip"; name = "$Model.zip" }
)
foreach ($f in $files) {
  $to = Join-Path $dl $f.name
  if (-not (Test-Path $to)) { Write-Host "downloading $($f.url)"; Invoke-WebRequest $f.url -OutFile $to -UseBasicParsing }
}

# pull single entries out of a zip (paths here are long; whole-archive extraction trips Windows' limit)
function Export-Entries($zipPath, [scriptblock]$map) {
  $z = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($e in $z.Entries) {
      if (-not $e.Name) { continue }
      $to = & $map $e.FullName
      if (-not $to) { continue }
      New-Item -ItemType Directory -Force (Split-Path $to -Parent) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $to, $true)
    }
  } finally { $z.Dispose() }
}

# classes.jar + jni/arm64-v8a/*.so from each AAR
$lib = Join-Path $voice 'lib\arm64-v8a'; $jars = Join-Path $voice 'jars'
foreach ($aar in 'vosk-android', 'jna') {
  Export-Entries (Join-Path $dl "$aar.aar") {
    param($n)
    if ($n -eq 'classes.jar') { return Join-Path $jars "$aar.jar" }
    if ($n -like 'jni/arm64-v8a/*.so') { return Join-Path $lib (Split-Path $n -Leaf) }
  }
}

# the model goes into assets/model-en-us, with a uuid file so the app knows when it changed
$assets = Join-Path $voice 'assets'
Remove-Item -Recurse -Force $assets -ErrorAction SilentlyContinue
$modelDir = Join-Path $assets 'model-en-us'
$top = $null
Export-Entries (Join-Path $dl "$Model.zip") {
  param($n)
  $i = $n.IndexOf('/'); if ($i -lt 0) { return $null }
  $script:top = $n.Substring(0, $i)
  return Join-Path $modelDir ($n.Substring($i + 1) -replace '/', '\')
}
Set-Content -Encoding ascii (Join-Path $modelDir 'uuid') $top
Write-Host "voice tools ready in $voice"
