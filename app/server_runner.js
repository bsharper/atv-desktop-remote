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
var proc = false;

var showOutputs = false;
var serverRunning = false;


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

async function stopServerFile() {
    var stopFilePath = path.join(getWorkingPath(), "stopserver");
    await fsp.writeFile(stopFilePath, "stop");
    console.log('stopserver written');
}

function stopServerFileSync() {
    var stopFilePath = path.join(getWorkingPath(), "stopserver");
    fs.writeFileSync(stopFilePath, "stop");
}

function _announceServerStart() {
    // debounce to allow multiple interfaces to bind
    serverRunning = true;
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
    if (showOutputs) console.log(`SERVER.${streamName}: ${line}`)
}

function stopServer() {
    serverRunning = false;
    try {
        if (proc) proc.removeAllListeners();
    } catch (e) {}
    stopServerFileSync();
    if (proc && !proc.killed) {
        try {
            proc.kill()
        } catch (e) {}
        setImmediate(() => {
            try {
                if (!proc.killed) proc.kill('SIGINT');
            } catch (e) {}
            proc = false;
        })
    }
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


function startServer() {
    // only for testing - this bypasses the server start (assumes you are running the server manually)
    // announceServerStart();
    // return;

    var wpath = getWorkingPath();
    var noWriteFiles = path.join(wpath, "skip_file_write");
    if (!fileExistsSync(noWriteFiles)) writeSupportFiles();
    stopServer();


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

    stdout.on("line", line => {
        parseLine("stdout", line);
    })

    stderr.on("line", line => {
        parseLine("stderr", line)
    })

    proc.on('exit', (code, signal) => {
        serverRunning = false;
        server_events.emit("stopped", code);
        console.log(`Server exited with code ${code}`)
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
