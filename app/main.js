const { app, BrowserWindow, powerMonitor, Tray, Menu, nativeImage, globalShortcut } = require('electron')
var win;
const { ipcMain } = require('electron')
const path = require('path');
const remote = require('./remote')
const menubar = require('menubar').menubar;
const util = require('util');
const server_runner = require('./server_runner')
server_runner.startServer();

// process.on("uncaughtException", server_runner.stopServer);
// process.on("SIGINT", server_runner.stopServer);
// process.on("SIGTERM", server_runner.stopServer);
global["server_runner"] = server_runner;

const preloadWindow = true;
const readyEvent = preloadWindow ? "ready" : "after-create-window";

var mb;

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
        win = mb.window;


        win.on('close', () => {
            console.log('window closed, quitting')
            app.exit();
        })
        win.on('show', () => {
            win.webContents.send('shortcutWin');
            //console.log('showing window');
        })

        win.webContents.on('will-navigate', (e, url) => {
            console.log(`will-navigate`, url);
        })
        ipcMain.handle('debug', (event, arg) => {
            console.log(`ipcDebug: ${arg}`)
        })
        ipcMain.handle('quit', event => {
            app.exit()
        });
        ipcMain.handle('alwaysOnTop', (event, arg) => {
            var tf = arg == "true";
            console.log(`setting alwaysOnTop: ${tf}`)
            mb.window.setAlwaysOnTop(tf);
        })
        ipcMain.handle('scanDevices', async(event, arg) => {
            var ks = await remote.scanDevices()
            event.sender.send('scanDevicesResult', ks)
        })
        ipcMain.handle('startPair', async(event, arg) => {
            await remote.startPair(arg);
            event.sender.send('gotStartPair');
        })
        ipcMain.handle('finishPair', async(event, arg) => {
            var creds = await remote.finishPair(arg);
            event.sender.send('pairCredentials', creds);
        })
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
        ipcMain.handle('runJS', async(event, arg) => {
            console.log(`runJS ${arg}`)
            try {
                var r = eval(arg);
                if (r && r.then) {
                    var rr = r;
                    r = await r;
                    win.webContents.send('runJSresult', r);
                }
            } catch (err) {
                win.webContents.send('runJSerror', err);
            }
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
        //win.webContents.send("wsserver_started")
    })
}

function showWindow() {
    app.show();
    mb.showWindow();
    setTimeout(() => {
        mb.window.focus();
    }, 200);
}

function hideWindow() {
    mb.hideWindow();
    app.hide();
}

function getWorkingPath() {
    var rp = process.resourcesPath;
    if (!rp && process.argv.length > 1) rp = path.resolve(process.argv[1]);
    if (!app.isPackaged) {
        rp = path.resolve(`${path.dirname(process.argv[1])}/../atv_py_env`)
    }
    return rp
}

app.whenReady().then(() => {
    console.log(getWorkingPath())
    server_runner.testPythonExists().then(r => {
        console.log(`python exists: ${r}`)
    }).catch(err => {
        console.log(`python does not exist: ${err}`)
    })

    createWindow();
    globalShortcut.registerAll(['Super+Shift+R', 'Command+Control+R'], () => {
        if (mb.window.isVisible()) {
            hideWindow();
        } else {
            showWindow();
        }
        win.webContents.send('shortcutWin');
    })
    var version = app.getVersion();
    app.setAboutPanelOptions({
        applicationName: "ATV Remote",
        applicationVersion: version,
        version: version,
        credits: "Brian Harper",
        copyright: "Copyright 2021",
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