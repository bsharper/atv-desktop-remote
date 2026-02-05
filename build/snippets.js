// Paste these into DevTools console (View > Toggle Developer Tools)

const { clipboard } = require('electron');

// Copy all localStorage to clipboard as JSON
function exportLocalStorage() {
    clipboard.writeText(JSON.stringify(localStorage));
    console.log('localStorage copied to clipboard');
}

// Restore localStorage from clipboard JSON
function importLocalStorage() {
    const data = JSON.parse(clipboard.readText());
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
    console.log('localStorage restored from clipboard');
}
