const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'pages-entry');
const output = path.join(root, 'dist');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('Missing pages-entry/index.html');
}

// A fresh output prevents an earlier local-storage app or OCR vendor bundle
// from remaining deployable after switching this repository to a cloud entry.
fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(source, output, {recursive: true});
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Built cloud entry only. The training application runs on its authenticated cloud site.');
