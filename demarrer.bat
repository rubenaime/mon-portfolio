@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js est introuvable sur cet ordinateur.
  echo  Installez Node.js depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   PORTFOLIO RUBEN EBAH
echo  ============================================
echo   Site public : http://127.0.0.1:4173/
echo   Admin       : http://127.0.0.1:4173/admin
echo  ============================================
echo   Fermez cette fenetre pour arreter le serveur.
echo.

start "" "http://127.0.0.1:4173/"
node server.js

echo.
echo  Le serveur s'est arrete.
pause
