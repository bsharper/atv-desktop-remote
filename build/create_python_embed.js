const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const out_filename = `pyscripts.js`;


process.chdir(__dirname);

async function main(overwrite = false) {
    var input_files = ['wsserver.py', 'start_server.bat', 'start_server.sh'];
    
    var output_text = "";
    
    var files = {};
    for (var i = 0; i < input_files.length; i++) {
        var fn = input_files[i];
        files[fn] = await fsp.readFile(fn, { encoding: 'utf-8' });
    }
    
    output_text = `const files = ${JSON.stringify(files, null, 4)};\n\n`;
    output_text += `exports.files = files;\n`;
    
   
    if (overwrite) {
        const app_out_filename = '../app/pyscripts.js';
        const current_path = path.resolve(__dirname);
        const app_out_path = path.join(current_path, app_out_filename);
        await fsp.writeFile(app_out_path, output_text, { encoding: 'utf-8' });
        console.log(`${app_out_path} written.`);
    } else {
        await fsp.writeFile(out_filename, output_text, { encoding: 'utf-8' });
        console.log(`${out_filename} written.`);    
    }
}

(async () => {
    const args = process.argv.slice(2);
    const overwrite = args.includes('--overwrite');
    await main(overwrite);
})();