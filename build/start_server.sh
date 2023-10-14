#!/bin/bash
MY_PATH=$(dirname "$0")
cd "$MY_PATH"
if [[ ! -d env ]]; then
	touch setting_up_python
	python3 -m venv env
	source env/bin/activate
	pip install --upgrade pip	
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
python -m pip install -q websockets pyatv
[[ -f setting_up_python ]] && rm setting_up_python
python wsserver.py
