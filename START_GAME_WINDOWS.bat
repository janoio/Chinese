@echo off
title Chinese Poker Live - Start Game
cd /d "%~dp0"
echo.
echo ========================================
echo   Chinese Poker Live - Starting...
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  echo Then close this window and double-click this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please reinstall Node.js and keep the default options.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing game files. This can take 1-2 minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Send a screenshot of this window.
    pause
    exit /b 1
  )
) else (
  echo Game files already installed.
)

echo.
echo Opening the game in your browser...
echo Keep this black window open while you play.
echo To stop the game later, close this window or press CTRL+C.
echo.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"
call npm start

echo.
echo The server stopped.
pause
