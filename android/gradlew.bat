@echo off
setlocal
powershell.exe -NoProfile -File "%~dp0gradle-bootstrap.ps1" %*
exit /b %errorlevel%
