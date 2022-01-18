#!/bin/bash
MY_PATH=$(dirname "$0")
cd "$MY_PATH"
function kill_proc () {
for p in $(ps ax | grep -v grep | grep wsserver.py | awk '{print $1}'); do
    echo "Killing $p"
    kill $1 $p
done
}
kill_proc
kill_proc "-9"
python3 -m pip install -q --user websockets pyatv
python3 wsserver.py
