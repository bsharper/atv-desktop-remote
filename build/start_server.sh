#!/bin/bash
INSTALL_LOG="atv_pip_install.log"
MY_PATH=$(dirname "$0")
cd "$MY_PATH"
ENV_DIR="env"
if [[ $(arch) == "i386" ]]; then
	ENV_DIR="env_x86"
fi
if [[ ! -d $ENV_DIR ]]; then
	dt=$(date)
	echo "ATVRemote - Python install started $dt" >> $INSTALL_LOG
	touch setting_up_python
	python3 -m venv $ENV_DIR | tee -a $INSTALL_LOG
	source $ENV_DIR/bin/activate
	python -m pip install --upgrade pip | tee -a $INSTALL_LOG
	python -m pip install websockets pyatv | tee -a $INSTALL_LOG
	dt=$(date)
	echo "ATVRemote - Python install ended $dt" >> $INSTALL_LOG
	echo "==================================================" >> $INSTALL_LOG
else
	source $ENV_DIR/bin/activate
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
