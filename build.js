#!/usr/bin/env node
/*
 * Zero-dependency build: `node build.js`
 *   src/plugin/*.js              -> code.js   (plugin logic, Figma sandbox)
 *   src/ui/ui.html + css + js    -> ui.html   (interface, one self-contained file)
 * The built files are committed, so the plugin runs without building.
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pluginDir = path.join(root, 'src/plugin');
const parts = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js')).sort();
const release = JSON.parse(read('version.json'));
if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error('version.json: "version" must look like 1.2.3');
let code = parts.map((f) => `// ---- ${f} ----\n` + read('src/plugin/' + f).trim()).join('\n\n') + '\n';
if (!code.includes('__UK_VERSION__')) throw new Error('version placeholder missing from src/plugin');
code = code.split('__UK_VERSION__').join(release.version);
fs.writeFileSync(path.join(root, 'code.js'), code);

// keep package.json in step with version.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== release.version) {
  pkg.version = release.version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const css = read('src/ui/ui.css');
const js = read('src/ui/ui.js');
if (/<\/script/i.test(js)) throw new Error('ui.js must not contain a closing script tag');
const html = read('src/ui/ui.html')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(root, 'ui.html'), html);

console.log(`version  ${release.version}`);
console.log(`code.js  ${(code.length / 1024).toFixed(1)} KB  (${parts.length} modules)`);
console.log(`ui.html  ${(html.length / 1024).toFixed(1)} KB`);
