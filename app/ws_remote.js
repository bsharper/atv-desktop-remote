/**
 * ATV Remote - Communication layer
 * Now uses direct JavaScript communication via atvjs instead of Python WebSocket bridge
 */

const EventEmitter = require('events');
const atv_bridge = require('./atv_bridge');

var atv_events = new EventEmitter();

var connection_failure = false;
var atv_connected = false;
var ws_pairDevice = "";

// Bridge is always "connected" since there's no WebSocket
var ws_connected = true;

function ws_is_connected() {
    return Promise.resolve(atv_bridge.isConnected());
}

async function ws_startScan() {
    connection_failure = false;
    try {
        const devices = await atv_bridge.scan();
        createDropdown(devices);
    } catch (err) {
        console.error('Scan error:', err);
        createDropdown([]);
    }
}

function ws_sendCommand(cmd) {
    atv_bridge.sendKey(cmd).catch(err => {
        console.error('sendKey error:', err);
    });
}

function ws_sendCommandAction(cmd, taction) {
    // taction can be 'DoubleTap', 'Hold', 'SingleTap'
    atv_bridge.sendKey(cmd, taction).catch(err => {
        console.error('sendKey error:', err);
    });
}

async function ws_connect(creds) {
    try {
        await atv_bridge.connectToDevice(creds);
        atv_connected = true;
        connection_failure = false;
        atv_events.emit("connected", true);
        return true;
    } catch (err) {
        console.error('Connection error:', err);
        atv_connected = false;
        connection_failure = true;
        atv_events.emit("connection_failure", err.message);
        throw err; // Re-throw so caller knows connection failed
    }
}

async function ws_startPair(dev) {
    connection_failure = false;
    console.log(`ws_startPair: ${dev}`);
    ws_pairDevice = dev;
    try {
        await atv_bridge.startPair(dev);
        // Phase 1 started, PIN will show on Apple TV
    } catch (err) {
        console.error('startPair error:', err);
        connection_failure = true;
    }
}

async function ws_finishPair1(code) {
    connection_failure = false;
    console.log(`ws_finishPair1: ${code}`);
    try {
        const result = await atv_bridge.finishPair1(code);
        // Signal UI to show Phase 2
        $("#pairStepNum").html("2");
        $("#pairProtocolName").html("Companion");
    } catch (err) {
        console.error('finishPair1 error:', err);
        connection_failure = true;
    }
}

async function ws_finishPair2(code) {
    connection_failure = false;
    console.log(`ws_finishPair2: ${code}`);
    try {
        const credentials = await atv_bridge.finishPair2(code);
        // Save credentials and connect
        console.log("pairCredentials", ws_pairDevice, credentials);
        saveRemote(ws_pairDevice, credentials);
        localStorage.setItem('atvcreds', JSON.stringify(credentials));
        connectToATV();
    } catch (err) {
        console.error('finishPair2 error:', err);
        connection_failure = true;
    }
}

// Handle keyboard focus check
function sendMessage(command, data) {
    if (command === 'kbfocus') {
        atv_bridge.getKeyboardFocus().then(focused => {
            ipcRenderer.invoke('kbfocus-status', focused);
        });
    } else if (command === 'gettext') {
        atv_bridge.getText().then(text => {
            ipcRenderer.invoke('current-text', text || '');
        });
    } else if (command === 'settext') {
        atv_bridge.setText(data.text);
    }
}

// Listen for connection events from bridge
atv_bridge.atv_events.on('connection_lost', (error) => {
    atv_connected = false;
    atv_events.emit('connection_lost', error);
});

// Bridge initialization - called when both DOM and IPC are ready
function ws_init() {
    console.log('ws_init - using direct atvjs bridge');
    // Bridge is always ready, so immediately initialize the app
    checkEnv();
    init().then(() => {
        console.log('init complete');
    });
}

function incReady() {
    readyCount++;
    if (readyCount == 2) ws_init();
}

// Called when main process signals ready (via IPC wsserver_started)
function ws_server_started() {
    console.log('atvjs bridge ready');
    incReady();
}

var readyCount = 0;

// DOM ready
$(function() {
    incReady();
});
