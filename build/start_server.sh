#!/bin/bash
INSTALL_LOG="atv_pip_install.log"
MY_PATH=$(dirname "$0")
cd "$MY_PATH"
if [[ ! -d env ]]; then
    dt=$(date)
    echo "ATVRemote - Python install started $dt" >> $INSTALL_LOG
    touch setting_up_python
    
    # Check if uv is installed (it's faster in my testing)
    if command -v uv &> /dev/null; then
        echo "Using uv for virtual environment setup" >> $INSTALL_LOG
        uv venv env | tee -a $INSTALL_LOG
        source env/bin/activate
        if [[ -f requirements.txt ]]; then
            echo "Installing from requirements.txt" >> $INSTALL_LOG
            uv pip install -r requirements.txt | tee -a $INSTALL_LOG
        else
            echo "Installing websockets and pyatv" >> $INSTALL_LOG
            uv pip install websockets pyatv | tee -a $INSTALL_LOG
        fi
        
    else
        echo "Using standard Python venv" >> $INSTALL_LOG
        python3 -m venv env | tee -a $INSTALL_LOG
        source env/bin/activate
        python -m pip install --upgrade pip | tee -a $INSTALL_LOG
        if [[ -f requirements.txt ]]; then
            echo "Installing from requirements.txt" >> $INSTALL_LOG
            python -m pip install -r requirements.txt | tee -a $INSTALL_LOG
        else
            echo "Installing websockets and pyatv" >> $INSTALL_LOG
            python -m pip install websockets pyatv | tee -a $INSTALL_LOG
        fi
    fi
    
    dt=$(date)
    echo "ATVRemote - Python install ended $dt" >> $INSTALL_LOG
    echo "==================================================" >> $INSTALL_LOG
else
    source env/bin/activate
fi

function kill_proc () {
    for p in $(ps ax | grep -v grep | grep wsserver.py | awk '{print $1}'); do
        echo "Killing $p"
        kill $1 $p
    done
}
kill_proc
kill_proc "-9"
[[ -f setting_up_python ]] && rm setting_up_python
python wsserver.py