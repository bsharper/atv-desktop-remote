var Promise = require("bluebird");

Promise.config({
    cancellation: true
});

var atv = require('node-appletv-x')

var devices = {}
var device = false;
var lastScan = {}
var callback = () => {}
var defaultTimeout = 30000

function timeoutPromise(asFunc, timeout) {
    return new Promise((resolve, reject) => {
        var p = asFunc();
        var st = setTimeout(() => {
            reject(new Promise.TimeoutError())
        }, timeout)
        p.then(r => {
            clearTimeout(st);
            resolve(p);
        })
    })
}

async function scanDevices() {
    devices = await atv.scan();
    lastScan = {}
    var ks = [];
    devices.forEach(d => {
        var k = `${d.name} (${d.address})`
        lastScan[k] = d;
        ks.push(k);
    })
    return ks
}

async function startPair(id) {
    console.log(`remote: startPair: ${id}`)
    console.log(`lastScan: ${Object.keys(lastScan)}`)
    device = lastScan[id];
    //console.log(device);
    console.log(`Opening device connection`)
    await device.openConnection();
    console.log(`Requesting pairing`)
    callback = await device.pair();
    return true;
}

function startPairWithTimeout(id, timeout) {
    if (typeof timeout === 'undefined') timeout = defaultTimeout
    return timeoutPromise(() => { return startPair(id) }, timeout)
}

async function finishPair(pin) {
    await callback(pin);
    let credentials = device.credentials.toString();
    var data = JSON.stringify({ credentialsString: credentials }, null, 4);
    device.closeConnection()
    return data;
}



function finishPairWithTimeout(pin, timeout) {
    if (typeof timeout === 'undefined') timeout = defaultTimeout
    return timeoutPromise(() => { return finishPair(pin) }, timeout)
}

exports.atv = atv;
exports.scanDevices = scanDevices;
exports.startPair = startPair;
exports.finishPair = finishPair;
exports.defaultTimeout = defaultTimeout;
exports.startPairWithTimeout = startPairWithTimeout;
exports.finishPairWithTimeout = finishPairWithTimeout;