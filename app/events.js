/**
 * Events Module
 * Handles all event binding: IPC, keyboard, window events.
 */

const { States, appState } = require('./state');
const device = require('./device');
const views = require('./views');

let ipcRenderer;
let nativeTheme;
let remote;
let Menu;
let mb;

// Key mappings
const keymap = {
    'ArrowUp': 'up',
    'ArrowDown': 'down',
    'ArrowLeft': 'left',
    'ArrowRight': 'right',
    't': 'home',
    'l': 'home_hold',
    'Backspace': 'menu',
    'Escape': 'menu',
    'Space': 'play_pause',
    'Enter': 'select',
    'Previous': 'skip_backward',
    'Next': 'skip_forward',
    '[': 'skip_backward',
    ']': 'skip_forward',
    'g': 'top_menu',
    '+': 'volume_up',
    '=': 'volume_up',
    '-': 'volume_down',
    '_': 'volume_down'
};

const keyDescriptions = {
    'volume_down': 'Lower Volume',
    'volume_up': 'Raise Volume',
    'play_pause': 'play/pause',
    'home': 'TV',
    'home_hold': 'TV long press'
};

let qPresses = 0;

/**
 * Initialize events module
 * @param {Object} options - Electron modules
 */
function init(options = {}) {
    ipcRenderer = options.ipcRenderer || require('electron').ipcRenderer;
    remote = options.remote;
    nativeTheme = options.nativeTheme;
    Menu = options.Menu;
    mb = options.mb;

    setupIPC();
    setupKeyboard();
    setupWindowEvents();
    setupDeviceEvents();

    // Expose sendCommand globally for views module
    window.sendCommand = sendCommand;
    window.openKeyboard = openKeyboard;
}

/**
 * Setup IPC event listeners
 */
function setupIPC() {
    ipcRenderer.on('shortcutWin', () => {
        handleDarkMode();
        views.toggleAltText(true);
    });

    ipcRenderer.on('scanDevicesResult', (event, devices) => {
        views.createDevicePicker(devices);
    });

    ipcRenderer.on('mainLog', (event, txt) => {
        console.log('[ main ] %s', txt.substring(0, txt.length - 1));
    });

    ipcRenderer.on('powerResume', () => {
        // Reconnect after sleep/wake
        const creds = device.getActiveCredentials();
        if (creds) {
            appState.transition(States.CONNECTING, { credentials: creds });
        }
    });

    ipcRenderer.on('sendCommand', (event, key) => {
        console.log(`sendCommand from main: ${key}`);
        sendCommand(key);
    });

    ipcRenderer.on('kbfocus', () => {
        device.getKeyboardFocus().then(focused => {
            ipcRenderer.invoke('kbfocus-status', focused);
        });
    });

    ipcRenderer.on('input-change', (event, data) => {
        device.setText(data);
    });
}

/**
 * Setup keyboard event listeners
 */
function setupKeyboard() {
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            views.toggleAltText(true);
        }
    });

    window.addEventListener('keydown', (e) => {
        let key = e.key;
        if (key === ' ') key = 'Space';

        const mods = ['Control', 'Shift', 'Alt', 'Option', 'Fn', 'Hyper', 'OS', 'Super', 'Meta', 'Win']
            .filter(mod => e.getModifierState(mod));

        if (mods.length > 0 && mods[0] === 'Alt') {
            views.toggleAltText(false);
        }

        let shifted = false;
        if (mods.length === 1 && mods[0] === 'Shift') {
            shifted = true;
        } else if (mods.length > 0) {
            return; // Don't handle keys with other modifiers
        }

        // Quit on triple-q
        if (key === 'q') {
            qPresses++;
            if (qPresses === 3) ipcRenderer.invoke('quit');
        } else {
            qPresses = 0;
        }

        // Hide window on h
        if (key === 'h') {
            ipcRenderer.invoke('hideWindow');
            return;
        }

        // Open keyboard on k
        if (key === 'k') {
            openKeyboard();
            return;
        }

        // Handle pairing PIN entry
        if (!device.isConnected()) {
            if ($('#pairCode').is(':focus') && key === 'Enter') {
                submitPairingCode();
            }
            return;
        }

        // Don't send commands if pairing UI is visible
        if ($('#cancelPairing').is(':visible')) return;

        // Send mapped key command
        const mappedKey = keymap[key];
        if (mappedKey) {
            sendCommand(key, shifted);
            e.preventDefault();
        }
    });
}

/**
 * Setup window events
 */
function setupWindowEvents() {
    window.addEventListener('blur', () => {
        views.toggleAltText(true);
    });

    window.addEventListener('focus', () => {
        checkStaleConnection();
    });

    window.addEventListener('beforeunload', async (e) => {
        delete e['returnValue'];
        try {
            ipcRenderer.invoke('debug', 'beforeunload called');
            device.disconnect();
            ipcRenderer.invoke('debug', 'connection closed');
        } catch (err) {
            console.error(err);
        }
    });
}

/**
 * Setup device event listeners
 */
function setupDeviceEvents() {
    device.events.on('connected', () => {
        console.log('Device connected');
    });

    device.events.on('connection_lost', (error) => {
        console.log('Connection lost, attempting reconnect...');
        const creds = device.getActiveCredentials();
        if (creds) {
            appState.transition(States.CONNECTING, { credentials: creds });
        }
    });
}

/**
 * Check if connection is stale and reconnect if needed
 */
function checkStaleConnection() {
    // Only check if we're in connected state with valid credentials
    if (appState.state !== States.CONNECTED) {
        return;
    }

    if (!device.hasValidCredentials()) {
        return;
    }

    if (appState.isConnectionStale()) {
        console.log('Connection is stale, triggering reconnect...');
        const creds = device.getActiveCredentials();
        if (creds) {
            appState.transition(States.CONNECTING, { credentials: creds });
        }
    }
}

/**
 * Send a command to the Apple TV
 * @param {string} key - Key pressed
 * @param {boolean} shifted - Whether shift was held (long press)
 */
async function sendCommand(key, shifted = false) {
    // Update activity timestamp
    appState.updateActivity();

    if (key === 'Pause') key = 'Space';

    let cmd = keymap[key];
    if (Object.values(keymap).includes(key)) cmd = key;

    // Visual feedback
    let displayKey = cmd;
    if (displayKey === 'Play') displayKey = 'Pause';
    views.flashButton(displayKey);

    // Get display name for feedback
    let desc = keyDescriptions[cmd] || cmd;
    views.showCommandFeedback(desc);

    console.log(`Keydown: ${key}, sending command: ${cmd} (shifted: ${shifted})`);

    try {
        if (shifted) {
            await device.sendKey(cmd, 'Hold');
        } else {
            await device.sendKey(cmd);
        }
    } catch (err) {
        console.error('sendKey error:', err);
    }
}

/**
 * Open the keyboard input window
 */
function openKeyboard() {
    ipcRenderer.invoke('openInputWindow');
    setTimeout(() => {
        device.getText().then(text => {
            ipcRenderer.invoke('current-text', text || '');
        });
    }, 10);
}

/**
 * Submit pairing code
 */
function submitPairingCode() {
    console.log('submitPairingCode called');
    const code = $('#pairCode').val();
    console.log('Code entered:', code, 'Length:', code.length);

    if (!code || code.length !== 4) {
        console.log('Invalid code length, ignoring');
        return;
    }

    $('#pairCode').val('');

    const currentPhase = $('#pairStepNum').text();
    console.log('Current phase:', currentPhase);

    if (currentPhase === '1') {
        console.log('Calling finishPair1...');
        device.finishPair1(code)
            .then(() => {
                console.log('finishPair1 succeeded, transitioning to PAIRING_2');
                appState.transition(States.PAIRING_2);
            })
            .catch(err => {
                console.error('Pairing phase 1 failed:', err);
                views.setStatus('Pairing failed - restarting. Check PIN and try again.');
                // Restart pairing from scratch - session is now invalid
                restartPairing();
            });
    } else {
        console.log('Calling finishPair2...');
        device.finishPair2(code)
            .then((credentials) => {
                console.log('finishPair2 succeeded, got credentials');
                device.saveCredentials(appState.pairDevice, credentials);
                device.setActiveCredentials(credentials);
                appState.transition(States.CONNECTING, { credentials });
            })
            .catch(err => {
                console.error('Pairing phase 2 failed:', err);
                views.setStatus('Pairing failed - restarting. Check PIN and try again.');
                // Restart pairing from scratch
                restartPairing();
            });
    }
}

/**
 * Restart pairing after a failure
 */
function restartPairing() {
    const deviceName = appState.pairDevice;
    if (deviceName) {
        console.log('Restarting pairing for:', deviceName);
        // Small delay to let user see the error message
        setTimeout(() => {
            device.startPair(deviceName)
                .then(() => {
                    console.log('Pairing restarted successfully');
                    views.setStatus('Enter the new PIN shown on your TV.');
                    $('#pairCode').val('').focus();
                })
                .catch(err => {
                    console.error('Failed to restart pairing:', err);
                    views.setStatus('Could not restart pairing. Please try again.');
                    appState.transition(States.SCANNING);
                });
        }, 1500);
    } else {
        appState.transition(States.SCANNING);
    }
}

/**
 * Setup pairing UI handlers - called when entering pairing state
 */
function setupPairingHandlers() {
    console.log('Setting up pairing handlers');

    // Remove old handlers first
    $('#pairButton').off('click');

    // Add click handler
    $('#pairButton').on('click', (e) => {
        console.log('Pair button clicked');
        e.preventDefault();
        submitPairingCode();
        return false;
    });

    // Also handle Enter key in the input
    $('#pairCode').off('keydown').on('keydown', (e) => {
        if (e.key === 'Enter') {
            console.log('Enter pressed in pairCode input');
            e.preventDefault();
            submitPairingCode();
        }
    });
}

/**
 * Handle dark mode changes
 */
function handleDarkMode() {
    if (!nativeTheme) return;

    try {
        const uimode = localStorage.getItem('uimode') || 'systemmode';
        const alwaysUseDarkMode = uimode === 'darkmode';
        const neverUseDarkMode = uimode === 'lightmode';

        const darkModeEnabled = (nativeTheme.shouldUseDarkColors || alwaysUseDarkMode) && !neverUseDarkMode;

        if (darkModeEnabled) {
            $('body').addClass('darkMode');
            $('#s2style-sheet').attr('href', 'css/select2-inverted.css');
            ipcRenderer.invoke('uimode', 'darkmode');
        } else {
            $('body').removeClass('darkMode');
            $('#s2style-sheet').attr('href', 'css/select2.min.css');
            ipcRenderer.invoke('uimode', 'lightmode');
        }
    } catch (err) {
        console.error('Error setting dark mode:', err);
    }
}

/**
 * Setup tray context menu
 */
function setupContextMenu() {
    if (!mb || !Menu) return;

    const tray = mb.tray;
    const mode = localStorage.getItem('uimode') || 'systemmode';

    const subMenu = Menu.buildFromTemplate([
        { type: 'checkbox', id: 'systemmode', click: (e) => setUIMode(e), label: 'Follow system settings', checked: mode === 'systemmode' },
        { type: 'checkbox', id: 'darkmode', click: (e) => setUIMode(e), label: 'Dark mode', checked: mode === 'darkmode' },
        { type: 'checkbox', id: 'lightmode', click: (e) => setUIMode(e), label: 'Light mode', checked: mode === 'lightmode' }
    ]);

    const topChecked = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || 'false');

    const contextMenu = Menu.buildFromTemplate([
        { type: 'checkbox', label: 'Always on-top', click: toggleAlwaysOnTop, checked: topChecked },
        { type: 'separator' },
        { role: 'about', label: 'About' },
        { type: 'separator' },
        { label: 'Appearance', submenu: subMenu },
        { label: 'Change hotkey', click: () => ipcRenderer.invoke('loadHotkeyWindow') },
        { type: 'separator' },
        { label: 'Quit', click: () => remote.app.quit() }
    ]);

    tray.removeAllListeners('right-click');
    tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });
}

function setUIMode(event) {
    localStorage.setItem('uimode', event.id);
    event.menu.items.forEach(el => {
        el.checked = el.id === event.id;
    });
    setTimeout(handleDarkMode, 1);
}

function toggleAlwaysOnTop(event) {
    localStorage.setItem('alwaysOnTopChecked', String(event.checked));
    ipcRenderer.invoke('alwaysOnTop', String(event.checked));
}

/**
 * Start scanning for devices
 */
async function startScan() {
    appState.transition(States.SCANNING);

    try {
        const devices = await device.scan();
        views.createDevicePicker(devices);
    } catch (err) {
        console.error('Scan failed:', err);
        views.setStatus('Scan failed. Please try again.');
    }
}

/**
 * Start pairing with selected device
 */
async function startPairing(deviceName) {
    try {
        await device.startPair(deviceName);
        // View update happens via state change
    } catch (err) {
        console.error('Start pairing failed:', err);
        views.setStatus('Could not start pairing. Please try again.');
        appState.transition(States.SCANNING);
    }
}

// Subscribe to state changes that need action
appState.on(States.SCANNING, () => {
    device.scan().then(devices => {
        views.createDevicePicker(devices);
    });
});

appState.on(States.PAIRING_1, (data) => {
    // Setup button/input handlers for pairing
    setupPairingHandlers();

    if (data.device) {
        device.startPair(data.device).catch(err => {
            console.error('Start pairing failed:', err);
            views.setStatus('Could not start pairing.');
        });
    }
});

appState.on(States.PAIRING_2, () => {
    // Re-setup handlers for phase 2 (same UI, different phase)
    setupPairingHandlers();
});

appState.on(States.CONNECTING, (data) => {
    if (data.credentials) {
        device.connectWithRetry(data.credentials).catch(err => {
            console.error('Connection failed after retries');
            // State machine already transitioned to SCANNING
        });
    }
});

module.exports = {
    init,
    sendCommand,
    openKeyboard,
    submitPairingCode,
    setupPairingHandlers,
    restartPairing,
    checkStaleConnection,
    handleDarkMode,
    setupContextMenu,
    startScan,
    startPairing
};
