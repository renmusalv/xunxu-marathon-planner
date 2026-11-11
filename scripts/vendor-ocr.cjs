const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist/vendor/ocr');
fs.mkdirSync(path.join(out, 'core'), {recursive:true});
fs.mkdirSync(path.join(out, 'lang'), {recursive:true});
for (const name of ['tesseract.min.js','worker.min.js','tesseract.min.js.LICENSE.txt','worker.min.js.LICENSE.txt']) fs.copyFileSync(path.join(root,'node_modules/tesseract.js/dist',name), path.join(out,name));
for (const name of fs.readdirSync(path.join(root,'node_modules/tesseract.js-core'))) {
  // The wasm.js bundles embed their wasm bytecode; separate .wasm files are unnecessary.
  if (name.endsWith('.wasm.js') || name === 'LICENSE') fs.copyFileSync(path.join(root,'node_modules/tesseract.js-core',name),path.join(out,'core',name));
}
fs.copyFileSync(path.join(root,'node_modules/tesseract.js/LICENSE.md'),path.join(out,'TESSERACT-LICENSE.md'));
for (const lang of ['eng','chi_sim']) fs.copyFileSync(path.join(root,`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),path.join(out,'lang',`${lang}.traineddata.gz`));
fs.copyFileSync(path.join(root,'src/ocr.js'),path.join(root,'dist/ocr.js'));
fs.writeFileSync(path.join(out, 'README.txt'), 'Self-hosted Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (Apache-2.0).\nLanguage models: @tesseract.js-data/eng and @tesseract.js-data/chi_sim 1.0.0 (MIT package license), 4.0.0_best_int.\nNo images are sent to remote OCR services.\nSources: https://github.com/naptha/tesseract.js and https://github.com/naptha/tessdata\nRegenerate with npm ci && npm run vendor:ocr.\n');
console.log('Copied browser OCR engine, embedded wasm cores, and Chinese/English models.');
