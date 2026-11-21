# 공식 Gradle 배포본을 사용자 캐시에 받고, 공식 SHA-256 값과 대조한 뒤 실행합니다.
# 최초 실행에만 인터넷이 필요합니다. 서드파티 앱 라이브러리는 설치하지 않습니다.
$ErrorActionPreference = 'Stop'
$gradleVersion = '8.9'
$gradleCache = Join-Path $env:LOCALAPPDATA 'SeoulTrail\gradle'
$gradleBin = Join-Path $gradleCache "gradle-$gradleVersion\bin\gradle.bat"
if (!(Test-Path -LiteralPath $gradleBin)) {
    New-Item -ItemType Directory -Force -Path $gradleCache | Out-Null
    $gradleZip = Join-Path $gradleCache "gradle-$gradleVersion-bin.zip"
    $gradleUrl = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
    Write-Host 'Downloading official Gradle build tool...'
    Invoke-WebRequest -Uri $gradleUrl -OutFile $gradleZip -UseBasicParsing
    $checksumContent = (Invoke-WebRequest -Uri "$gradleUrl.sha256" -UseBasicParsing).Content
    $expected = if ($checksumContent -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($checksumContent).Trim() } else { $checksumContent.Trim() }
    if ((Get-FileHash -LiteralPath $gradleZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()) { throw 'Gradle checksum mismatch.' }
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $gradleCache -Force
}
Push-Location -LiteralPath $PSScriptRoot
try { & $gradleBin @args; $gradleExit = $LASTEXITCODE } finally { Pop-Location }
exit $gradleExit
