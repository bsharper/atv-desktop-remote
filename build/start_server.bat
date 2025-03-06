@echo off
set INSTALL_LOG=atv_pip_install.log
set MY_PATH=%~dp0
cd /d %MY_PATH%

if not exist env (
    echo ATVRemote - Python install started %DATE% %TIME% >> %INSTALL_LOG%
    echo > setting_up_python
    
    REM Check if uv is installed (it's much faster)
    where uv >nul 2>&1
    if not errorlevel 1 (
        echo Using uv for virtual environment setup >> %INSTALL_LOG%
        uv venv env >> %INSTALL_LOG% 2>&1
        call env\Scripts\activate.bat
        uv pip install websockets pyatv >> %INSTALL_LOG% 2>&1
    ) else (
        echo Using standard Python venv >> %INSTALL_LOG%
        python -m venv env >> %INSTALL_LOG% 2>&1
        call env\Scripts\activate.bat
        python -m pip install --upgrade pip >> %INSTALL_LOG% 2>&1
        python -m pip install websockets pyatv >> %INSTALL_LOG% 2>&1
    )

    echo ATVRemote - Python install ended %DATE% %TIME% >> %INSTALL_LOG%
    echo ================================================== >> %INSTALL_LOG%
) else (
    call env\Scripts\activate.bat
)

:kill_proc
for /f "tokens=2 delims= " %%A in ('tasklist /FI "IMAGENAME eq python.exe" /NH') do (
    tasklist /FI "WINDOWTITLE eq wsserver.py" | findstr wsserver.py >nul
    if not errorlevel 1 (
        echo Killing %%A
        taskkill /PID %%A /F
    )
)
if exist setting_up_python del setting_up_python
python wsserver.py
