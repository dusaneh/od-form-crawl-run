@echo off
setlocal

cd /d "%~dp0"
title FormWeave Local Server

echo.
echo FormWeave safe restart
echo Project: %CD%
echo.

if not exist "package.json" (
  echo ERROR: package.json was not found in %CD%.
  exit /b 1
)

if not exist "node_modules" (
  echo ERROR: node_modules is missing. Run npm install first.
  exit /b 1
)

echo Checking FormWeave ports 3000 and 8787...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(3000, 8787); $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }); $processIds = @($listeners.OwningProcess | Sort-Object -Unique); if ($processIds.Count -gt 0) { Write-Host ('Stopping existing listener PID(s): ' + ($processIds -join ', ')); $processIds | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; for ($attempt = 0; $attempt -lt 20; $attempt++) { Start-Sleep -Milliseconds 250; $remaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }); if ($remaining.Count -eq 0) { break } } }; $remaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }); if ($remaining.Count -gt 0) { $details = ($remaining | ForEach-Object { 'port ' + $_.LocalPort + ' (PID ' + $_.OwningProcess + ')' }) -join ', '; Write-Error ('Could not release FormWeave ports: ' + $details); exit 1 }"

if errorlevel 1 (
  echo.
  echo Restart aborted because a required port could not be released.
  exit /b 1
)

echo Ports are clear. Starting the current FormWeave checkout...
echo Open http://127.0.0.1:3000/ after startup completes.
echo Press Ctrl+C in this window to stop FormWeave.
echo.

call npm run local
set "FORMWEAVE_EXIT=%ERRORLEVEL%"

echo.
echo FormWeave stopped with exit code %FORMWEAVE_EXIT%.
exit /b %FORMWEAVE_EXIT%
