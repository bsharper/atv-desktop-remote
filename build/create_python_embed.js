const fs = require('fs');

const out_filename = `pyscripts.js`

var input_files = ['wsserver.py', 'start_server.bat', 'start_server.sh']

var output_text = "";

var files = {}
input_files.forEach(fn => {
    files[fn] = fs.readFileSync(fn, { encoding: 'utf-8' });
})

output_text = `const files = ${JSON.stringify(files, null, 4)};\n\n`
output_text += `exports.files = files;\n`
    // var afls = {}

// input_files.forEach(fn => {
//     var gfn = fn.replace(/\./g, '_');
//     afls[gfn] = fn;
//     var data = fs.readFileSync(fn, { encoding: 'utf-8' });
//     var txt = `const ${gfn} = \`${data}\`;\n\n`
//     output_text += txt;
// })

// output_text += `var files = ${JSON.stringify(afls)};\n`



fs.writeFileSync(out_filename, output_text, { encoding: 'utf-8' });