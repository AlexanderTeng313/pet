@echo off
REM One-click launcher for PetPet viewer (runs local main.js via electron)
cd /d "%~dp0"
if not exist "node_modules\.bin\electron.cmd" (
  echo [error] electron not installed. Run: cd viewer ^&^& npm install
  pause
  exit /b 1
)
echo Starting PetPet viewer from source...
call node_modules\.bin\electron.cmd .
