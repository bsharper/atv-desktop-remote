const spawn = require('child_process').spawn
const exec = require('child_process').exec
const WebSocket = require('ws').WebSocket
const readline = require('readline')
const fs = require('fs')
const fsp = fs.promises
const EventEmitter = require('events');
const path = require('path')
const sfiles = require('./pyscripts').files;

var server_events = new EventEmitter();
var proc = null;
var showOutputs = false;
var serverRunning = false;
let errorBuffer = [];
let isShuttingDown = false;

// Track restart attempts
let restartCount = 0;
const MAX_RESTARTS = 3;  // Maximum number of restart attempts
const RESTART_TIMEOUT = 5000;  // Time to wait before restart

function getWorkingPath() {
    return path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
}

function fileExists(fn) {
    return new Promise((resolve, reject) => {
        fs.access(fn, err => {
            if (err) return resolve(false);
            resolve(true);
        })
    })
}

function fileExistsSync(fn) {
    try {
        fs.accessSync(fn);
        return true;
    } catch (err) {
        return false;
    }
}



function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

async function gracefulShutdown() {
    console.log('Attempting graceful shutdown...');
    try {
        await killServer();
        return true;
    } catch (err) {
        console.log('Graceful shutdown failed, using fallback...');
        return false;
    }
}

function killServer() {
    console.log('killServer');
    return new Promise((resolve, reject) => {
        var ws_url = 'ws://localhost:8765'
        var lws = new WebSocket(ws_url, {
            perMessageDeflate: false
        });
        var ksto = setTimeout(() => {
            console.log('killServer timed out')
            reject();
        }, 500);
        lws.once('open', function open() {
            console.log('killServer open');
            clearTimeout(ksto);
            lws.send(JSON.stringify({ cmd: 'quit' }))
            resolve();
        });
    })
}

function _announceServerStart() {
    serverRunning = true;
    restartCount = 0; // Reset restart count on successful start
    server_events.emit("started");
    console.log(`Server started ${proc.pid}`)
}

var announceServerStart = debounce(_announceServerStart, 200);

function testPythonExists() {
    return new Promise((resolve, reject) => {
        exec("python3 -V", (err, stdout, stderr) => {
            if (err) {
                exec("python -V", (err, stdout, stderr) => {
                    if (err) {
                        return reject(err);
                    } else {
                        var txt = stdout.replace(/\n/g, '').trim();
                        resolve(txt);
                    }
                });
            } else {
                var txt = stdout.replace(/\n/g, '').trim();
                resolve(txt);
            }    
        })
    })
}

async function pythonExists() {
    try {
        var r = await testPythonExists();
        return r;
    } catch (err) {
        return false;
    }
}

function parseLine(streamName, line) {
    if (!serverRunning && line.indexOf("server listening on") > -1) {
        announceServerStart();
    }
    if (streamName === "stderr") {
        errorBuffer.push(line);
    }
    if (showOutputs) console.log(`SERVER.${streamName}: ${line}`)
}

async function stopServer() {
    if (isShuttingDown) return; // Prevent multiple shutdown attempts
    isShuttingDown = true;
    serverRunning = false;

    if (!proc) {
        isShuttingDown = false;
        return;
    }

    try {
        proc.removeAllListeners();
    } catch (e) {}

    try {
        // Try graceful shutdown first
        const gracefulSuccess = await gracefulShutdown();
        if (!gracefulSuccess && proc && !proc.killed) {
            proc.kill(); // Regular SIGTERM
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (proc && !proc.killed) {
                proc.kill('SIGKILL'); // Force kill if still running
            }
        }
    } catch (e) {
        console.error('Error during server shutdown:', e);
    }

    proc = null;
    isShuttingDown = false;
}

function writeSupportFiles() {
    var wpath = getWorkingPath();
    if (!fileExistsSync(wpath)) fs.mkdirSync(wpath);
    Object.keys(sfiles).forEach(fn => {
        var txt = sfiles[fn];
        var out_path = path.join(wpath, fn);
        fs.writeFileSync(out_path, txt, { encoding: 'utf-8' });
        console.log(`Writing ${fn} to ${out_path}...`)
        if (fn == "start_server.sh" && process.platform != "win32") {
            fs.chmodSync(out_path, 0o755);
        }
    })
}

async function startServer() {
    // Reset state if server isn't actually running
    if (!proc || proc.killed) {
        serverRunning = false;
        isShuttingDown = false;
    }

    if (serverRunning || isShuttingDown) {
        console.log('Server already running or shutting down, skipping start');
        return;
    }

    var wpath = getWorkingPath();
    var noWriteFiles = path.join(wpath, "skip_file_write");
    if (!fileExistsSync(noWriteFiles)) writeSupportFiles();

    if (process.platform == "win32") {
        var bat_path = path.join(wpath, 'start_server.bat')
        proc = spawn('cmd.exe', ['/c', bat_path], { detached: false })
    } else {
        var sh_path = path.join(wpath, 'start_server.sh');
        console.log(sh_path)
        proc = spawn(sh_path, { detached: false })
    }

    var stdout = readline.createInterface({ input: proc.stdout });
    var stderr = readline.createInterface({ input: proc.stderr });
    errorBuffer = [];

    stdout.on("line", line => {
        parseLine("stdout", line);
    })

    stderr.on("line", line => {
        parseLine("stderr", line)
    })

    function handleServerExit(code, signal) {
        serverRunning = false;
        proc = null;  // Clear the process reference

        // Don't attempt restart if shutting down or killed intentionally
        if (isShuttingDown || signal === 'SIGTERM' || signal === 'SIGKILL') {
            server_events.emit("stopped", code, signal, errorBuffer);
            return;
        }

        // Handle unexpected exits
        if (restartCount < MAX_RESTARTS) {
            console.log(`Server exited unexpectedly. Attempting restart ${restartCount + 1}/${MAX_RESTARTS}...`);
            restartCount++;
            setTimeout(() => startServer(), RESTART_TIMEOUT);
        } else {
            console.log('Max restart attempts reached');
            server_events.emit("stopped", code, signal, errorBuffer, true); // true indicates max restarts reached
        }
    }

    proc.on('exit', handleServerExit);

    proc.on('error', (err) => {
        console.error('Failed to start server process:', err);
        handleServerExit(1, null);
    });
}

function setShowOutputs(tf) {
    showOutputs = !!(tf)
}

function isServerRunning() {
    return serverRunning;
}

function getProc() {
    return proc;
}

process.on("beforeExit", () => {
    stopServer();
})


async function main() {
    var tf = await testPythonExists()
    console.log(`python exists: ${tf}`)
    server_events.on("started", () => {
        console.log('Woohoo, we are up and running');
    });
    startServer();
}


if (require.main === module) {
    (async() => {
        main();
    })();
}

exports.getProc = getProc;
exports.setShowOutputs = setShowOutputs;
exports.showOutputs = showOutputs;
exports.startServer = startServer;
exports.stopServer = stopServer;
exports.server_events = server_events;
exports.pythonExists = pythonExists;
exports.testPythonExists = testPythonExists;
exports.isServerRunning = isServerRunning;
