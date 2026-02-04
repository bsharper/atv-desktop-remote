/**
 * ATV Bridge - Direct JavaScript communication with Apple TV using atvjs
 * Replaces the Python WebSocket bridge (pyatv)
 */

const atvjs = require('./atvjs');
const EventEmitter = require('events');

// Global state
let connection = null;
let pairingSession = null;
let pairingDevice = null;
let kbFocusCallback = null;

const atv_events = new EventEmitter();

/**
 * Scan for Apple TV devices on the network
 * @returns {Promise<string[]>} Array of device strings in format "Name (IP)"
 */
async function scan(timeout = 5000) {
    try {
        const devices = await atvjs.scan(timeout);
        // Return in the same format as pyatv: "Name (IP)"
        return devices.map(d => `${d.name} (${d.address})`);
    } catch (err) {
        console.error('Scan error:', err);
        return [];
    }
}

/**
 * Get full device info from scan
 * @returns {Promise<Object[]>} Array of AppleTVDevice objects
 */
async function scanDevices(timeout = 5000) {
    try {
        return await atvjs.scan(timeout);
    } catch (err) {
        console.error('Scan error:', err);
        return [];
    }
}

/**
 * Start pairing with a device (Phase 1: AirPlay)
 * @param {string} deviceString - Device in format "Name (IP)"
 */
async function startPair(deviceString) {
    // Parse device string to get IP - match the LAST parenthesized value
    // This handles device names with parentheses like "Upstairs Bedroom (3) (192.168.1.223)"
    const match = deviceString.match(/\(([^)]+)\)$/);
    if (!match) {
        throw new Error('Invalid device string format');
    }
    const ip = match[1];

    // Scan to get full device info
    const devices = await atvjs.scan(5000);
    const device = devices.find(d => d.address === ip);
    if (!device) {
        throw new Error('Device not found');
    }

    pairingDevice = device;

    // Start AirPlay pairing (Phase 1)
    pairingSession = await atvjs.startAirPlayPairing(device);
    pairingSession._phase = 1;
    pairingSession._device = device;

    return { phase: 1, protocol: 'AirPlay' };
}

/**
 * Complete Phase 1 (AirPlay) pairing with PIN
 * @param {string} pin - 4-digit PIN from Apple TV screen
 * @returns {Promise<Object>} Partial credentials or signal to continue to Phase 2
 */
async function finishPair1(pin) {
    if (!pairingSession || pairingSession._phase !== 1) {
        throw new Error('No AirPlay pairing session active');
    }

    // Complete AirPlay pairing
    const airplayCreds = await atvjs.finishAirPlayPairing(pairingSession, pin);
    const airplayCredsStr = atvjs.serializeCredentials(airplayCreds);

    // Start Companion pairing (Phase 2)
    const newSession = await atvjs.startCompanionPairing(pairingDevice);
    newSession._phase = 2;
    newSession._device = pairingDevice;
    newSession._airplayCreds = airplayCredsStr;
    pairingSession = newSession;

    return { phase: 2, protocol: 'Companion' };
}

/**
 * Complete Phase 2 (Companion) pairing with PIN
 * @param {string} pin - 4-digit PIN from Apple TV screen
 * @returns {Promise<Object>} Complete credentials
 */
async function finishPair2(pin) {
    if (!pairingSession || pairingSession._phase !== 2) {
        throw new Error('No Companion pairing session active');
    }

    // Complete Companion pairing
    const companionCreds = await atvjs.finishCompanionPairing(pairingSession, pin);

    // Build complete credentials object
    const credentials = {
        airplay: pairingSession._airplayCreds,
        companion: atvjs.serializeCredentials(companionCreds),
        device: {
            name: pairingDevice.name,
            address: pairingDevice.address,
            port: pairingDevice.port,
            airplayPort: pairingDevice.airplayPort,
            identifier: pairingDevice.identifier
        }
    };

    // Clean up pairing state
    pairingSession = null;
    pairingDevice = null;

    return credentials;
}

/**
 * Connect to an Apple TV using stored credentials
 * @param {Object} credentials - Credentials object with airplay, companion, and device info
 */
async function connectToDevice(credentials) {
    let creds = credentials;
    let device = credentials.device;

    // Convert old pyatv credential format to new format if needed
    // Old format: {identifier, credentials, Companion}
    // New format: {airplay, companion, device}
    if (credentials.credentials && !credentials.airplay) {
        console.log('Converting old credential format to new format');
        creds = {
            airplay: credentials.credentials,
            companion: credentials.Companion || credentials.companion
        };
    }

    // If device info not stored in credentials, we need to scan
    if (!device) {
        const devices = await atvjs.scan(5000);
        if (credentials.identifier) {
            device = devices.find(d => d.identifier === credentials.identifier);
        }
        if (!device && devices.length > 0) {
            // Fallback to first device
            device = devices[0];
        }
        if (!device) {
            throw new Error('Could not find Apple TV on network. Make sure it is powered on.');
        }
    }

    // Validate credentials format
    if (!creds.airplay || !creds.companion) {
        throw new Error('Invalid credentials format. Please re-pair your Apple TV.');
    }

    // Connect using atvjs
    connection = await atvjs.connect(device, creds);

    // Set up connection lost handler
    atvjs.onConnectionLost(connection, (error) => {
        console.log('Connection lost:', error);
        connection = null;
        atv_events.emit('connection_lost', error);
    });

    atv_events.emit('connected', true);
    return true;
}

/**
 * Disconnect from the Apple TV
 */
function disconnect() {
    if (connection) {
        atvjs.disconnect(connection);
        connection = null;
    }
}

/**
 * Check if connected
 */
function isConnected() {
    return connection && atvjs.isConnected(connection);
}

/**
 * Send a remote control key
 * @param {string} key - Key name (up, down, left, right, select, menu, etc.)
 * @param {string} action - Optional action type ('Hold', 'DoubleTap')
 */
async function sendKey(key, action) {
    if (!connection) {
        throw new Error('Not connected');
    }

    // Handle long-press keys
    if (action === 'Hold') {
        // For hold actions, we need to send key down, wait, then key up
        // atvjs handles home_hold specially, but for other keys:
        if (key === 'home' || key === 'home_hold') {
            key = 'home_hold';
        }
    }

    await atvjs.sendKey(connection, key);
}

/**
 * Check if keyboard is focused on Apple TV
 * @returns {Promise<boolean>}
 */
async function getKeyboardFocus() {
    if (!connection) {
        return false;
    }
    try {
        return await atvjs.getKeyboardFocusState(connection);
    } catch (err) {
        console.error('getKeyboardFocus error:', err);
        return false;
    }
}

/**
 * Get current text from focused keyboard field
 * @returns {Promise<string|null>}
 */
async function getText() {
    if (!connection) {
        return null;
    }
    try {
        return await atvjs.getText(connection);
    } catch (err) {
        console.error('getText error:', err);
        return null;
    }
}

/**
 * Set text in focused keyboard field
 * @param {string} text
 */
async function setText(text) {
    if (!connection) {
        return;
    }
    try {
        await atvjs.setText(connection, text);
    } catch (err) {
        console.error('setText error:', err);
    }
}

// Export everything
module.exports = {
    scan,
    scanDevices,
    startPair,
    finishPair1,
    finishPair2,
    connectToDevice,
    disconnect,
    isConnected,
    sendKey,
    getKeyboardFocus,
    getText,
    setText,
    atv_events
};
