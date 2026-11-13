const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {buildStatic, readPublicConfig} = require('../scripts/build-static.cjs');

const root = path.resolve(__dirname, '..');
const emptyConfig = "window.XUNXU_CONFIG = {supabaseUrl:'',supabasePublishableKey:'',emailLoginEnabled:false,sharedLoginEmail:'',passwordLoginEnabled:false};\n";
const publicEnvironment = {
  SUPABASE_URL: 'https://example-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture_only',
  EMAIL_LOGIN_ENABLED: 'true',
  SHARED_LOGIN_EMAIL: 'shared@example.com',
  PASSWORD_LOGIN_ENABLED: 'true',
};

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}

function temporaryProject() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xunxu-public-pages-'));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(temporaryRoot, 'package.json'));
  fs.copyFileSync(path.join(root, 'index.html'), path.join(temporaryRoot, 'index.html'));
  fs.cpSync(path.join(root, 'src'), path.join(temporaryRoot, 'src'), {recursive: true});
  fs.cpSync(path.join(root, 'assets'), path.join(temporaryRoot, 'assets'), {recursive: true});
  fs.writeFileSync(path.join(temporaryRoot, 'src/cloud-config.js'), emptyConfig);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporaryRoot, 'node_modules'), 'dir');
  return temporaryRoot;
}

function withConfig(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xunxu-public-config-'));
  const source = path.join(directory, 'cloud-config.js');
  fs.writeFileSync(source, emptyConfig);
  try { return work(source); } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}

test('full static build includes local SDK/OCR assets and excludes old landing pages, server output and source archives', () => {
  const temporaryRoot = temporaryProject();
  const trackedConfigBefore = fs.readFileSync(path.join(root, 'src/cloud-config.js'));
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'dist/server'), {recursive: true});
    fs.writeFileSync(path.join(temporaryRoot, 'dist/server/worker.js'), 'stale private server bundle');
    fs.writeFileSync(path.join(temporaryRoot, 'dist/obsolete.js'), 'stale asset');
    fs.writeFileSync(path.join(temporaryRoot, 'cloud-source.zip'), 'legacy source archive');
    fs.writeFileSync(path.join(temporaryRoot, 'assets/export.xml'), 'private health export must not publish');
    fs.mkdirSync(path.join(temporaryRoot, '.openai'));
    fs.writeFileSync(path.join(temporaryRoot, '.openai/hosting.json'), '{"testOnly":"must not ship"}');

    const built = buildStatic({projectRoot: temporaryRoot, environment: {}});
    const files = listFiles(built.output);
    assert.ok(files.includes('index.html') && files.includes('app.js') && files.includes('.nojekyll'));
    assert.ok(files.includes('cloud-config.js') && files.includes('supabase-cloud.js'));
    assert.ok(files.includes('assets/half-marathon-hero.jpg'));
    assert.deepEqual(files.filter(file=>file.startsWith('assets/')),['assets/half-marathon-hero.jpg']);
    assert.ok(files.includes('vendor/supabase/supabase.js') && files.includes('vendor/supabase/LICENSE'));
    assert.ok(files.includes('vendor/ocr/tesseract.min.js') && files.includes('vendor/ocr/worker.min.js'));
    assert.equal(files.filter(file => /^vendor\/ocr\/core\/.+\.wasm\.js$/.test(file)).length, 6);
    assert.deepEqual(files.filter(file => /^vendor\/ocr\/lang\//.test(file)), [
      'vendor/ocr/lang/chi_sim.traineddata.gz', 'vendor/ocr/lang/eng.traineddata.gz',
    ]);
    assert.ok(!files.some(file => /^(?:server|pages-entry|src|node_modules|\.openai)\//.test(file)));
    assert.ok(!files.some(file => /(?:cloud-source|obsolete|\.env|\.zip$)/.test(file)));
    assert.deepEqual(
      fs.readFileSync(path.join(built.output, 'vendor/supabase/supabase.js')),
      fs.readFileSync(path.join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')),
    );
    assert.deepEqual(fs.readFileSync(path.join(built.output, 'index.html')), fs.readFileSync(path.join(root, 'index.html')));

    const html = fs.readFileSync(path.join(built.output, 'index.html'), 'utf8');
    assert.match(html, /id="plannerForm"/);
    assert.match(html, /id="weekList"/);
    assert.match(html, /src="\.\/vendor\/supabase\/supabase\.js"/);
    assert.doesNotMatch(html, /signin-with-chatgpt|signout-with-chatgpt|<iframe\b/i);
    const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:css|js|jpg))"/g)].map(match => match[1]);
    for (const base of ['https://runner.example/', 'https://renmusalv.github.io/xunxu-marathon-planner/']) {
      for (const resource of assets) {
        assert.ok(resource.startsWith('./'));
        assert.ok(new URL(resource, base).href.startsWith(base));
        assert.ok(fs.existsSync(path.join(built.output, resource)));
      }
    }
    const generated = {window: {}};
    vm.runInNewContext(fs.readFileSync(path.join(built.output, 'cloud-config.js'), 'utf8'), generated);
    assert.equal(generated.window.XUNXU_CONFIG.emailLoginEnabled, false);
    assert.equal(generated.window.XUNXU_CONFIG.sharedLoginEmail, '');
    assert.equal(generated.window.XUNXU_CONFIG.passwordLoginEnabled, false);
    assert.equal(generated.window.XUNXU_CONFIG.supabaseUrl, '');
    assert.equal(generated.window.XUNXU_CONFIG.supabasePublishableKey, '');
    assert.deepEqual(fs.readFileSync(path.join(root, 'src/cloud-config.js')), trackedConfigBefore);
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true});
  }
});

test('public environment configuration overrides only the generated config and never includes unrelated credentials', () => {
  withConfig(source => {
    const before = fs.readFileSync(source);
    const config = readPublicConfig(source, {...publicEnvironment, SUPABASE_SERVICE_ROLE_KEY: 'never-publish-this'});
    assert.deepEqual(config, {
      supabaseUrl: 'https://example-project.supabase.co',
      supabasePublishableKey: 'sb_publishable_test_fixture_only',
      emailLoginEnabled: true,
      sharedLoginEmail: 'shared@example.com',
      passwordLoginEnabled: true,
    });
    assert.doesNotMatch(JSON.stringify(config), /never-publish|service_role/i);
    assert.deepEqual(fs.readFileSync(source), before);
  });
});

test('unconfigured trial builds are valid while secret keys and misleading enabled configuration are rejected', () => {
  withConfig(source => {
    assert.deepEqual(readPublicConfig(source, {}), {supabaseUrl: '', supabasePublishableKey: '', emailLoginEnabled: false, sharedLoginEmail: '', passwordLoginEnabled: false});
    assert.equal(readPublicConfig(source, {...publicEnvironment, EMAIL_LOGIN_ENABLED: 'false'}).emailLoginEnabled, false);
    for (const key of [
      'sb_secret_do_not_publish',
      ['eyJhbGciOiJIUzI1NiJ9', Buffer.from('{"role":"service_role"}').toString('base64url'), 'test-only'].join('.'),
    ]) assert.throws(() => readPublicConfig(source, {...publicEnvironment, SUPABASE_PUBLISHABLE_KEY: key}), /publishable|forbidden/);
    assert.throws(() => readPublicConfig(source, {EMAIL_LOGIN_ENABLED: 'true'}), /both the Supabase URL/);
    assert.throws(() => readPublicConfig(source, {...publicEnvironment, EMAIL_LOGIN_ENABLED: 'yes'}), /true or false/);
    for (const url of ['http://example.supabase.co', 'https://user:password@example.supabase.co', 'https://example.supabase.co/?key=secret']) {
      assert.throws(() => readPublicConfig(source, {...publicEnvironment, SUPABASE_URL: url}), /HTTPS project origin/);
    }
  });
});

test('Pages pipeline tests and builds the public planner before uploading only dist', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
  const positions = ['run: npm ci --no-audit --no-fund', 'run: npm test', 'run: npm run build', 'uses: actions/upload-pages-artifact@v4'].map(text => workflow.indexOf(text));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a,b) => a-b), positions);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v4\s+with:\s+path: dist(?:\r?\n|$)/);
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'EMAIL_LOGIN_ENABLED', 'SHARED_LOGIN_EMAIL', 'PASSWORD_LOGIN_ENABLED']) {
    assert.ok(workflow.includes(name + ': ' + '$' + '{{ vars.' + name + ' }}'));
  }
  assert.doesNotMatch(workflow, /path:\s*(?:pages-entry|\.|cloud-source\.zip)\s*$/m);
  assert.doesNotMatch(workflow, /service_role|SUPABASE_SERVICE_ROLE|sb_secret_/i);
});
