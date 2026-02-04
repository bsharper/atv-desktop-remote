/**
 * Device Module
 * Handles all Apple TV device operations: scanning, pairing, connecting, commands.
 * Wraps atvjs library and manages credential storage.
 */

const atvjs = require('./atvjs');
const EventEmitter = require('events');
const { States, appState } = require('./state');

const events = new EventEmitter();

// Connection state
let connection = null;
let pairingSession = null;
let pairingDevice = null;

// Retry configuration
const CONNECT_RETRY_DELAY = 1000; // ms between retries

/**
 * Scan for Apple TV devices on the network
 * @param {number} timeout - Scan timeout in ms
 * @returns {Promise<string[]>} Array of device strings in format "Name (IP)"
 */
async function scan(timeout = 5000) {
    try {
        const devices = await atvjs.scan(timeout);
        return devices.map(d => `${d.name} (${d.address})`);
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
    // Handles device names with parentheses like "Upstairs Bedroom (3) (192.168.1.223)"
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
 * Connect to an Apple TV using credentials, with retry logic
 * @param {Object} credentials - Credentials object
 * @param {boolean} isRetry - Whether this is a retry attempt
 */
async function connect(credentials, isRetry = false) {
    let creds = credentials;
    let device = credentials.device;

    // Convert old pyatv credential format to new format if needed
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
        events.emit('connection_lost', error);
    });

    events.emit('connected');
    return true;
}

/**
 * Connect with automatic retry on failure
 * Uses appState to track retry count
 * @param {Object} credentials
 */
async function connectWithRetry(credentials) {
    try {
        await connect(credentials);
        appState.transition(States.CONNECTED);
    } catch (err) {
        console.error('Connection failed:', err.message);

        if (appState.shouldRetryConnection()) {
            console.log(`Retrying connection (attempt ${appState.connectRetries + 1})...`);
            // Stay in CONNECTING state (increments retry counter)
            appState.transition(States.CONNECTING, { credentials });

            await new Promise(resolve => setTimeout(resolve, CONNECT_RETRY_DELAY));
            return connectWithRetry(credentials);
        } else {
            console.log('Max retries reached, falling back to scan');
            appState.transition(States.SCANNING);
            throw err;
        }
    }
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
        if (key === 'home' || key === 'home_hold') {
            key = 'home_hold';
        }
    }

    await atvjs.sendKey(connection, key);
}

/**
 * Check if keyboard is focused on Apple TV
 */
async function getKeyboardFocus() {
    if (!connection) return false;
    try {
        return await atvjs.getKeyboardFocusState(connection);
    } catch (err) {
        console.error('getKeyboardFocus error:', err);
        return false;
    }
}

/**
 * Get current text from focused keyboard field
 */
async function getText() {
    if (!connection) return null;
    try {
        return await atvjs.getText(connection);
    } catch (err) {
        console.error('getText error:', err);
        return null;
    }
}

/**
 * Set text in focused keyboard field
 */
async function setText(text) {
    if (!connection) return;
    try {
        await atvjs.setText(connection, text);
    } catch (err) {
        console.error('setText error:', err);
    }
}

// ============ Credential Storage ============

const CREDS_KEY = 'remote_credentials';
const ACTIVE_CREDS_KEY = 'atvcreds';

/**
 * Save credentials for a device
 * @param {string} name - Device name
 * @param {Object} creds - Credentials object
 */
function saveCredentials(name, creds) {
    let parsed = creds;
    if (typeof creds === 'string') {
        parsed = JSON.parse(creds);
    }

    const all = getAllCredentials();
    all[name] = parsed;
    localStorage.setItem(CREDS_KEY, JSON.stringify(all));
}

/**
 * Get all saved credentials
 * @returns {Object} Map of device name to credentials
 */
function getAllCredentials() {
    try {
        return JSON.parse(localStorage.getItem(CREDS_KEY) || '{}');
    } catch {
        return {};
    }
}

/**
 * Get credentials for a specific device, or the first available
 * @param {string} name - Optional device name
 * @returns {Object|null}
 */
function getCredentials(name) {
    const all = getAllCredentials();
    const keys = Object.keys(all);

    if (keys.length === 0) return null;

    if (name && all[name]) {
        return all[name];
    }

    // Return first available
    return all[keys[0]];
}

/**
 * Get the currently active credentials
 */
function getActiveCredentials() {
    try {
        const creds = localStorage.getItem(ACTIVE_CREDS_KEY);
        if (!creds || creds === 'false') return null;
        return JSON.parse(creds);
    } catch {
        return null;
    }
}

/**
 * Set the active credentials
 */
function setActiveCredentials(creds) {
    localStorage.setItem(ACTIVE_CREDS_KEY, JSON.stringify(creds));
}

/**
 * Get list of saved device names
 */
function getSavedDeviceNames() {
    return Object.keys(getAllCredentials());
}

/**
 * Check if we have valid credentials stored
 */
function hasValidCredentials() {
    const creds = getActiveCredentials();
    if (!creds) return false;

    // Check for both old format (credentials/identifier) and new format (airplay/companion)
    return (creds.credentials && creds.identifier) || (creds.airplay && creds.companion);
}

module.exports = {
    // Scanning
    scan,

    // Pairing
    startPair,
    finishPair1,
    finishPair2,

    // Connection
    connect,
    connectWithRetry,
    disconnect,
    isConnected,

    // Commands
    sendKey,
    getKeyboardFocus,
    getText,
    setText,

    // Credentials
    saveCredentials,
    getAllCredentials,
    getCredentials,
    getActiveCredentials,
    setActiveCredentials,
    getSavedDeviceNames,
    hasValidCredentials,

    // Events
    events
};
