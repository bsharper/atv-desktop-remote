const spawn = require('child_process').spawn
const readline = require('readline')
const fs = require('fs')
const fsp = fs.promises
const EventEmitter = require('events');

var server_events = new EventEmitter();
var proc = false;

var showOutputs = false;
var serverRunning = false;

function parseLine(streamName, line) {
    if (!serverRunning && line.indexOf("server listening on") > -1) {
        console.log(`${streamName} Server started ${proc.pid}`)
        serverRunning = true;
        server_events.emit("started");
    }
    if (showOutputs) console.log(`SERVER.${streamName}: ${line}`)
}

function stopServer() {
    console.log(`stopServer called ${proc.killed}`)
    if (proc && !proc.killed) {
        try {
            proc.removeAllListeners();
        } catch (e) {}
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

function startServer() {
    stopServer();
    proc = spawn("/Users/brianharper/Projects/atv-desktop-remote/pytest/start_server.sh", { detached: false })
    var stdout = readline.createInterface({ input: proc.stdout });
    var stderr = readline.createInterface({ input: proc.stderr });

    stdout.on("line", line => {
        parseLine("stdout", line);
    })

    stderr.on("line", line => {
        parseLine("stderr", line)
    })

    proc.on('exit', (code, signal) => {

        serverRunning = true;
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

process.on("beforeExit", () => {
    stopServer();
})


function main() {
    server_events.on("started", () => {
        console.log('Woohoo, we are up and running');
    });
    startServer();
}


if (require.main === module) {
    main();
}
exports.setShowOutputs = setShowOutputs;
exports.showOutputs = showOutputs;
exports.startServer = startServer;
exports.stopServer = stopServer;
exports.server_events = server_events;
exports.isServerRunning = isServerRunning;