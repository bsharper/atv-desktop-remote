var Promise = require('bluebird')

var term = require( 'terminal-kit' ).terminal
const readline = require('readline');
const ora = require('ora');
const fs = require('fs')
const fsp = fs.promises;

var atv = require('node-appletv-x')

const configFile = 'myappletv.json'

const keymap = {
    'left': 'Left',
    'right': 'Right',
    'up': 'Up',
    'down': 'Down',
    'return': 'Select',
    'space': (latv) => { if (latv.playing) return 'Pause'; return 'Play' },
    'backspace': 'Menu',
    'escape': 'Menu',
    't': 'Tv',
    'l': 'LongTv'
}

const keyDesc = {
    'space': 'Pause/Play',
    'left': 'left arrow',
    'right': 'right arrow',
    'up': 'up arrow',
    'down': 'down arrow',
    't': 'TV Button',
    'l': 'Long-press TV Button'
}

function box (str) {
    var ln = "=".repeat(str.length);
    return `${ln}\n${str}\n${ln}\n`
}

function exists (filepath) {
    return new Promise ((resolve, reject) => {
        fs.access(filepath, err => {
            if (err) return resolve (false);
            resolve (true);
        });
    })
}


async function checkSavedDevice () {
    try {
        var atvconfig = JSON.parse(await fsp.readFile(configFile, {encoding: 'utf-8'}));
        return atvconfig;
    } catch (err) {
        return false;
    }
}

function picker (items) {
    return new Promise ((resolve, reject) => {
        term.singleColumnMenu(items, (err, response) => {
            if (err) return reject (err);
            resolve(response);
        });
    })
}

function gstringify (obj) {
    var cache = [];
    var rs = JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null) {
            if (cache.indexOf(value) !== -1) {
                return;
            }
            cache.push(value);
        }
        return value;
    }, 4);
    cache = null;
    return rs;
}

function inputPIN () {
    return new Promise ((resolve, reject) => {
        term( 'Enter the PIN shown on the Apple TV: ' )
        term.inputField({ minLength: 4, maxLength: 4 } , ( error , input ) => {
            if (error) return reject (error)
            resolve(input)
        })
    })
}

async function pairDevice (device) {
    await device.openConnection();
    let callback = await device.pair();
    var pin = await inputPIN();
    await callback(pin);
    let credentials = device.credentials.toString();
    var data = JSON.stringify({credentialsString: credentials}, null, 4);
    await fsp.writeFile(configFile, data, {encoding: 'utf-8'}); 
    device.closeConnection()
    return credentials
}

async function pickDevice () {
    const spinner = ora({
        text: "Scanning for Apple TVs",
        spinner: "dots",
        interval: 40
    })
    spinner.start();
    var devices = await atv.scan();
    spinner.succeed();
    var ar = {}
    var ks = [];
    devices.forEach(d => {
        var k = `${d.name} ${d.address}`
        ar[k] = d;
        ks.push(k);
    })
    term.cyan( `Select Apple TV to use:\n` ) ;
    try {
        var response = await picker(ks);
    } catch (err) {
        console.error(`Error: ${err}`)
        return false;
    }
    var device = ar[response.selectedText];
    var credentials = await pairDevice(device);
    return credentials
}

function tryGetArtwork(myatv) {
    var resolved = false;
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            console.log('timeout');
            resolve(false);
        }, 1000);
        myatv.requestArtwork().then(r => {
            if (resolved) return;
            resolved = true;
            resolve(true);
        }).catch(err => {
            if (resolved) return;
            resolved = true;
            console.log(err);
            resolve(false);
        })
    })
}



async function getMyATV() {
    var credentialsString = "";
    let atvconfig = await checkSavedDevice();
    if (! atvconfig) {
        credentialsString = await pickDevice();
    } else {
        credentialsString = atvconfig.credentialsString;
    }
    if (! credentialsString) return false;
    let credentials = atv.parseCredentials(credentialsString);
    let devices = await atv.scan(credentials.uniqueIdentifier)
    let device = devices[0];
    await device.openConnection(credentials);
    device.playing = false //await tryGetArtwork(device);
    // device.on('message', m => {
    //     if (m.message.type != 4) return;
    //     if ( ! m.payload || ! m.payload.playbackState) return;
    //     device.playing = m.payload.playbackState == 2
    //     device.emit('playStateChange', device.playing)
    // })
    device.on('nowPlaying', info => {
        if ((! info) || (! info.playbackState)) {
            return;
        }
        console.log(info);
        device.playing = info.playbackState == 'playing';
        //device.emit('playStateChange', device.playing)
    });
    device.Key = atv.AppleTV.Key;
    return device;
}

function showHelp() {
    term.cyan(box("AppleTV Remote Keymap"))
    Object.keys(keymap).forEach(k => {
        var nm = keymap[k];
        var kn = k;
        if (Object.keys(keyDesc).indexOf(kn) > -1) {
            kn = keyDesc[k]
        }
        term.white(" Key ").brightBlue(kn).white(":").green(" %s\n", nm);
    })
}

function keyboardInput (myatv) {
    return new Promise ((resolve, reject) => {
        const spinnerOpts = {
            text: "AppleTV Keyboard Remote Active (? for help)",
            spinner: "bouncingBall",
            interval: 160
        }
        const maxLines = 10;
        var curLine = 0;
        var numCommands = 0;
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        var spinner = ora(spinnerOpts)
        var exiting = false;
        var lines = [];
        for (var i=0; i<maxLines; i++) {
            lines.push("");
            term.nextLine();
        }
        
        spinner.start();
        var lastKey = Date.now();
        process.stdin.on('keypress', (str, key) => {
            //console.log(str, key);
            var now = Date.now();
            if (now - lastKey < 50) return;
            lastKey = now;
            if (key.sequence === '?') {
                if (! exiting) spinner.succeed('? pressed, showing help')
                showHelp();
                spinner = ora(spinnerOpts)
                spinner.start();
            }
            if ((key.ctrl && key.name === 'c') || (key.name === 'q')) {
                if (! exiting) spinner.succeed('CTRL-C or q pressed, exiting')
                exiting = true;
                resolve();
                setTimeout(() => {
                    console.log('force quitting');
                    process.exit()
                }, 1000);
            } else {
                Object.keys(keymap).forEach(k => {
                    if (str == k || key.name == k) {
                        var rcmd = keymap[k];
                        if (typeof(rcmd) === 'function') rcmd = rcmd(myatv);
                        if (! exiting) {
                            var txt = term.str.dim(`[${++numCommands}] AppleTV command: ${rcmd} (key press: ${k})`)
                            spinner.succeed(txt)
                            lines.push(`✔ ${txt}`);
                            lines.shift();
                            term.previousLine(maxLines+1);
                            lines.forEach(ln => {
                                term.eraseLine();
                                process.stdout.write(ln);
                                term.nextLine();
                            })
                            myatv.sendKeyCommand(atv.AppleTV.Key[rcmd])
                            term.eraseLine();
                            spinner = ora(spinnerOpts)
                            spinner.start();
                        }
                    }
                })
            }
        });
    })
}

function showImage(filename) {
    return new Promise ((resolve, reject) => {
        var sz = {width: term.width*.5, height: term.width*.5};
        //var sz = {width: term.width, height: term.width};
        var opts = {shrink: sz};
        //var opts = {};
        term.drawImage(filename, opts, (err) => {
            if (err) return reject(err);
            resolve();
        })
    });
}

function slowType(txt) {
    return new Promise ((resolve, reject) => {
        term.slowTyping(txt, (err) => {
            if (err) return reject(err);
            resolve();
        })
    });
}



async function main() {
    var myatv = await getMyATV();
    term.fullscreen();
    //await showImage('atv2.png');
    term.bold.white("AppleTV information: ").brightBlue(myatv.name).green(" (%s)\n", myatv.address);
    term.cyan(box("AppleTV Remote Keyboard Control"))
    await keyboardInput(myatv)
    return
}

if (require.main === module) {
    (async () => {
            await main()
            process.exit()
    })()
}

exports.getMyATV = getMyATV
