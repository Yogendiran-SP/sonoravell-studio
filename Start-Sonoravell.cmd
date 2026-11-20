@echo off
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 (
    py -3 launch.py
    if errorlevel 1 pause
    exit /b
)
where python >nul 2>&1
if not errorlevel 1 (
    python launch.py
    if errorlevel 1 pause
    exit /b
)
start "" "%~dp0Sonoravell.html"
