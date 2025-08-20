var atv_credentials = false;
var lodash = _ = require('./js/lodash.min');
var pairDevice = "";
var electron = require('electron');
var ipcRenderer = electron.ipcRenderer;
var nativeTheme;
var remote;
var dialog;
// Initialize remote after document is ready
var mb;
var Menu, MenuItem
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


const path = require('path');
var device = false;
var qPresses = 0;
var playstate = false;
var previousKeys = []

const ws_keymap = {
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "t": "home",
    "l": "home_hold",
    "Backspace": "menu",
    "Escape": "menu",
    "Space": "play_pause",
    "Enter": "select",
    "Previous": "skip_backward",
    "Next": "skip_forward",
    "[": "skip_backward",
    "]": "skip_forward",
    "g": "top_menu",
    "+": "volume_up",
    "=": "volume_up",
    "-": "volume_down",
    "_": "volume_down"
}

const keymap = {
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'Enter': 'Select',
    'Space': (latv) => {
        var v = latv.playing;
        latv.playing = !latv.playing;
        if (v) {
            return 'Pause';
        } else {
            return 'Play'
        }
    },
    'Backspace': 'Menu',
    'Escape': 'Menu',
    'Next': 'Next',
    'Previous': 'Previous',
    'n': 'Next',
    'p': 'Previous',
    ']': 'Next',
    '[': 'Previous',
    't': 'Tv',
    'l': 'LongTv'
}

const niceButtons = {
    "TV": "Tv",
    "play/pause": "play_pause",
    'Lower Volume': 'volume_down',
    'Raise Volume': 'volume_up'
}

const keyDesc = {
    'Space': 'Pause/Play',
    'ArrowLeft': 'left arrow',
    'ArrowRight': 'right arrow',
    'ArrowUp': 'up arrow',
    'ArrowDown': 'down arrow',
    'Backspace': 'Menu',
    'Escape': 'Menu',
    't': 'TV Button',
    'l': 'Long-press TV Button'
}
function initIPC() {
    ipcRenderer.on('shortcutWin', (event) => {
        handleDarkMode();
        toggleAltText(true);
    })
    
    ipcRenderer.on('scanDevicesResult', (event, ks) => {
        createDropdown(ks);
    })
    
    ipcRenderer.on('pairCredentials', (event, arg) => {
        saveRemote(pairDevice, arg);
        localStorage.setItem('atvcreds', JSON.stringify(getCreds(pairDevice)));
        connectToATV();
    })
    
    ipcRenderer.on('gotStartPair', () => {
        console.log('gotStartPair');
    })
    
    ipcRenderer.on('mainLog', (event, txt) => {
        console.log('[ main ] %s', txt.substring(0, txt.length - 1));
    })
    
    ipcRenderer.on('powerResume', (event, arg) => {
        connectToATV();
    })
    
    ipcRenderer.on('sendCommand', (event, key) => {
        console.log(`sendCommand from main: ${key}`)
        sendCommand(key);
    })
    ipcRenderer.on('kbfocus', () => {
        sendMessage('kbfocus')
    })
    
    ipcRenderer.on('wsserver_started', () => {
        ws_server_started();
    })
    
    ipcRenderer.on('input-change', (event, data) => {
        sendMessage("settext", {text: data});
    });
}

window.addEventListener('blur', e => {
    toggleAltText(true);
})

window.addEventListener('beforeunload', async e => {
    delete e['returnValue'];
    try {
        ipcRenderer.invoke('debug', 'beforeunload called')
        if (!device) return;
        device.removeAllListeners('message');
        ipcRenderer.invoke('debug', 'messages unregistered')
        await device.closeConnection()
        ipcRenderer.invoke('debug', 'connection closed')
    } catch (err) {
        console.log(err);
        //ipcRenderer.invoke('debug', `Error: ${err}`)
    }
});



function toggleAltText(tf) {
    //$("#topTextKBLink .keyTextAlt").width($("#topTextKBLink .keyText").width() + "px");
    if (tf) {
        $(".keyText").show();
        $(".keyTextAlt").hide();
    } else {
        $(".keyText").hide();
        $(".keyTextAlt").show();
    }
}

function openKeyboardClick(event) {
    event.preventDefault();
    openKeyboard();
}

function openKeyboard() {
    ipcRenderer.invoke('openInputWindow')
    setTimeout(() => { // yes, this is done but it works
        sendMessage("gettext")
    }, 10)
}

window.addEventListener('keyup', e => {
    if (e.key == 'Alt') {
        toggleAltText(true);
    }
});

window.addEventListener('app-command', (e, cmd) => {
    console.log('app-command', e, cmd);
})

window.addEventListener('keydown', e => {
    //console.log(e);
    var key = e.key;
    if (key == ' ') key = 'Space';
    var mods = ["Control", "Shift", "Alt", "Option", "Fn", "Hyper", "OS", "Super", "Meta", "Win"].filter(mod => { return e.getModifierState(mod) })
    if (mods.length > 0 && mods[0] == 'Alt') {
        toggleAltText(false);
    }
    var shifted = false;
    if (mods.length == 1 && mods[0] == "Shift") {
        shifted = true;
        mods = []
    }
    if (mods.length > 0) return;

    if (key == 'q') {
        qPresses++;
        console.log(`qPresses ${qPresses}`)
        if (qPresses == 3) ipcRenderer.invoke('quit');
    } else {
        qPresses = 0;
    }
    if (key == 'h') {
        ipcRenderer.invoke('hideWindow');
    }
    if (key == 'k') {
        openKeyboard();
        return;
    }
    if (!isConnected()) {
        if ($("#pairCode").is(':focus') && key == 'Enter') {
            submitCode();
        }
        return;
    }
    if ($("#cancelPairing").is(":visible")) return;
    var fnd = false;
    Object.keys(ws_keymap).forEach(k => {
        if (key == k) {
            fnd = true;
            sendCommand(k, shifted);
            e.preventDefault();
            return false;
        }
    })

})

function createDropdown(ks) {
    $("#loader").hide();
    var txt = "";
    $("#statusText").hide();
    //setStatus("Select a device");
    $("#pairingLoader").html("")
    $("#pairStepNum").html("1");
    $("#pairProtocolName").html("AirPort");
    $("#pairingElements").show();
    var ar = ks.map(el => {
        return {
            id: el,
            text: el
        }
    })
    ar.unshift({
        id: '',
        text: 'Select a device to pair'
    })
    $("#atv_picker").select2({
        data: ar,
        placeholder: 'Select a device to pair',
        dropdownAutoWidth: true,
        minimumResultsForSearch: Infinity
    }).on('change', () => {
        var vl = $("#atv_picker").val();
        if (vl) {
            pairDevice = vl;
            startPairing(vl);
        }
    })
}

function createATVDropdown() {
    $("#statusText").hide();
    var creds = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    var ks = Object.keys(creds);
    var atvc = localStorage.getItem('atvcreds')
    var selindex = 0;
    ks.forEach((k, i) => {
        var v = creds[k]
        if (JSON.stringify(v) == atvc) selindex = i;
    })

    var ar = ks.map((el, i) => {
        var obj = {
            id: el,
            text: el
        }
        if (i == selindex) {
            obj.selected = true;
        }
        return obj;
    })
    ar.unshift({
        id: 'addnew',
        text: 'Pair another remote'
    })
    var txt = "";
    txt += `<span class='ctText'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`
    txt += `<select id="remoteDropdown"></select>`
    $("#atvDropdownContainer").html(txt);
    $("#remoteDropdown").select2({
        data: ar,
        placeholder: 'Select a remote',
        dropdownAutoWidth: true,
        minimumResultsForSearch: Infinity
    })



    $("#remoteDropdown").on('change', () => {
        var vl = $("#remoteDropdown").val();
        if (vl) {
            if (vl == 'addnew') {
                startScan();
                return;
            } else {
                pairDevice = vl;
                localStorage.setItem('atvcreds', JSON.stringify(getCreds(vl)));
                connectToATV();
            }
        }
    })
}

function showAndFade(text) {
    $("#cmdFade").html(text)
    $("#cmdFade").stop(true).fadeOut(0).css({ "visibility": "visible" }).fadeIn(200).delay(800).fadeOut(function() {
        $(this).css({ "display": "flex", "visibility": "hidden" });
    });
}

function _updatePlayState() {
    var label = (device.playing ? "Pause" : "Play")
    console.log(`Update play state: ${label}`)
    $(`[data-key="Pause"] .keyText`).html(label);
}

var updatePlayState = lodash.debounce(_updatePlayState, 300);

async function sendCommand(k, shifted) {
    if (typeof shifted === 'undefined') shifted = false;
    console.log(`sendCommand: ${k}`)
    if (k == 'Pause') k = 'Space';
    var rcmd = ws_keymap[k];
    if (Object.values(ws_keymap).indexOf(k) > -1) rcmd = k;
    if (typeof(rcmd) === 'function') rcmd = rcmd(device);

    var classkey = rcmd;
    if (classkey == 'Play') classkey = 'Pause';
    var el = $(`[data-key="${classkey}"]`)
    if (el.length > 0) {
        el.addClass('invert');
        setTimeout(() => {
            el.removeClass('invert');
        }, 500);
    }
    if (k == 'Space') {
        var pptxt = rcmd == "Pause" ? "Play" : "Pause";
        el.find('.keyText').html(pptxt);
    }
    console.log(`Keydown: ${k}, sending command: ${rcmd} (shifted: ${shifted})`)
    previousKeys.push(rcmd);
    if (previousKeys.length > 10) previousKeys.shift()
    var desc = rcmd;
    if (desc == 'volume_down') desc = 'Lower Volume'
    if (desc == 'volume_up') desc = 'Raise Volume'
    if (desc == 'play_pause') desc = "play/pause"
    if (desc == 'Tv') desc = 'TV'
    if (desc == 'LongTv') desc = 'TV long press'
    showAndFade(desc);
    if (shifted) {
        ws_sendCommandAction(rcmd, "Hold")
    } else {
        ws_sendCommand(rcmd)
    }
}

function getWorkingPath() {
    return path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
}

function isConnected() {
    return atv_connected
        //return !!(device && device.connection)
}

async function askQuestion(msg) {
    let options = {
        buttons: ["No", "Yes"],
        message: msg
    }
    var response = await dialog.showMessageBox(options)
    console.log(response)
    return response.response == 1
}


function startPairing(dev) {
    atv_connected = false;
    $("#initText").hide();
    //setStatus("Enter the pairing code");
    $("#results").hide();
    $("#pairButton").on('click', () => {
        submitCode();
        return false;
    });
    $("#pairCodeElements").show();
    //ipcRenderer.invoke('startPair', dev);
    ws_startPair(dev);
}

function submitCode() {
    var code = $("#pairCode").val();
    $("#pairCode").val("");
    //ipcRenderer.invoke('finishPair', code);
    if ($("#pairStepNum").text() == "1") {
        ws_finishPair1(code)
    } else {
        ws_finishPair2(code)
    }
}

function showKeyMap() {
    $("#initText").hide();
    $(".directionTable").fadeIn();
    $("#topTextKBLink").show();
    
    var longPressTimers = {};
    var longPressProgress = {};
    var isLongPressing = {};
    
    $("[data-key]").off('mousedown mouseup mouseleave');
    
    $("[data-key]").on('mousedown', function(e) {
        var key = $(this).data('key');
        var $button = $(this);
        
        if (longPressTimers[key]) {
            clearTimeout(longPressTimers[key]);
            clearInterval(longPressProgress[key]);
        }
        
        var progressValue = 0;
        isLongPressing[key] = true;
        
        $button.addClass('pressing');
        longPressProgress[key] = setInterval(() => {
            if (!isLongPressing[key]) return;
            
            progressValue += 2;    
            var progressPercent = Math.min(progressValue, 100);
            var radiusPercent = 100 - progressPercent;

            var computedStyle = window.getComputedStyle($button[0]);
            var bgColor = computedStyle.backgroundColor;
            
            if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
                var isDarkMode = $('body').hasClass('darkMode');
                bgColor = isDarkMode ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
            }
            
            $button.css('background', `radial-gradient(circle, transparent ${radiusPercent}%, ${bgColor} ${radiusPercent}%)`);            

            var scale = 1 + (progressPercent * 0.001);
            $button.css('transform', `scale(${scale})`);
            
        }, 20); 

        longPressTimers[key] = setTimeout(() => {
            if (!isLongPressing[key]) return;
            
            clearInterval(longPressProgress[key]);

            $button.addClass('longpress-triggered');

            var computedStyle = window.getComputedStyle($button[0]);
            var successColor = computedStyle.backgroundColor;
            
            if (successColor === 'rgba(0, 0, 0, 0)' || successColor === 'transparent') {
                var isDarkMode = $('body').hasClass('darkMode');
                successColor = isDarkMode ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
            }
            
            $button.css('background', successColor);
            
            console.log(`Long press triggered for: ${key}`);
            sendCommand(key, true); // true indicates long press
            
            isLongPressing[key] = false;
            
            setTimeout(() => {
                $button.removeClass('pressing longpress-triggered');
                $button.css({
                    'background': '',
                    'transform': ''
                });
            }, 200);
            
        }, 1000); // 1 second for long press
    });
    
    $("[data-key]").on('mouseup mouseleave', function(e) {
        var key = $(this).data('key');
        var $button = $(this);
        
        // If we're not in a long press state, this is a regular click
        if (isLongPressing[key]) {
            
            if (longPressTimers[key]) {
                clearTimeout(longPressTimers[key]);
                longPressTimers[key] = null;
            }
            if (longPressProgress[key]) {
                clearInterval(longPressProgress[key]);
                longPressProgress[key] = null;
            }
            
            // Reset state
            isLongPressing[key] = false;
            
            // Reset styles
            $button.removeClass('pressing');
            $button.css({
                'background': '',
                'transform': ''
            });
            
            
            if (e.type === 'mouseup') {
                console.log(`Regular click for: ${key}`);
                sendCommand(key, false); // false = "not shifted" = regular click
            }
        }
    });
    
    var creds = _getCreds();
    if (Object.keys(creds).indexOf("Companion") > -1) {
        $("#topTextHeader").hide();
        $("#topTextKBLink").show();
    } else {
        $("#topTextHeader").show();
        $("#topTextKBLink").hide();
    }
}

var connecting = false;

function handleMessage(msg) {
    device.lastMessages.push(JSON.parse(JSON.stringify(msg)));
    while (device.lastMessages.length > 100) device.lastMessages.shift();
    if (msg.type == 4) {
        try {
            device.bundleIdentifier = msg.payload.playerPath.client.bundleIdentifier;
            var els = device.bundleIdentifier.split('.')
            var nm = els[els.length - 1];
        } catch (err) {}
        if (msg && msg.payload && msg.payload.playbackState) {
            device.playing = msg.payload.playbackState == 1;
            device.lastMessage = JSON.parse(JSON.stringify(msg))
            _updatePlayState();
        }
        if (msg && msg.payload && msg.payload.playbackQueue && msg.payload.playbackQueue.contentItems && msg.payload.playbackQueue.contentItems.length > 0) {
            console.log('got playback item');
            device.playbackItem = JSON.parse(JSON.stringify(msg.payload.playbackQueue.contentItems[0]));
        }
    }
}

async function connectToATV() {
    if (connecting) return;
    connecting = true;
    setStatus("Connecting to ATV...");
    $("#runningElements").show();
    atv_credentials = JSON.parse(localStorage.getItem('atvcreds'))

    $("#pairingElements").hide();

    await ws_connect(atv_credentials);
    createATVDropdown();
    showKeyMap();
    connecting = false;
}

var _connectToATV = lodash.debounce(connectToATV, 300);

function saveRemote(name, creds) {
    var ar = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    if (typeof creds == 'string') creds = JSON.parse(creds);
    ar[name] = creds;
    localStorage.setItem('remote_credentials', JSON.stringify(ar));
}

function setStatus(txt) {
    $("#statusText").html(txt).show();
}

function startScan() {
    $("#initText").hide();
    $("#loader").fadeIn();
    $("#topTextKBLink").hide();
    $("#addNewElements").show();
    $("#runningElements").hide();
    //mb.showWindow();
    $("#atvDropdownContainer").html("");
    setStatus("Please wait, scanning...")
    $("#pairingLoader").html(getLoader());
    //ipcRenderer.invoke('scanDevices');
    ws_startScan();
}


function handleDarkMode() {
    try {
        if (!nativeTheme) return;
        var uimode = localStorage.getItem("uimode") || "systemmode";
        var alwaysUseDarkMode = (uimode == "darkmode");
        var neverUseDarkMode = (uimode == "lightmode");
    
        var darkModeEnabled = (nativeTheme.shouldUseDarkColors || alwaysUseDarkMode) && (!neverUseDarkMode);
        console.log(`darkModeEnabled: ${darkModeEnabled}`)
        if (darkModeEnabled) {
            $("body").addClass("darkMode");
            $("#s2style-sheet").attr('href', 'css/select2-inverted.css')
            ipcRenderer.invoke('uimode', 'darkmode');
        } else {
            $("body").removeClass("darkMode");
            $("#s2style-sheet").attr('href', 'css/select2.min.css')
            ipcRenderer.invoke('uimode', 'lightmode');
        }
    } catch (err) {
        console.log('Error setting dark mode:', err);
    }
}

function _getCreds(nm) {
    var creds = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    var ks = Object.keys(creds);
    if (ks.length === 0) {
        return {};
    }
    if (typeof nm == 'undefined' && ks.length > 0) {
        return creds[ks[0]]
    } else {
        if (Object.keys(creds).indexOf(nm) > -1) {
            localStorage.setItem('currentDeviceID', nm)
            return creds[nm];
        }
    }
}

function getCreds(nm) {
    var r = _getCreds(nm);
    while (typeof r == 'string') r = JSON.parse(r);
    return r;
}

function setAlwaysOnTop(tf) {
    console.log(`setAlwaysOnTop(${tf})`)
    ipcRenderer.invoke('alwaysOnTop', String(tf));
}

function alwaysOnTopToggle() {
    var cd = $("#alwaysOnTopCheck").prop('checked')
    localStorage.setItem('alwaysOnTopChecked', cd);
    setAlwaysOnTop(cd);
}

var lastMenuEvent;

function subMenuClick(event) {
    var mode = event.id;
    localStorage.setItem('uimode', mode);
    lastMenuEvent = event;
    event.menu.items.forEach(el => {
        el.checked = el.id == mode;
    })
    setTimeout(() => {
        handleDarkMode();
    }, 1);

    console.log(event);
}

async function confirmExit() {
    remote.app.quit();
}

function changeHotkeyClick (event) {
    ipcRenderer.invoke('loadHotkeyWindow');
}

function handleContextMenu() {
    let tray = mb.tray
    var mode = localStorage.getItem('uimode') || 'systemmode';

    const subMenu = Menu.buildFromTemplate([
        { type: 'checkbox', id: 'systemmode', click: subMenuClick, label: 'Follow system settings', checked: (mode == "systemmode") },
        { type: 'checkbox', id: 'darkmode', click: subMenuClick, label: 'Dark mode', checked: (mode == "darkmode") },
        { type: 'checkbox', id: 'lightmode', click: subMenuClick, label: 'Light mode', checked: (mode == "lightmode") }
    ])

    var topChecked = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || "false")
    const contextMenu = Menu.buildFromTemplate([
        { type: 'checkbox', label: 'Always on-top', click: toggleAlwaysOnTop, checked: topChecked },
        { type: 'separator' },
        { role: 'about', label: 'About' },
        { type: 'separator' },
        { label: 'Appearance', submenu: subMenu, click: subMenuClick },
        { label: 'Change hotkey', click: changeHotkeyClick },
        { type: 'separator' },
        { label: 'Quit', click: confirmExit }
    ]);
    tray.removeAllListeners('right-click');
    tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    })
}

function toggleAlwaysOnTop(event) {
    localStorage.setItem('alwaysOnTopChecked', String(event.checked));
    ipcRenderer.invoke('alwaysOnTop', String(event.checked));
}

async function helpMessage() {
    await dialog.showMessageBox({ type: 'info', title: 'Howdy!', message: 'Thanks for using this program!\nAfter pairing with an Apple TV (one time process), you will see the remote layout.\n\nEvery button is mapped to the keyboard, press and hold the "Option" key to see which key does what.\n\n To open this program, press Command+Shift+R (pressing this again will close it). Also right-clicking the icon in the menu will show additional options.' })
}

function timeoutAsync(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Modify the init function to handle remote initialization
async function init() {
    if (!initializeRemote()) {
        console.log('Remote not ready, retrying in 100ms...');
        await timeoutAsync(100);
        return await init();
    }
    addThemeListener();
    handleDarkMode();
    handleContextMenu();
    $("#exitLink").on('click', () => {
        $("#exitLink").blur();
        setTimeout(() => {
                confirmExit();
            }, 1)
            //electron.remote.app.quit();
    })
    $("#cancelPairing").on('click', () => {
        console.log('cancelling');
        window.location.reload();
    })

    var checked = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || "false")
    if (checked) setAlwaysOnTop(checked);

    var creds;
    try {
        creds = JSON.parse(localStorage.getItem('atvcreds') || "false")
    } catch {
        creds = getCreds();
        if (creds) localStorage.setItem('atvcreds', JSON.stringify(creds));
    }
    if (localStorage.getItem('firstRun') != 'false') {
        localStorage.setItem('firstRun', 'false');
        await helpMessage();
        mb.showWindow();
    }

    if (creds && creds.credentials && creds.identifier) {
        atv_credentials = creds;
        connectToATV();
    } else {
        startScan();
    }
}

function hideAppMenus() {
    try {
        remote.app.dock.hide();
    } catch (err) {}
}

async function checkEnv() {
    var isProd = await ipcRenderer.invoke('isProduction')

    if (isProd) return hideAppMenus();

    // dev environment
    //remote.getCurrentWindow().webContents.toggleDevTools({ mode: 'detach' });

}

function themeUpdated() {
    console.log('theme style updated');
    handleDarkMode();
}
var tryThemeAddCount = 0;

function addThemeListener() {
    try {
        if (nativeTheme) {
            nativeTheme.removeAllListeners();
            nativeTheme.on('updated', themeUpdated);
        }
    } catch (err) {
        console.log('nativeTheme not ready yet');
        setTimeout(() => {
            tryThemeAddCount++;
            if (tryThemeAddCount < 10) addThemeListener();
        }, 1000);
    }
}

$(function() {    
    initIPC();
    var wp = getWorkingPath();
    $("#workingPathSpan").html(`<strong>${wp}</strong>`);
    ipcRenderer.invoke('isWSRunning');
})
