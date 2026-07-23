@echo off
chcp 65001 >nul
title AI CLI Assistant
cd /d %~dp0

node -v >nul 2>&1 || (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)

REM Check if workspace symlinks are broken (project was moved)
dir "node_modules\@ai-cli\shared\package.json" >nul 2>&1
if errorlevel 1 (
    if exist "node_modules" (
        echo [FIX] Workspace links broken, repairing...
    )
    call npm install --no-fund --no-audit --install-strategy=nested >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

if not exist "packages\cli\dist\index.js" (
    call npm run build >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Build failed
        pause
        exit /b 1
    )
)

node packages\cli\dist\index.js
pause
