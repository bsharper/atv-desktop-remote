/**
 * Fire TV Module
 * Handles Fire TV discovery, pairing, connection checks, and commands.
 */

const http = require('http');
const https = require('https');
const multicastDns = require('multicast-dns');

const API_KEY = '0987654321';
const CLIENT_NAME = 'ATV Remote';
const MDNS_SERVICE = '_amzn-wplay._tcp.local';
const MDNS_SERVICE_SHORT = '_amzn-wplay._tcp';
const CONTROL_PORT = 8080;
const WAKE_PORT = 8009;
const REQUEST_TIMEOUT = 5000;

const FIRETV_PREFIX = 'Fire TV: ';

let lastScan = new Map();
let pairingDevice = null;
let activeCredentials = null;

function normalizeName(name) {
    return String(name || '').replace(/\.$/, '');
}

function isWplayServiceName(name) {
    const normalized = normalizeName(name);
    return normalized === MDNS_SERVICE || normalized === MDNS_SERVICE_SHORT;
}

function stripServiceSuffix(name) {
    return normalizeName(name)
        .replace(new RegExp(`\\.?${MDNS_SERVICE.replace(/\./g, '\\.')}$`), '')
        .replace(new RegExp(`\\.?${MDNS_SERVICE_SHORT.replace(/\./g, '\\.')}$`), '')
        .replace(/\\032/g, ' ')
        .replace(/\\046/g, '&')
        .trim();
}

function parseTxt(txtData) {
    const values = Array.isArray(txtData) ? txtData : [txtData];
    const parsed = {};

    values.forEach((value) => {
        const text = Buffer.isBuffer(value) ? value.toString() : String(value || '');
        const idx = text.indexOf('=');
        if (idx === -1) {
            parsed[text] = true;
        } else {
            parsed[text.slice(0, idx)] = text.slice(idx + 1);
        }
    });

    return parsed;
}

function getDisplayName(instanceName, txt = {}) {
    return txt.friendlyName || txt.fn || txt.name || txt.n || txt.deviceName || stripServiceSuffix(instanceName) || 'Fire TV';
}

function getDeviceString(device) {
    return `${FIRETV_PREFIX}${device.name} (${device.address})`;
}

function isDeviceString(deviceString) {
    return typeof deviceString === 'string' && deviceString.startsWith(FIRETV_PREFIX);
}

function getIpFromDeviceString(deviceString) {
    const match = String(deviceString || '').match(/\(([^)]+)\)$/);
    if (!match) {
        throw new Error('Invalid Fire TV device string format');
    }
    return match[1];
}

function getScannedDevice(deviceString) {
    const ip = getIpFromDeviceString(deviceString);
    return lastScan.get(ip) || null;
}

function addDevice(devices, instanceName, updates = {}) {
    if (!instanceName) {
        return;
    }

    const key = normalizeName(instanceName);
    const existing = devices.get(key) || { instanceName: key, txt: {} };
    devices.set(key, {
        ...existing,
        ...updates,
        txt: { ...(existing.txt || {}), ...(updates.txt || {}) }
    });
}

function consumeRecords(packet, rinfo, devices, targets) {
    const records = [
        ...(packet.answers || []),
        ...(packet.additionals || []),
        ...(packet.authorities || [])
    ];

    records.forEach((record) => {
        const type = String(record.type || '').toUpperCase();
        const name = normalizeName(record.name);

        if (type === 'PTR' && isWplayServiceName(name)) {
            addDevice(devices, record.data, { fallbackAddress: rinfo && rinfo.address });
            return;
        }

        if (type === 'SRV') {
            const target = normalizeName(record.data && record.data.target);
            addDevice(devices, name, {
                port: record.data && record.data.port,
                target,
                fallbackAddress: rinfo && rinfo.address
            });
            if (target) {
                targets.set(target, name);
            }
            return;
        }

        if (type === 'TXT') {
            addDevice(devices, name, { txt: parseTxt(record.data) });
            return;
        }

        if ((type === 'A' || type === 'AAAA') && targets.has(name)) {
            addDevice(devices, targets.get(name), { address: record.data });
        }
    });
}

function query(mdns, name, type) {
    try {
        mdns.query([{ name, type }]);
    } catch (err) {
        console.error(`Fire TV mDNS query failed for ${name} ${type}:`, err);
    }
}

async function scan(timeout = 5000) {
    return new Promise((resolve) => {
        const mdns = multicastDns({ loopback: false, reuseAddr: true });
        const devices = new Map();
        const targets = new Map();
        let interval = null;
        let finished = false;

        function finish() {
            if (finished) {
                return;
            }
            finished = true;
            clearInterval(interval);
            mdns.destroy();

            const found = [];
            devices.forEach((device) => {
                const address = device.address || device.fallbackAddress;
                if (!address || address.includes(':')) {
                    return;
                }

                found.push({
                    type: 'firetv',
                    name: getDisplayName(device.instanceName, device.txt),
                    address,
                    port: CONTROL_PORT,
                    wplayPort: device.port,
                    identifier: device.txt.id || device.txt.uuid || device.instanceName,
                    instanceName: device.instanceName
                });
            });

            lastScan = new Map(found.map(device => [device.address, device]));
            resolve(found);
        }

        function askForDiscoveredDetails() {
            devices.forEach((device) => {
                query(mdns, device.instanceName, 'SRV');
                query(mdns, device.instanceName, 'TXT');
                if (device.target) {
                    query(mdns, device.target, 'A');
                    query(mdns, device.target, 'AAAA');
                }
            });
        }

        mdns.on('response', (packet, rinfo) => {
            consumeRecords(packet, rinfo, devices, targets);
            askForDiscoveredDetails();
        });
        mdns.on('error', (err) => {
            console.error('Fire TV mDNS error:', err);
            finish();
        });

        query(mdns, MDNS_SERVICE, 'PTR');
        query(mdns, MDNS_SERVICE_SHORT, 'PTR');
        interval = setInterval(() => {
            query(mdns, MDNS_SERVICE, 'PTR');
            askForDiscoveredDetails();
        }, 1000);

        setTimeout(finish, timeout);
    });
}

function requestJson(urlString, options = {}) {
    const url = new URL(urlString);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const body = typeof options.body === 'undefined' ? null : JSON.stringify(options.body);

    const headers = {
        'X-Api-Key': API_KEY,
        'user-agent': 'okhttp/4.10.0',
        ...options.headers
    };

    if (body !== null) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method: options.method || 'POST',
            headers,
            rejectUnauthorized: false,
            timeout: options.timeout || REQUEST_TIMEOUT
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const error = new Error(`Fire TV request failed (${res.statusCode}): ${data}`);
                    error.statusCode = res.statusCode;
                    error.body = data;
                    try {
                        error.response = JSON.parse(data);
                    } catch (_) {}
                    reject(error);
                    return;
                }

                if (!data) {
                    resolve(null);
                    return;
                }

                try {
                    resolve(JSON.parse(data));
                } catch (_) {
                    resolve(data);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Fire TV request timed out'));
        });
        req.on('error', reject);

        if (body !== null) {
            req.write(body);
        }
        req.end();
    });
}

function getBaseUrl(credentialsOrDevice) {
    const address = credentialsOrDevice.address || (credentialsOrDevice.device && credentialsOrDevice.device.address);
    const port = credentialsOrDevice.port || (credentialsOrDevice.device && credentialsOrDevice.device.port) || CONTROL_PORT;
    if (!address) {
        throw new Error('Fire TV address is missing');
    }
    return `https://${address}:${port}`;
}

function getToken(credentials) {
    return credentials && (credentials.token || credentials.description);
}

function fireHeaders(credentials) {
    const token = getToken(credentials);
    if (!token) {
        throw new Error('Fire TV token is missing. Please re-pair your Fire TV.');
    }

    return {
        'X-Client-Token': token,
        'Content-Type': 'application/json; charset=utf-8'
    };
}

function isAuthorizedProbeResponse(err) {
    const description = err && err.response && err.response.description;
    return err && err.statusCode === 400 && /Bad arguments supplied/i.test(description || err.body || '');
}

async function wake(device) {
    try {
        await requestJson(`http://${device.address}:${WAKE_PORT}/apps/FireTVRemote`, {
            method: 'POST',
            headers: {},
            timeout: 2000
        });
    } catch (err) {
        console.log('Fire TV wake request did not complete; continuing with pairing:', err.message);
    }
}

async function startPair(deviceString) {
    const device = getScannedDevice(deviceString) || {
        type: 'firetv',
        name: deviceString.replace(FIRETV_PREFIX, '').replace(/\s*\([^)]+\)$/, '') || 'Fire TV',
        address: getIpFromDeviceString(deviceString),
        port: CONTROL_PORT
    };

    pairingDevice = device;
    await wake(device);
    await requestJson(`${getBaseUrl(device)}/v1/FireTV/pin/display`, {
        body: { friendlyName: `${CLIENT_NAME}'s Fire TV` }
    });

    return { phase: 1, protocol: 'Fire TV' };
}

async function finishPair(pin) {
    if (!pairingDevice) {
        throw new Error('No Fire TV pairing session active');
    }

    const response = await requestJson(`${getBaseUrl(pairingDevice)}/v1/FireTV/pin/verify`, {
        body: { pin }
    });
    const token = response && (response.description || response.token);
    if (!token) {
        throw new Error('Fire TV did not return a client token');
    }

    const credentials = {
        type: 'firetv',
        token,
        device: {
            type: 'firetv',
            name: pairingDevice.name,
            address: pairingDevice.address,
            port: CONTROL_PORT,
            wplayPort: pairingDevice.wplayPort,
            identifier: pairingDevice.identifier || pairingDevice.instanceName
        }
    };

    pairingDevice = null;
    return credentials;
}

async function connect(credentials) {
    if (!credentials || credentials.type !== 'firetv') {
        throw new Error('Invalid Fire TV credentials');
    }

    try {
        await requestJson(`${getBaseUrl(credentials)}/v1/FireTV?action=state`, {
            headers: fireHeaders(credentials)
        });
    } catch (err) {
        // The Fire TV validates the token before rejecting this missing-command probe.
        if (!isAuthorizedProbeResponse(err)) {
            throw err;
        }
    }

    activeCredentials = credentials;
    return true;
}

function disconnect() {
    activeCredentials = null;
}

function isConnected() {
    return Boolean(activeCredentials);
}

async function sendMainAction(action) {
    await requestJson(`${getBaseUrl(activeCredentials)}/v1/FireTV?action=${encodeURIComponent(action)}`, {
        headers: fireHeaders(activeCredentials)
    });
}

async function sendMediaAction(action, body) {
    await requestJson(`${getBaseUrl(activeCredentials)}/v1/media?action=${encodeURIComponent(action)}`, {
        headers: fireHeaders(activeCredentials),
        body
    });
}

async function sendKey(key) {
    if (!activeCredentials) {
        throw new Error('Not connected');
    }

    const mainActions = {
        up: 'dpad_up',
        down: 'dpad_down',
        left: 'dpad_left',
        right: 'dpad_right',
        select: 'select',
        menu: 'back',
        back: 'back',
        top_menu: 'menu',
        home: 'home',
        home_hold: 'home'
    };

    if (mainActions[key]) {
        await sendMainAction(mainActions[key]);
        return;
    }

    if (key === 'play_pause') {
        await sendMediaAction('play');
        return;
    }

    if (key === 'skip_forward') {
        await sendMediaAction('scan', { direction: 'forward', keyAction: { keyActionType: 'keyDown' } });
        return;
    }

    if (key === 'skip_backward') {
        await sendMediaAction('scan', { direction: 'back', keyAction: { keyActionType: 'keyDown' } });
        return;
    }

    throw new Error(`Fire TV command is not supported: ${key}`);
}

module.exports = {
    scan,
    startPair,
    finishPair,
    connect,
    disconnect,
    isConnected,
    sendKey,
    getDeviceString,
    isDeviceString
};
