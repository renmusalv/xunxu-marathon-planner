const fs = require('node:fs');
const path = require('node:path');

function vendorOcr({projectRoot = path.resolve(__dirname, '..')} = {}) {
  const modules = path.join(projectRoot, 'node_modules');
  const output = path.join(projectRoot, 'dist/vendor/ocr');
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(path.join(output, 'core'), {recursive: true});
  fs.mkdirSync(path.join(output, 'lang'), {recursive: true});
  for (const name of ['tesseract.min.js', 'worker.min.js', 'tesseract.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt']) {
    fs.copyFileSync(path.join(modules, 'tesseract.js/dist', name), path.join(output, name));
  }
  for (const name of fs.readdirSync(path.join(modules, 'tesseract.js-core'))) {
    // Each wasm.js bundle includes its own WebAssembly bytes.
    if (name.endsWith('.wasm.js') || name === 'LICENSE') {
      fs.copyFileSync(path.join(modules, 'tesseract.js-core', name), path.join(output, 'core', name));
    }
  }
  fs.copyFileSync(path.join(modules, 'tesseract.js/LICENSE.md'), path.join(output, 'TESSERACT-LICENSE.md'));
  for (const lang of ['eng', 'chi_sim']) {
    fs.copyFileSync(
      path.join(modules, '@tesseract.js-data', lang, '4.0.0_best_int', lang + '.traineddata.gz'),
      path.join(output, 'lang', lang + '.traineddata.gz'),
    );
  }
  const version = name => JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(output, 'README.txt'),
    'Self-hosted Tesseract.js ' + version('tesseract.js') + ' and tesseract.js-core ' + version('tesseract.js-core') + ' (Apache-2.0).\n'
    + 'Language packages: eng ' + version('@tesseract.js-data/eng') + ', chi_sim ' + version('@tesseract.js-data/chi_sim') + '; 4.0.0_best_int models.\n'
    + 'Recognition runs in the browser; no image is sent to a third-party OCR service.\n'
    + 'Sources: https://github.com/naptha/tesseract.js and https://github.com/naptha/tessdata\n'
    + 'Regenerate with npm ci && npm run build.\n');
  return output;
}

if (require.main === module) {
  vendorOcr();
  console.log('Copied OCR runtime, embedded WebAssembly cores and Chinese/English models.');
}
module.exports = {vendorOcr};
