/**
 * ATV Remote - Main Bootstrap
 * Initializes all modules and starts the app.
 */

const electron = require('electron');
const ipcRenderer = electron.ipcRenderer;
const path = require('path');
const fs = require('fs');

const { States, appState } = require('./state');
const device = require('./device');
const views = require('./views');
const events = require('./events');

// Electron remote module references
let remote;
let nativeTheme;
let dialog;
let Menu;
let MenuItem;
let mb;

/**
 * Initialize Electron remote module
 */
function initializeRemote() {
    try {
        remote = require('@electron/remote');
        nativeTheme = remote.nativeTheme;
        dialog = remote.dialog;
        Menu = remote.Menu;
        MenuItem = remote.MenuItem;
        mb = remote.getGlobal('MB');
        electron.remote = remote;
        return true;
    } catch (err) {
        console.error('Failed to initialize remote:', err);
        return false;
    }
}

/**
 * Wait for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Show first-run help message
 */
async function showHelpMessage() {
    await dialog.showMessageBox({
        type: 'info',
        title: 'Howdy!',
        message: 'Thanks for using this program!\nAfter pairing with an Apple TV (one time process), you will see the remote layout.\n\nEvery button is mapped to the keyboard, press and hold the "Option" key to see which key does what.\n\nTo open this program, press Command+Control+R (pressing this again will close it). Also right-clicking the icon in the menu will show additional options.'
    });
}

/**
 * Hide dock icon in production
 */
function hideAppMenus() {
    try {
        remote.app.dock.hide();
    } catch (err) {}
}

/**
 * Check environment and configure accordingly
 */
async function checkEnv() {
    const isProd = await ipcRenderer.invoke('isProduction');
    if (isProd) {
        hideAppMenus();
    }
}

/**
 * Setup native theme listener for dark mode changes
 */
function setupThemeListener() {
    if (nativeTheme) {
        nativeTheme.removeAllListeners();
        nativeTheme.on('updated', () => {
            console.log('Theme style updated');
            events.handleDarkMode();
        });
    }
}

/**
 * Check for and offer to remove legacy Python files from previous app versions
 */
async function checkLegacyCleanup() {
    const state = localStorage.getItem('legacyCleanup') || 'pending';
    if (state === 'done' || state === 'never') return;
    if (sessionStorage.getItem('legacyCleanupAsked')) return;
    sessionStorage.setItem('legacyCleanupAsked', 'true');

    const appData = process.env.MYPATH;
    if (!appData) return;

    const legacyItems = [
        { name: 'env', dir: true },
        { name: 'wsserver.py' },
        { name: 'start_server.sh' },
        { name: 'start_server.bat' },
        { name: 'atv_pip_install.log' },
    ];

    const found = legacyItems.filter(item => {
        try { return fs.existsSync(path.join(appData, item.name)); }
        catch { return false; }
    });

    if (found.length === 0) {
        localStorage.setItem('legacyCleanup', 'done');
        return;
    }

    const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Clean Up', 'Not Now', "Don't Ask Again"],
        defaultId: 0,
        message: 'Remove old app files?',
        detail: 'Files from a previous version of ATV Remote were found (Python virtual environment and scripts). These are no longer needed. Would you like to remove them?',
    });

    if (result.response === 0) {
        for (const item of found) {
            try {
                fs.rmSync(path.join(appData, item.name), { recursive: !!item.dir, force: true });
            } catch (err) {
                console.error(`Failed to remove legacy item ${item.name}:`, err);
            }
        }
        localStorage.setItem('legacyCleanup', 'done');
    } else if (result.response === 2) {
        localStorage.setItem('legacyCleanup', 'never');
    }
}

/**
 * Main initialization
 */
async function init() {
    // Wait for remote module to be ready
    if (!initializeRemote()) {
        console.log('Remote not ready, retrying in 100ms...');
        await sleep(100);
        return init();
    }

    // Initialize modules
    views.init();
    events.init({
        ipcRenderer,
        remote,
        nativeTheme,
        Menu,
        mb
    });

    // Setup theme handling
    setupThemeListener();
    events.handleDarkMode();
    events.setupContextMenu();

    // Setup UI event handlers
    $('#exitLink').on('click', () => {
        $('#exitLink').blur();
        setTimeout(() => remote.app.quit(), 1);
    });

    $('#cancelPairing').on('click', () => {
        console.log('Cancelling pairing');
        window.location.reload();
    });

    // Note: pairButton click handler is set up in events.js when entering pairing state

    // Restore always-on-top preference
    const alwaysOnTop = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || 'false');
    if (alwaysOnTop) {
        ipcRenderer.invoke('alwaysOnTop', String(alwaysOnTop));
    }

    // Show first-run help
    if (localStorage.getItem('firstRun') !== 'false') {
        localStorage.setItem('firstRun', 'false');
        await showHelpMessage();
        mb.showWindow();
    }

    // Offer to clean up legacy Python files
    await checkLegacyCleanup();

    // Check for saved credentials and start appropriate flow
    if (device.hasValidCredentials()) {
        const creds = device.getActiveCredentials();
        appState.transition(States.CONNECTING, { credentials: creds });
    } else {
        appState.transition(States.SCANNING);
    }
}

// Expose functions needed by HTML onclick handlers
window.openKeyboardClick = function(event) {
    event.preventDefault();
    events.openKeyboard();
};

// DOM ready - start initialization
$(function() {
    // Wait for IPC ready signal from main process
    ipcRenderer.on('wsserver_started', () => {
        console.log('Main process ready');
        checkEnv();
        init().then(() => {
            console.log('App initialized');
        });
    });

    // Also initialize on DOM ready if IPC already sent (in case of reload)
    setTimeout(() => {
        if (appState.state === States.INIT) {
            console.log('Fallback init after timeout');
            checkEnv();
            init().then(() => {
                console.log('App initialized (fallback)');
            });
        }
    }, 500);
});
