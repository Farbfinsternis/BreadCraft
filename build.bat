@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  BreadCraft build script
rem  Prompts for a version (x.y.z), writes it into package.json,
rem  then builds the app via electron-vite.
rem ============================================================

cd /d "%~dp0"

set "VERSION="
set /p "VERSION=BreadCraft-Version fuer diesen Build (x.y.z): "

if "%VERSION%"=="" (
  echo Keine Version eingegeben. Abbruch.
  exit /b 1
)

rem Validate + write the version (Node helper does the x.y.z check).
node scripts\set-version.mjs "%VERSION%"
if errorlevel 1 (
  echo Versionspruefung fehlgeschlagen. Abbruch.
  exit /b 1
)

echo.
echo === Build %VERSION% startet ===
call npm run build
if errorlevel 1 (
  echo.
  echo Build FEHLGESCHLAGEN.
  exit /b 1
)

echo.
echo === Build %VERSION% erfolgreich ===
endlocal
