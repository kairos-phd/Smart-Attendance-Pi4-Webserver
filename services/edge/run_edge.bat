@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
    call "%~dp0.venv\Scripts\activate.bat"
) else if exist "%~dp0..\backend\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0..\backend\.venv\Scripts\python.exe"
    call "%~dp0..\backend\.venv\Scripts\activate.bat"
) else if exist "%~dp0..\..\services\backend\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0..\..\services\backend\.venv\Scripts\python.exe"
    call "%~dp0..\..\services\backend\.venv\Scripts\activate.bat"
) else (
    echo Virtual environment not found. Creating in %~dp0.venv...
    py -3.11 -m venv .venv 2>nul || py -3 -m venv .venv 2>nul || python -m venv .venv
    if not exist ".venv\Scripts\activate.bat" (
        echo Error: Failed to create virtual environment. Ensure Python is installed.
        pause
        exit /b 1
    )
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -e .
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
)

"%PYTHON_EXE%" -m attendance_edge.main %*
if errorlevel 1 (
    echo.
    echo Edge service terminated with error code %errorlevel%.
    pause
)
