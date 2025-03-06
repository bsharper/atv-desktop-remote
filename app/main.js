const { app, BrowserWindow, powerMonitor, Tray, Menu, nativeImage, globalShortcut, webContents } = require('electron')
var win;
const { ipcMain } = require('electron')
const path = require('path');
require('@electron/remote/main').initialize()
const menubar = require('menubar').menubar;
const util = require('util');
var secondWindow;
process.env['MYPATH'] = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
const lodash = _ = require('./js/lodash.min');
const server_runner = require('./server_runner')
const fs = require('fs');
server_runner.startServer();


global["server_runner"] = server_runner;

const preloadWindow = true;
const readyEvent = preloadWindow ? "ready" : "after-create-window";

const volumeButtons = ['VolumeUp', 'VolumeDown', 'VolumeMute']

var handleVolumeButtonsGlobal = false;

var mb;
var kbHasFocus;

console._log = console.log;
console.log = function() {
    let txt = util.format(...[].slice.call(arguments)) + '\n'
    process.stdout.write(txt);
    if (win && win.webContents) {
        win.webContents.send('mainLog', txt);
    }
}



const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('second instance tried to open');
        showWindow();
    })
}
function createHotkeyWindow() {
    hotkeyWindow = new BrowserWindow({
        width: 500,
        height: 500,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false
        }
    });
    require("@electron/remote/main").enable(hotkeyWindow.webContents);
    hotkeyWindow.loadFile('hotkey.html');
    hotkeyWindow.setMenu(null);
    hotkeyWindow.on('close', (event) => {
        event.preventDefault();
        hotkeyWindow.hide();
        registerHotkeys();
    });
}

function createInputWindow() {
    secondWindow = new BrowserWindow({ 
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true    
        },
        hide: true,
        width: 600, 
        height: 250,
        minimizable: false,
        maximizable: false
    });
    require("@electron/remote/main").enable(secondWindow.webContents);
    secondWindow.loadFile('input.html');
    secondWindow.on('close', (event) => {
        event.preventDefault();
        secondWindow.webContents.send('closeInputWindow');
        showWindowThrottle();
    });
    secondWindow.on("blur", () => {
        if (mb.window.isAlwaysOnTop()) return;
        showWindowThrottle();
    })
    secondWindow.setMenu(null);
    secondWindow.hide();
}

function createWindow() {
    mb = menubar({
        preloadWindow: preloadWindow,
        showDockIcon: false,
        browserWindow: {
            width: 300,
            height: 500,
            alwaysOnTop: false,
            webPreferences: {
                nodeIntegration: true,
                enableRemoteModule: true,
                contextIsolation: false
            }
        }
    })
    global['MB'] = mb;
    mb.on(readyEvent, () => {
        require("@electron/remote/main").enable(mb.window.webContents);
        win = mb.window;
       
        var webContents = win.webContents;
        createInputWindow()
       

        win.on('close', () => {
            console.log('window closed, quitting')
            app.exit();
        })
        win.on('show', () => {
            win.webContents.send('shortcutWin');
            if (handleVolumeButtonsGlobal) handleVolume();
        })

        win.on('hide', () => {
            if (handleVolumeButtonsGlobal) unhandleVolume();
        })

        win.webContents.on('will-navigate', (e, url) => {
            console.log(`will-navigate`, url);
        })
        ipcMain.on('input-change', (event, data) => {
            console.log('Received input:', data);
            win.webContents.send('input-change', data);
        });
        ipcMain.handle("loadHotkeyWindow", (event) => {
            createHotkeyWindow();
        })
        ipcMain.handle('debug', (event, arg) => {
            console.log(`ipcDebug: ${arg}`)
        })
        ipcMain.handle('quit', event => {
            server_runner.stopServer();
            app.exit()
        });
        ipcMain.handle('alwaysOnTop', (event, arg) => {
            var tf = arg == "true";
            console.log(`setting alwaysOnTop: ${tf}`)
            mb.window.setAlwaysOnTop(tf);
            
        })
        ipcMain.handle('uimode', (event, arg) => {
            secondWindow.webContents.send('uimode', arg);
        });


        ipcMain.handle('hideWindow', (event) => {
            console.log('hiding window');
            mb.hideWindow();
        });
        ipcMain.handle('isProduction', (event) => {
            return (!process.defaultApp);
        });
        ipcMain.handle('isWSRunning', (event, arg) => {
            console.log('isWSRunning');
            if (server_runner.isServerRunning()) win.webContents.send('wsserver_started')
        })
        
        ipcMain.handle('closeInputOpenRemote', (event, arg) => {
            console.log('closeInputOpenRemote');
            showWindow();
        })
        ipcMain.handle('openInputWindow', (event, arg) => {
            console.log('openInputWindow');
            secondWindow.show();
            secondWindow.webContents.send('openInputWindow');
        });
        ipcMain.handle('current-text', (event, arg) => {
            console.log('current-text', arg);
            secondWindow.webContents.send('current-text', arg);
        });
        ipcMain.handle('kbfocus-status', (event, arg) => {
            secondWindow.webContents.send('kbfocus-status', arg);
            kbHasFocus = arg;
        })
        ipcMain.handle('kbfocus', () => {
            win.webContents.send('kbfocus');
        })

        powerMonitor.addListener('resume', event => {
            win.webContents.send('powerResume');
        })

        win.on('ready-to-show', () => {
            console.log('ready to show')
            if (server_runner.isServerRunning()) {
                win.webContents.send("wsserver_started")
            }
        })

        if (server_runner.isServerRunning()) {
            console.log(`server already running`)
            win.webContents.send("wsserver_started")
        } else {
            console.log(`server waiting for event`)
            server_runner.server_events.on("started", () => {
                win.webContents.send("wsserver_started")
            })
        }
    })
}

function showWindow() {
    secondWindow.hide();
    try {
        app.show();
    } catch (err) {
        //console.log(err);
        // this happens in windows, doesn't seem to affect anything though
    }
    mb.showWindow();
    setTimeout(() => {
        mb.window.focus();
    }, 200);
}

var showWindowThrottle = lodash.throttle(showWindow, 100);

function hideWindow() {
    mb.hideWindow();
    try {
        app.hide();
    } catch (err) {
        // console.log(err);
        // not sure if this affects windows like app.show does.
    }
}

function getWorkingPath() {
    var rp = process.resourcesPath;
    if (!rp && process.argv.length > 1) rp = path.resolve(process.argv[1]);
    if (!app.isPackaged) {
        rp = path.resolve(`${path.dirname(process.argv[1])}/../atv_py_env`)
    }
    return rp
}

function unhandleVolume() {
    volumeButtons.forEach(btn => {
        console.log(`unregister: ${btn}`)
        globalShortcut.unregister(btn);
    })
}

function handleVolume() {
    volumeButtons.forEach(btn => {
        console.log(`register: ${btn}`)
        globalShortcut.register(btn, () => {
            var keys = {
                "VolumeUp": "volume_up",
                "VolumeDown": "volume_down",
                "VolumeMute": "volume_mute"
            }
            var key = keys[btn]
            console.log(`sending ${key} for ${btn}`)
            win.webContents.send('sendCommand', key);
        })
    })
}
function registerHotkeys() {
    var hotkeyPath = path.join(process.env['MYPATH'], "hotkey.txt")
    try {
        globalShortcut.unregisterAll();
    } catch (err) {
        console.log(`Error unregistering hotkeys: ${err}`)
    } 
    var registered = false;   
    if (fs.existsSync(hotkeyPath)) {
        
        var hotkeys = fs.readFileSync(hotkeyPath, {encoding: 'utf-8'}).trim();
        if (hotkeys.indexOf(",") > -1) {
            hotkeys = hotkeys.split(',').map(el => { return el.trim() });
        } else {
            hotkeys = [hotkeys];
        }
        console.log(`Registering custom hotkeys: ${hotkeys}`)
        var errs = hotkeys.map(hotkey => {
            console.log(`Registering hotkey: ${hotkey}`)
            return globalShortcut.register(hotkey, () => {
                if (mb.window.isVisible()) {
                    hideWindow();
                } else {
                    showWindow();
                }
                win.webContents.send('shortcutWin');
            })
        })
        // var ret = globalShortcut.registerAll(hotkeys, () => {
        //     if (mb.window.isVisible()) {
        //         hideWindow();
        //     } else {
        //         showWindow();
        //     }
        //     win.webContents.send('shortcutWin');
        // })
        var ret = errs.every(el => { return el });
        if (!ret) {
            errs.forEach((err, idx) => {
                if (!err) {
                    console.log(`Error registering hotkey: ${hotkeys[idx]}`)
                }
            })
            console.log(`Error registering hotkeys: ${hotkeys}`)
        } else {
            registered =true;
        }
    } 
    if (!registered) {
        globalShortcut.registerAll(['Super+Shift+R', 'Command+Control+R'], () => {
            if (mb.window.isVisible()) {
                hideWindow();
            } else {
                showWindow();
            }
            win.webContents.send('shortcutWin');
        })
    }
}

app.whenReady().then(() => {

    server_runner.testPythonExists().then(r => {
        console.log(`python exists: ${r}`)
    }).catch(err => {
        console.log(`python does not exist: ${err}`)
    })

    createWindow();
    registerHotkeys();
   
    var version = app.getVersion();
    app.setAboutPanelOptions({
        applicationName: "ATV Remote",
        applicationVersion: version,
        version: version,
        credits: "Brian Harper",
        copyright: "Copyright 2025",
        website: "https://github.com/bsharper",
        iconPath: "./images/full.png"
    });
})

app.on("before-quit", () => {
    server_runner.stopServer();
})

app.on('window-all-closed', () => {
    app.quit()
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})
