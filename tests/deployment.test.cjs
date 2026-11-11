const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('built CSS and scripts resolve inside both root and project Pages deployments', () => {
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:css|js))"/g)].map(match => match[1]);
  assert.equal(assets.length, 7);
  for (const base of ['https://runner.example/', 'https://runner.github.io/planner/']) {
    for (const resource of assets) {
      assert.ok(resource.startsWith('./'), resource + ' must be project-relative');
      const url = new URL(resource, base);
      assert.ok(url.href.startsWith(base));
      assert.ok(fs.existsSync(path.join(root, 'dist', resource)));
    }
  }
  assert.ok(fs.existsSync(path.join(root, 'dist/.nojekyll')));
});

async function workerPaths(baseURI) {
  let captured;
  const engine = { async createWorker(langs, mode, options) {
    captured = options;
    return {
      async setParameters() {},
      async recognize() { return { data: { text: '距离 10 km\n总用时 00:49:30', confidence: 90 } }; },
      async terminate() {},
    };
  } };
  class ImageStub {
    naturalWidth = 2; naturalHeight = 2;
    set src(value) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  class LocalURL extends URL {
    static createObjectURL() { return 'blob:test-image'; }
    static revokeObjectURL() {}
  }
  const canvas = () => ({
    width: 2, height: 2,
    getContext() { return { fillRect() {}, drawImage() {}, putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(16).fill(255) }; } }; },
    toBlob(callback) { callback(new Blob(['preview'])); },
  });
  const context = vm.createContext({
    window: { Tesseract: engine },
    document: { baseURI, createElement(tag) { assert.equal(tag, 'canvas'); return canvas(); } },
    URL: LocalURL, Image: ImageStub, DOMException, Uint8Array, Uint8ClampedArray,
    setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/ocr.js'), 'utf8'), context);
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/png' });
  const parsed = await context.window.RaceOCR.recognize(file);
  assert.equal(parsed.fields.distanceKm, 10);
  return captured;
}

test('actual OCR recognition supplies same-origin absolute worker assets under a Pages project path', async () => {
  const options = await workerPaths('https://runner.github.io/planner/index.html');
  assert.equal(options.workerPath, 'https://runner.github.io/planner/vendor/ocr/worker.min.js');
  assert.equal(options.corePath, 'https://runner.github.io/planner/vendor/ocr/core');
  assert.equal(options.langPath, 'https://runner.github.io/planner/vendor/ocr/lang');
  assert.equal(options.workerBlobURL, false);
});

test('OCR assets also work when the same static bundle is served at a root domain', async () => {
  const options = await workerPaths('https://runner.example/');
  assert.equal(options.workerPath, 'https://runner.example/vendor/ocr/worker.min.js');
  assert.equal(options.corePath, 'https://runner.example/vendor/ocr/core');
  assert.equal(options.langPath, 'https://runner.example/vendor/ocr/lang');
});
