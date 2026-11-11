const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cloudEntry = 'https://xunxu-marathon-planner.smart-bean-0955.chatgpt.site/planner/index.html';

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  }).sort();
}

test('a fresh Pages build removes legacy scripts, OCR assets and source archives from the artifact', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xunxu-pages-entry-'));
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'scripts'), {recursive: true});
    fs.copyFileSync(path.join(root, 'scripts/build-static.cjs'), path.join(temporaryRoot, 'scripts/build-static.cjs'));
    fs.cpSync(path.join(root, 'pages-entry'), path.join(temporaryRoot, 'pages-entry'), {recursive: true});
    fs.mkdirSync(path.join(temporaryRoot, 'src'), {recursive: true});
    fs.writeFileSync(path.join(temporaryRoot, 'index.html'), '<script src="app.js"></script>');
    fs.writeFileSync(path.join(temporaryRoot, 'src/app.js'), 'legacy business application');
    fs.mkdirSync(path.join(temporaryRoot, 'dist/vendor/ocr'), {recursive: true});
    fs.writeFileSync(path.join(temporaryRoot, 'dist/app.js'), 'stale local-storage application');
    fs.writeFileSync(path.join(temporaryRoot, 'dist/vendor/ocr/worker.min.js'), 'stale OCR worker');
    fs.writeFileSync(path.join(temporaryRoot, 'dist/cloud-source.zip'), 'source backup must not be published here');

    execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/build-static.cjs')], {cwd: os.tmpdir()});

    assert.deepEqual(listFiles(path.join(temporaryRoot, 'dist')), ['.nojekyll', 'index.html']);
    assert.deepEqual(
      fs.readFileSync(path.join(temporaryRoot, 'dist/index.html')),
      fs.readFileSync(path.join(root, 'pages-entry/index.html')),
    );
    assert.equal(fs.readFileSync(path.join(temporaryRoot, 'dist/.nojekyll'), 'utf8'), '');
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true});
  }
});

test('the entry uses one ordinary cloud link without a local app, embedded login, storage or API client', () => {
  const html = fs.readFileSync(path.join(root, 'pages-entry/index.html'), 'utf8');
  const links = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  assert.deepEqual(links, [cloudEntry]);
  assert.match(html, /<a\b[^>]*href=/i);
  assert.match(html, /name="viewport"\s+content="width=device-width, initial-scale=1"/);
  assert.match(html, /已获授权的账号/);
  assert.match(html, /不在本机读取或保存训练资料/);
  assert.doesNotMatch(html, /<(?:script|iframe|frame|object|embed|form)\b/i);
  assert.doesNotMatch(html, /\bon\w+\s*=/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|serviceWorker|XMLHttpRequest|\bfetch\s*\(|postMessage\s*\(/);
  assert.doesNotMatch(html, /http-equiv\s*=\s*["']refresh/i);
  assert.doesNotMatch(html, /\b(?:src|action)\s*=\s*["']https?:/i);
});

test('the Pages workflow publishes only the entry directory without executing a business-app build', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4\s+with:\s+path: pages-entry(?:\r?\n|$)/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.match(workflow, /run: test -s pages-entry\/index\.html/);
  assert.doesNotMatch(workflow, /\b(?:npm|pnpm|yarn|vinext|wrangler)\b/);
  assert.doesNotMatch(workflow, /path:\s*["']?(?:\.|dist|cloud(?:-source\.zip)?)["']?\s*$/m);
});
