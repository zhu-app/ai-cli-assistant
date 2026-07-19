@echo off
title AI CLI - Fix Workspace Links
setlocal enabledelayedexpansion
cd /d %~dp0

echo ============================================
echo   AI CLI Assistant - Link Repair Tool
echo ============================================
echo.

node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

echo [1/3] Checking workspace links...
echo.
set "BROKEN=0"
for %%p in (shared tools server cli) do (
    if exist "node_modules\@ai-cli\%%p" (
        dir "node_modules\@ai-cli\%%p\package.json" >nul 2>&1
        if errorlevel 1 (
            echo   [BROKEN] @ai-cli/%%p
            set "BROKEN=1"
        ) else (
            echo   [OK] @ai-cli/%%p
        )
    ) else (
        echo   [MISSING] @ai-cli/%%p
        set "BROKEN=1"
    )
)

if !BROKEN! equ 0 (
    echo.
    echo [OK] All workspace links are working correctly.
    echo.
    pause
    exit /b 0
)

echo.
echo [2/3] Cleaning old @ai-cli workspace links...
if exist node_modules\@ai-cli (
    rmdir /s /q node_modules\@ai-cli
    if errorlevel 1 (
        echo [ERROR] Cannot delete node_modules\@ai-cli
        echo Please close other programs and try again.
        pause
        exit /b 1
    )
    echo [OK] Cleaned
) else (
    echo [SKIP] Nothing to clean
)

echo.
echo [3/3] Reinstalling workspace links...
call npm install --no-fund --no-audit --install-strategy=nested
if errorlevel 1 (
    echo [ERROR] Failed to rebuild links
    pause
    exit /b 1
)

echo.
echo [OK] All workspace links fixed!
echo Current path: %~dp0
echo.
echo Now run start.bat to launch the application.
echo.
pause
