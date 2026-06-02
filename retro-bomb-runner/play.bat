@echo off
chcp 65001 >nul
title Retro Bomb Runner

echo.
echo  +--------------------------+
echo  ^|   RETRO BOMB RUNNER      ^|
echo  +--------------------------+
echo.

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  LOI: Chua cai Node.js.
  echo  Tai ve tai: https://nodejs.org
  echo  Cai xong, chay lai file nay.
  echo.
  pause
  exit /b 1
)

echo  Dang khoi dong server...
echo  De thoat: Nhan Ctrl+C trong cua so nay.
echo.

node server.cjs
pause
