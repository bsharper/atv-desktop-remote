const WebSocket = require('ws').WebSocket
const EventEmitter = require('events');

// WebSocketClient.prototype.reconnect = function(e) {
//     console.log(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`, e);
//     this.instance.removeAllListeners();
//     var that = this;
//     setTimeout(function() {
//         console.log("WebSocketClient: reconnecting...");
//         that.open(that.url);
//     }, this.autoReconnectInterval);
// }


var ws = false;

var ws_timeout = false;
var ws_watchdog = false;
var scanWhenOpen = false;
var ws_connecting = false;
var ws_connected = false;
var ws_start_tm = false;
var connection_failure = false;
var atv_connected = false;
var ws_pairDevice = "";

var ws_url = 'ws://localhost:8765'

var atv_events = new EventEmitter();
var pending = []

var ws_timeout_interval = 800;

function sendMessage(command, data) {
    if (typeof data == "undefined") data = "";
    if (!ws) {
        pending.push([command, data]);
        return;
    }
    while (pending.length > 0) {
        var cmd_ar = pending.shift();
        ws.send(JSON.stringify({ cmd: cmd_ar[0], data: cmd_ar[1] }))
    }
    console.log(`sendMessage: {cmd:${command}, data:${data}}`)
    ws.send(JSON.stringify({ cmd: command, data: data }))
}

function killServer() {
    var lws = new WebSocket(ws_url, {
        perMessageDeflate: false
    });

    lws.once('open', function open() {
        lws.send(JSON.stringify({ cmd: 'quit' }))
    });
}

function reconnect() {
    if (ws_timeout) return;
    ws_timeout = setTimeout(() => {
        ws_timeout = false;
        try {
            if (ws) ws.removeAllListeners();
        } catch (ex) {}

        startWebsocket();
    }, ws_timeout_interval)
}

function startWebsocket() {
    ws = new WebSocket(ws_url, {
        perMessageDeflate: false
    });

    ws.once('open', function open() {
        ws_connected = true;
        console.log('ws open');
        if (scanWhenOpen) ws_startScan();
        //sendMessage("scan");
        checkEnv();
        init().then(() => {
            console.log('init complete');
        })
    });

    ws.on('close', function close(code, reason) {
        ws_connected = false;
        reconnect();
        switch (code) {
            case 1000: //  1000 indicates a normal closure, meaning that the purpose for which the connection was established has been fulfilled.
                console.log("WebSocket: closed");
                break;
            default: // Abnormal closure
                console.log("WebSocket: closed abnormally");
                break;
        }
    });

    ws.on('message', function message(data) {
        console.log('received: %s', data);
        var j = JSON.parse(data);
        if (j.command == "scanResult") {
            console.log(`Results: ${j.data}`)
            createDropdown(j.data);
        }
        if (j.command == "pairCredentials") {
            console.log("pairCredentials", ws_pairDevice, j.data);
            saveRemote(ws_pairDevice, j.data);
            localStorage.setItem('atvcreds', JSON.stringify(getCreds(pairDevice)));
            connectToATV();
        }
        if (j.command == "connected") {
            atv_connected = true;
            connection_failure = false;
            atv_events.emit("connected", atv_connected);
        }
        if (j.command == "is_connected") {
            console.log('got_is_connected');
            atv_connected = !!(j.data)
            atv_events.emit("connected", atv_connected);
        }
        if (j.command == "connection_failure") {
            console.log(`connection_failure: ${j.data}`)
            atv_connected = false;
            connection_failure = true;
            atv_events.emit("connection_failure", j.data)
        }
        if (j.command == "startPair2") {
            $("#pairStepNum").html("2");
            $("#pairProtocolName").html("Companion");
        }
        if (j.command == "current-text") {
            console.log(`current text: ${j.data}`)
            ipcRenderer.invoke('current-text', j.data);
        }
        if (j.command == "kbfocus-status") {
            ipcRenderer.invoke('kbfocus-status', j.data);
        }
    });
}




function ws_is_connected() {
    return new Promise((resolve, reject) => {
        atv_events.once("connected", ic => {
            if (ic) connection_failure = false;
            resolve(ic);
        })
        sendMessage("is_connected");
    })

}

function ws_startScan() {
    connection_failure = false;
    if (ws_connected) sendMessage("scan");
    else {
        scanWhenOpen = true;
    }
}

function ws_sendCommand(cmd) {
    //console.log(`ws_sendCommand: ${cmd}`)
    sendMessage("key", cmd)
}

function ws_sendCommandAction(cmd, taction) {
    // taction can be 'DoubleTap', 'Hold', 'SingleTap'
    //console.log(`ws_sendCommandAction: ${cmd} - ${taction}`)
    sendMessage("key", { "key": cmd, "taction": taction })
}

function ws_connect(creds) {
    if (ws_connecting) return;
    ws_start_tm = Date.now();
    ws_connecting = true;
    return new Promise((resolve, reject) => {
        console.log(`ws_connect: ${creds}`)
        sendMessage("connect", creds)
        atv_events.once("connected", ic => {
            ws_connecting = false;
            ws_start_tm = false;
            if (ic) {
                resolve();
                connection_failure = false;
            } else {
                connection_failure = true;
                startScan();
            }
        });
    })
}

function ws_startPair(dev) {
    connection_failure = false;
    console.log(`ws_startPair: ${dev}`)
    ws_pairDevice = dev;
    sendMessage("startPair", dev);
}

function ws_finishPair(code) {
    connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair", code);
}

function ws_finishPair1(code) {
    connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair1", code);
}

function ws_finishPair2(code) {
    connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair2", code);
}

function checkWSConnection() {
    var timedOut = false;
    if (ws_start_tm) {
        var diff = Date.now() - ws_start_tm;
        if (diff > 3000) {
            console.log('ws connection timed out, retrying')
            ws_connecting = false;
            timedOut = true;
        }
    }
    if (!ws_connected) {
        console.log('restarting websocket');
        startWebsocket();
    }
}

function ws_init() {
    console.log('ws_init');
    startWebsocket();
    setTimeout(() => {
        // not sure if needed, but server start now tries to install required python packages which can be slow
        ws_watchdog = setInterval(() => {
            checkWSConnection()
        }, 5000);
    }, 120000) // bump this up to 2 minutes

}

function incReady() {
    readyCount++;
    if (readyCount == 2) ws_init();
}

function ws_server_started() {
    console.log(`wsserver started`)
    incReady();
}

var readyCount = 0;

$(function() {
    incReady();
});