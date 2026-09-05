param(
  [string]$Serial = $env:ANDROID_SERIAL
)

$ErrorActionPreference = "Stop"

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  Write-Host "`n==> $Description" -ForegroundColor Cyan
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Find-SdkRoot {
  $candidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
    (Join-Path $env:LOCALAPPDATA "Kandora\android-sdk")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate "platform-tools\adb.exe")) {
      return $candidate
    }
  }

  throw "Android SDK not found. Set ANDROID_HOME or install Android platform-tools."
}

function Find-JavaHome {
  $candidates = @(
    $env:JAVA_HOME,
    (Join-Path $env:LOCALAPPDATA "Kandora\jdk-21")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate "bin\java.exe")) {
      return $candidate
    }
  }

  throw "Java 21 not found. Set JAVA_HOME to a JDK accepted by the Android build."
}

function Get-ConnectedDevices {
  param(
    [Parameter(Mandatory = $true)]
    [string]$AdbPath
  )

  $lines = & $AdbPath devices -l
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list Android devices."
  }

  $devices = @()
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    if ($line -match "^(?<serial>\S+)\s+(?<state>\S+)(?:\s+(?<details>.*))?$") {
      $devices += [PSCustomObject]@{
        Serial = $Matches.serial
        State = $Matches.state
        Details = $Matches.details
      }
    }
  }
  return $devices
}

function Get-Sha256Hash {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $stream = [System.IO.File]::OpenRead($Path)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString(
      $algorithm.ComputeHash($stream)
    ).Replace("-", "")
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$previousLocation = Get-Location

try {
  Set-Location $repoRoot

  $sdkRoot = Find-SdkRoot
  $javaHome = Find-JavaHome
  $env:ANDROID_HOME = $sdkRoot
  $env:ANDROID_SDK_ROOT = $sdkRoot
  $env:JAVA_HOME = $javaHome

  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
  $adb = Join-Path $sdkRoot "platform-tools\adb.exe"
  $gradle = Join-Path $repoRoot "android\gradlew.bat"
  $apk = Join-Path $repoRoot "android\app\build\outputs\apk\debug\app-debug.apk"

  Invoke-External $npx @(
    "vitest",
    "run",
    "mobile/src/App.spec.ts",
    "mobile/src/auth/nativeDeepLinks.spec.ts"
  ) "Verify mobile shell and auth callback"
  Invoke-External $npm @("run", "mobile:build") "Build mobile web assets"
  Invoke-External $npx @("cap", "copy", "android") "Copy assets into Android"
  Invoke-External $gradle @(
    "-p",
    (Join-Path $repoRoot "android"),
    ":app:assembleDebug",
    "--rerun-tasks"
  ) "Assemble debug APK"

  if (!(Test-Path $apk)) {
    throw "APK was not produced at $apk."
  }

  $devices = @(Get-ConnectedDevices $adb)
  $readyDevices = @($devices | Where-Object { $_.State -eq "device" })

  if ($Serial) {
    $target = $readyDevices | Where-Object { $_.Serial -eq $Serial }
    if (!$target) {
      throw "Android target '$Serial' is not connected and ready. Run '$adb devices -l'."
    }
  } elseif ($readyDevices.Count -eq 1) {
    $Serial = $readyDevices[0].Serial
  } elseif ($readyDevices.Count -eq 0) {
    $states = if ($devices.Count -gt 0) {
      ($devices | ForEach-Object { "$($_.Serial) ($($_.State))" }) -join ", "
    } else {
      "none"
    }
    throw "No ready Android device or emulator found (detected: $states). Start an emulator or enable USB debugging."
  } else {
    $choices = ($readyDevices | ForEach-Object { $_.Serial }) -join ", "
    throw "Multiple Android targets are connected: $choices. Re-run with '-- -Serial <serial>'."
  }

  Invoke-External $adb @("-s", $Serial, "wait-for-device") "Wait for $Serial"
  Invoke-External $adb @("-s", $Serial, "install", "-r", $apk) "Install APK on $Serial"

  Write-Host "`n==> Verify mobile auth callback on $Serial" -ForegroundColor Cyan
  $callbackHandler = @(& $adb @(
    "-s",
    $Serial,
    "shell",
    "cmd",
    "package",
    "resolve-activity",
    "--brief",
    "-a",
    "android.intent.action.VIEW",
    "-c",
    "android.intent.category.BROWSABLE",
    "-d",
    "kandora://auth/complete?code=probe"
  ))
  if (
    $LASTEXITCODE -ne 0 -or
    $callbackHandler -notcontains "com.kandora.app/.MainActivity"
  ) {
    throw "Installed APK does not handle the mobile authentication callback."
  }

  Invoke-External $adb @(
    "-s",
    $Serial,
    "shell",
    "am",
    "start",
    "-n",
    "com.kandora.app/.MainActivity"
  ) "Launch Kandora"

  $hash = Get-Sha256Hash $apk
  Write-Host "`nKandora installed and launched on $Serial." -ForegroundColor Green
  Write-Host "APK: $apk"
  Write-Host "SHA-256: $hash"
} finally {
  Set-Location $previousLocation
}