const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {vendorOcr} = require('./vendor-ocr.cjs');
const {vendorCloud} = require('./vendor-cloud.cjs');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const CONFIG_KEYS = ['supabaseUrl', 'supabasePublishableKey', 'emailLoginEnabled'];

function readPublicConfig(source, environment = process.env) {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), context, {timeout: 1000, filename: 'cloud-config.js'});
  const configured = context.window.XUNXU_CONFIG;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)
      || Object.keys(configured).some(key => !CONFIG_KEYS.includes(key))) {
    throw new Error('cloud-config.js must contain only the three supported public configuration fields.');
  }
  const config = {...configured};
  for (const [variable, field] of [['SUPABASE_URL', 'supabaseUrl'], ['SUPABASE_PUBLISHABLE_KEY', 'supabasePublishableKey']]) {
    const value = environment[variable];
    if (value !== undefined && String(value).trim() !== '') config[field] = String(value).trim();
  }
  const enabled = environment.EMAIL_LOGIN_ENABLED;
  if (enabled !== undefined && String(enabled).trim() !== '') {
    const value = String(enabled).trim().toLowerCase();
    if (!['true', 'false'].includes(value)) throw new Error('EMAIL_LOGIN_ENABLED must be true or false.');
    config.emailLoginEnabled = value === 'true';
  }
  if (typeof config.supabaseUrl !== 'string' || typeof config.supabasePublishableKey !== 'string'
      || typeof config.emailLoginEnabled !== 'boolean') {
    throw new Error('Public cloud configuration needs two strings and an explicit emailLoginEnabled boolean.');
  }
  config.supabaseUrl = config.supabaseUrl.trim();
  config.supabasePublishableKey = config.supabasePublishableKey.trim();
  if (config.supabaseUrl) {
    let url;
    try { url = new URL(config.supabaseUrl); } catch { throw new Error('SUPABASE_URL must be a valid HTTPS project origin.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('SUPABASE_URL must be an HTTPS project origin without credentials, path, query or fragment.');
    }
    config.supabaseUrl = url.origin;
  }
  if (config.supabasePublishableKey && !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(config.supabasePublishableKey)) {
    throw new Error('Only a public sb_publishable_ key may be shipped. Secret and service_role keys are forbidden.');
  }
  if (config.emailLoginEnabled && (!config.supabaseUrl || !config.supabasePublishableKey)) {
    throw new Error('Enable email login only after providing both the Supabase URL and its publishable key.');
  }
  return Object.fromEntries(CONFIG_KEYS.map(key => [key, config[key]]));
}

function buildStatic({projectRoot = DEFAULT_ROOT, environment = process.env} = {}) {
  const source = path.join(projectRoot, 'src');
  const output = path.join(projectRoot, 'dist');
  const config = readPublicConfig(path.join(source, 'cloud-config.js'), environment);
  for (const name of ['app.js', 'profile-store.js', 'supabase-cloud.js', 'ocr.js', 'enhancements.css']) {
    if (!fs.existsSync(path.join(source, name))) throw new Error('Missing public planner module: ' + name);
  }
  if (!fs.existsSync(path.join(projectRoot, 'index.html'))) throw new Error('Missing planner index.html');

  // Publish a fresh allowlisted static artifact, never a source archive,
  // previous landing page, server bundle, credentials or runtime data.
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  fs.copyFileSync(path.join(projectRoot, 'index.html'), path.join(output, 'index.html'));
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
      fs.copyFileSync(path.join(source, entry.name), path.join(output, entry.name));
    }
  }
  // Only reviewed visual assets are published; no health export or test fixture.
  const hero = path.join(projectRoot, 'assets', 'half-marathon-hero.jpg');
  if (fs.existsSync(hero)) {
    fs.mkdirSync(path.join(output, 'assets'), {recursive: true});
    fs.copyFileSync(hero, path.join(output, 'assets', 'half-marathon-hero.jpg'));
  }
  // Environment overrides affect the generated artifact only. The tracked
  // default configuration remains available for an unconfigured trial build.
  fs.writeFileSync(path.join(output, 'cloud-config.js'), 'window.XUNXU_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
  vendorOcr({projectRoot});
  vendorCloud({projectRoot});
  fs.writeFileSync(path.join(output, '.nojekyll'), '');

  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  for (const [, resource] of html.matchAll(/(?:src|href)="([^"#]+\.(?:css|js|jpg))"/g)) {
    const resolved = path.resolve(output, resource);
    if (!resource.startsWith('./') || !resolved.startsWith(output + path.sep) || !fs.existsSync(resolved)) {
      throw new Error('Planner asset must exist under the Pages project path: ' + resource);
    }
  }
  return {output, config};
}

if (require.main === module) {
  const result = buildStatic();
  console.log('Built full public planner with self-hosted OCR and Supabase SDK. Email login flag: ' + result.config.emailLoginEnabled + '.');
}
module.exports = {buildStatic, readPublicConfig};
