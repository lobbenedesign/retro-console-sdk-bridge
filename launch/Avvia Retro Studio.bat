@echo off
rem 🚀 Launcher Windows del Retro Console SDK Bridge (doppio-clic da Esplora risorse)
rem
rem Avvia il server Bun reale e apre il browser sullo studio.
rem Nessuna app finta: se Bun manca, dice davvero come installarlo.
rem Nota onesta: questo launcher e' stato scritto per Windows ma verificato
rem solo a livello di sintassi su macOS (nessuna macchina Windows disponibile
rem in questa sessione) — la logica e' la stessa del .command macOS.

setlocal
cd /d "%~dp0.."
set "URL=http://localhost:3014"

echo ======================================================
echo 🎮 Retro Console SDK Bridge - launcher Windows
echo    cartella: %CD%
echo ======================================================

rem 1. Bun installato?
where bun >nul 2>nul
if errorlevel 1 (
  echo.
  echo ✗ Bun non risulta installato su questo PC.
  echo   Installalo davvero con PowerShell, poi riapri questo file:
  echo.
  echo     powershell -c "irm bun.sh/install.ps1 | iex"
  echo.
  echo   (oppure scarica l'installer da https://bun.sh )
  echo.
  pause
  exit /b 1
)

rem 2. Dipendenze installate?
if not exist node_modules (
  echo 📦 Prima esecuzione: installo le dipendenze reali...
  call bun install
  if errorlevel 1 (
    echo ✗ bun install fallito.
    pause
    exit /b 1
  )
)

rem 3. Server gia' avviato? apri e basta
curl -s -o nul --max-time 1 %URL%
if not errorlevel 1 (
  echo ✓ Server gia' attivo su %URL% - apro il browser.
  start "" %URL%
  timeout /t 2 >nul
  exit /b 0
)

rem 4. Avvio reale: server in una finestra dedicata + browser
echo 🚀 Avvio il server reale in una finestra dedicata...
start "Retro Console SDK Bridge - server (chiudi per spegnere)" cmd /c "bun server.ts"

timeout /t 3 /nobreak >nul
start "" %URL%

echo.
echo Lo studio e' su: %URL%
echo Il server gira nella finestra dedicata: chiudila per spegnere.
echo ======================================================
timeout /t 5 >nul
endlocal
