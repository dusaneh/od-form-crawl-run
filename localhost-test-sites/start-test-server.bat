@echo off
setlocal
title Scraper Test Sites

:: ---------------------------------------------------------------------------
:: Usage:  start-test-server.bat [port] [repo-root]
::
:: This script can live ANYWHERE. It finds the scraper repo in this order:
::   1. second argument                e.g.  start-test-server.bat 9000 D:\code\scraper
::   2. SCRAPER_ROOT environment variable
::   3. its own parent folder (when this folder sits inside the repo)
::   4. the absolute default below
::
:: If a test-site server is already running (detected by probing /registry on
:: ports 9000-9099), it is reused - a second instance is NOT started.
:: ---------------------------------------------------------------------------
set "DEFAULT_ROOT=C:\pp2\scraper"

set "ROOT="
if not "%~2"=="" set "ROOT=%~f2"
if not defined ROOT if defined SCRAPER_ROOT set "ROOT=%SCRAPER_ROOT%"
if not defined ROOT (
    for %%i in ("%~dp0..") do if exist "%%~fi\test_sites\server.py" set "ROOT=%%~fi"
)
if not defined ROOT set "ROOT=%DEFAULT_ROOT%"

echo.
echo  ==========================================
echo   Scraper Test Sites
echo  ==========================================
echo.
echo  [.] Repo root: %ROOT%

if not exist "%ROOT%\test_sites\server.py" (
    echo  [!] "%ROOT%\test_sites\server.py" not found.
    echo      Pass the repo root as the 2nd argument, e.g.:
    echo        start-test-server.bat 9000 C:\pp2\scraper
    echo      or set SCRAPER_ROOT before running.
    pause & exit /b 1
)
if not exist "%ROOT%\.venv\Scripts\python.exe" (
    echo  [!] .venv not found at "%ROOT%\.venv". Run setup.ps1 first.
    pause & exit /b 1
)

:: ---- Reuse a running instance instead of starting a second one -----
:: A port counts as "ours" only if GET /registry answers with site data -
:: a random app squatting on a port in the range is not mistaken for it.
set "PORT=%~1"
set "RUNNING="
set "STATE="

if defined PORT (
    for /f %%s in ('powershell -noprofile -command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://127.0.0.1:%PORT%/registry')).Content -match 'site_') { 'ours' } else { 'other' } } catch { 'other' } } else { 'free' }"') do set "STATE=%%s"
) else (
    echo  [.] Checking for a running instance...
    for /f %%p in ('powershell -noprofile -command "$lp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 9000 -and $_.LocalPort -le 9099 } | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object; foreach ($p in $lp) { try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 ('http://127.0.0.1:' + $p + '/registry')).Content -match 'site_') { $p; break } } catch {} }"') do set "RUNNING=%%p"
)

if "%STATE%"=="ours" set "RUNNING=%PORT%"
if "%STATE%"=="other" (
    echo  [!] Port %PORT% is already in use by something that is NOT the test-site
    echo      server. Pick another port or stop that process first.
    pause & exit /b 1
)

if defined RUNNING (
    echo  [+] Test sites ALREADY RUNNING at http://localhost:%RUNNING% - not starting another.
    start "" "http://localhost:%RUNNING%"
    echo.
    echo  ==========================================
    echo   Test Sites : http://localhost:%RUNNING%
    echo   Registry   : http://localhost:%RUNNING%/registry
    echo  ==========================================
    echo.
    exit /b 0
)

:: ---- Port: use the first argument if given, else find a free one ---
if not defined PORT (
    echo  [.] Finding available port...
    for /f %%p in ('powershell -noprofile -command "9000..9099 | foreach { if (-not (Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue)) { $_; break } }"') do set "PORT=%%p"
)
if not defined PORT (
    echo  [!] No free port found in range 9000-9099.
    pause & exit /b 1
)
echo  [+] Using port %PORT%
echo.

:: ---- Write a temp launch script -----------------------------------
set "LAUNCH=%TEMP%\scraper_test_sites_%PORT%.bat"
(
    echo @echo off
    echo title Test Sites :: %PORT%
    echo cd /d "%ROOT%\test_sites"
    echo echo  Test sites running at http://localhost:%PORT%
    echo echo  Press Ctrl+C to stop.
    echo echo.
    echo "%ROOT%\.venv\Scripts\python.exe" -m uvicorn server:app --port %PORT% --log-level warning
    echo pause
) > "%LAUNCH%"

:: ---- Launch in a new window and open browser ----------------------
start "Test Sites :: %PORT%" cmd /k ""%LAUNCH%""

echo  [.] Waiting for server to start...
timeout /t 4 /nobreak > nul
start "" "http://localhost:%PORT%"

echo.
echo  ==========================================
echo   Test Sites : http://localhost:%PORT%
echo   Registry   : http://localhost:%PORT%/registry
echo  ==========================================
echo.
echo  NOTE: If the backend is on a non-default port, pass it to
echo        run_validation.py by editing BACKEND at the top of that file.
echo.
echo  Close the test sites window to stop the server.
echo.
