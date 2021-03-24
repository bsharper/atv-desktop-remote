var Promise = require("bluebird");

Promise.config({
	cancellation: true
});

var rmt = require('./remote')
const readline = require('readline');

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function main () {
    console.log(`Starting device scan...`)
    var ds = await rmt.scanDevices();
    console.log(ds);
    if (ds.length === 0) {
        console.log('No devices found');
        return;
    }
    var d = ds[0];
    console.log(`Starting pairing to ${d}`)
    try {
        await rmt.startPairWithTimeout(d, 30000) // 30 seconds
    } catch (err) {
        if (err instanceof Promise.TimeoutError) {
            console.log(`Start pairing timed out (${err})`)
        } else {
            console.log(`Could not start pairing: ${err}`)
        }
        return false;
    }
    var pin = await askQuestion('Enter pin number: ')
    pin = pin.replace(/[^0-9]/g, '') // replace any non-numbers with numbers
    console.log(`Finishing pairing with pin number: ${pin}`)
    try {
        var creds = await rmt.finishPairWithTimeout(pin, 300000) // 5 minute timeout
    } catch (err) {
        console.log(`Pairing timed out`)
        return false;
    }
    console.log(`All done\nCreds: ${creds}`)
    return true;
}

(async () => {
    await main();
})()