const fs = require('node:fs');
const path = require('node:path');

function vendorCloud({projectRoot = path.resolve(__dirname, '..')} = {}) {
  const name = '@supabase/supabase-js';
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const pinned = manifest.dependencies?.[name] || manifest.devDependencies?.[name];
  if (typeof pinned !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pinned)) {
    throw new Error('Pin @supabase/supabase-js to an exact version before building.');
  }
  const source = path.join(projectRoot, 'node_modules', name);
  const installed = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (installed.version !== pinned) throw new Error('Installed Supabase SDK does not match package.json; run npm ci.');
  const bundle = path.join(source, 'dist/umd/supabase.js');
  if (!fs.existsSync(bundle)) throw new Error('The pinned official Supabase package has no browser UMD bundle.');
  const output = path.join(projectRoot, 'dist/vendor/supabase');
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  fs.copyFileSync(bundle, path.join(output, 'supabase.js'));
  fs.copyFileSync(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
  if (fs.existsSync(bundle + '.map')) fs.copyFileSync(bundle + '.map', path.join(output, 'supabase.js.map'));
  fs.writeFileSync(path.join(output, 'README.txt'), 'Self-hosted official @supabase/supabase-js ' + installed.version + ' browser UMD bundle (MIT).\nSource: https://github.com/supabase/supabase-js\nGenerated from the package-lock.json installation; no runtime CDN is used.\nRegenerate with npm ci && npm run build.\n');
  return {version: installed.version, output};
}

if (require.main === module) {
  const result = vendorCloud();
  console.log('Copied official Supabase browser SDK ' + result.version + '.');
}
module.exports = {vendorCloud};
