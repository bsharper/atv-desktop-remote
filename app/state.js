/**
 * Application State Machine
 * Single source of truth for app state, emits events on transitions.
 */

const EventEmitter = require('events');

// Stale connection timeout in milliseconds
// Set to 5000 (5 seconds) for testing, change to 3600000 (60 minutes) for production
const STALE_CONNECTION_TIMEOUT = 5000;

// Valid states
const States = {
    INIT: 'init',
    SCANNING: 'scanning',
    PAIRING_1: 'pairing_1',
    PAIRING_2: 'pairing_2',
    CONNECTING: 'connecting',
    CONNECTED: 'connected'
};

// Valid transitions: { fromState: [allowedNextStates] }
const validTransitions = {
    [States.INIT]: [States.SCANNING, States.CONNECTING],
    [States.SCANNING]: [States.PAIRING_1],
    [States.PAIRING_1]: [States.PAIRING_2, States.SCANNING],
    [States.PAIRING_2]: [States.CONNECTING, States.SCANNING],
    [States.CONNECTING]: [States.CONNECTED, States.CONNECTING, States.SCANNING],
    [States.CONNECTED]: [States.SCANNING, States.CONNECTING]
};

class AppState extends EventEmitter {
    constructor() {
        super();
        this._state = States.INIT;
        this._connectRetries = 0;
        this._maxRetries = 3;
        this._pairDevice = null;
        this._credentials = null;
        this._lastActivityTime = Date.now();
    }

    /**
     * Update last activity timestamp (call this on user interactions)
     */
    updateActivity() {
        this._lastActivityTime = Date.now();
    }

    /**
     * Check if connection is considered stale
     * @returns {boolean}
     */
    isConnectionStale() {
        const elapsed = Date.now() - this._lastActivityTime;
        const isStale = elapsed > STALE_CONNECTION_TIMEOUT;
        if (isStale) {
            console.log(`Connection stale: ${Math.round(elapsed / 1000)}s since last activity (threshold: ${STALE_CONNECTION_TIMEOUT / 1000}s)`);
        }
        return isStale;
    }

    /**
     * Get milliseconds since last activity
     */
    get timeSinceActivity() {
        return Date.now() - this._lastActivityTime;
    }

    get state() {
        return this._state;
    }

    get pairDevice() {
        return this._pairDevice;
    }

    get credentials() {
        return this._credentials;
    }

    get connectRetries() {
        return this._connectRetries;
    }

    /**
     * Transition to a new state
     * @param {string} newState - State to transition to
     * @param {Object} data - Optional data to pass with transition
     * @returns {boolean} - Whether transition was successful
     */
    transition(newState, data = {}) {
        const allowed = validTransitions[this._state];
        if (!allowed || !allowed.includes(newState)) {
            console.warn(`Invalid state transition: ${this._state} → ${newState}`);
            return false;
        }

        const oldState = this._state;
        this._state = newState;

        // Handle state-specific logic
        switch (newState) {
            case States.SCANNING:
                this._pairDevice = null;
                this._connectRetries = 0;
                break;

            case States.PAIRING_1:
                this._pairDevice = data.device || null;
                break;

            case States.CONNECTING:
                if (oldState === States.CONNECTING) {
                    // Retry
                    this._connectRetries++;
                } else {
                    // Fresh connection attempt
                    this._connectRetries = 0;
                }
                if (data.credentials) {
                    this._credentials = data.credentials;
                }
                break;

            case States.CONNECTED:
                this._connectRetries = 0;
                this._lastActivityTime = Date.now(); // Reset activity on fresh connection
                break;
        }

        console.log(`State: ${oldState} → ${newState}`, data);
        this.emit('change', { oldState, newState, data });
        this.emit(newState, data);

        return true;
    }

    /**
     * Check if we should retry connection or give up
     * @returns {boolean}
     */
    shouldRetryConnection() {
        return this._connectRetries < this._maxRetries;
    }

    /**
     * Reset to initial state
     */
    reset() {
        this._state = States.INIT;
        this._connectRetries = 0;
        this._pairDevice = null;
        this._credentials = null;
        this.emit('reset');
    }
}

// Singleton instance
const appState = new AppState();

module.exports = {
    States,
    appState,
    STALE_CONNECTION_TIMEOUT
};
