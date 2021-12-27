@echo off 
cd "%~dp0"
python -m pip install --user pyatv websockets
python "%~dp0wsserver.py"