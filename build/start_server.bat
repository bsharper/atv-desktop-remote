@echo off
cd "%~dp0"

IF NOT EXIST env (
    echo > setting_up_python
    python -m venv env
    call env\Scripts\activate.bat
    pip install --upgrade pip
) ELSE (
    call env\Scripts\activate.bat
)

:: Killing process wsserver.py
FOR /F "tokens=2 delims=," %%i IN ('tasklist /nh /fi "imagename eq python.exe" /fo csv ^| findstr /i "wsserver.py"') DO (
    echo Killing process: %%i
    taskkill /PID %%i
)

pip install -q websockets pyatv

IF EXIST setting_up_python (
    del setting_up_python
)

python wsserver.py