const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const createMockFigma = require('./mock-figma.js');
const load = require('./load.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const OLD_KEY = 'utilitykit.update.v1';

/** Starts code.js the way Figma does (no test hooks), optionally the way an old loader did. */
function start({ oldLoader } = {}) {
  const env = createMockFigma();
  const posted = [];
  env.figma.ui._sink = (m) => posted.push(m);
  env.storage[OLD_KEY] = JSON.stringify({ version: '2.0.0', code: 'x'.repeat(2000), html: 'y'.repeat(2000), pending: true });
  const sandbox = { figma: env.figma, console, __html__: 'FOLDER-UI' };
  vm.createContext(sandbox);
  const code = read('code.js');
  if (oldLoader) {
    // What UtilityKit v1.3–v2.0 did with an update it had saved.
    const run = vm.runInContext('(function (figma, __html__, UKLoader, __UK_DOWNLOADED__) {\n' + code + '\n})', sandbox);
    run(env.figma, 'SAVED-UI', oldLoader, true);
  } else {
    vm.runInContext(code, sandbox);
  }
  const ask = (type) => new Promise((resolve) => {
    env.figma.ui._sink = (m) => { if (m.type === 'result' && m.id === 9) resolve(JSON.parse(JSON.stringify(m))); };
    env.figma.ui.onmessage({ type, id: 9 });
  });
  return { env, ask };
}

test('nothing in the plugin can download or run new code', () => {
  const code = read('code.js'), html = read('ui.html');
  for (const [name, text] of [['code.js', code], ['ui.html', html]]) {
    assert.doesNotMatch(text, /\beval\s*\(/, name + ': no eval');
    assert.doesNotMatch(text, /\bfetch\s*\(/, name + ': no fetch');
    assert.doesNotMatch(text, /githubusercontent/, name);
  }
  assert.doesNotMatch(html, /Check for updates|Update now/, 'nothing in the interface offers an update');
  assert.doesNotMatch(code, /new Function\s*\(/);
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.networkAccess, { allowedDomains: ['none'] }, 'the manifest allows no network access');
  assert.equal(fs.existsSync(path.join(root, 'update.command')), false);
  assert.equal(fs.existsSync(path.join(root, 'update.bat')), false);
});

test('update requests no longer exist', async () => {
  const { call } = load();
  for (const type of ['update.check', 'update.install', 'update.restart', 'update.remove', 'update.open']) {
    const res = await call(type);
    assert.equal(res.ok, false, type);
    assert.match(res.error.message, /Unknown request/);
  }
  const init = await call('init');
  assert.equal(init.data.install, undefined);
});

test('started from the plugin folder: opens, and removes a copy the old Update now had saved', async () => {
  const { env, ask } = start();
  assert.equal(env.log.ui.length, 1);
  assert.equal(env.log.ui[0].html, 'FOLDER-UI');
  const init = await ask('init');
  assert.equal(init.ok, true);
  assert.equal(init.data.version, JSON.parse(read('version.json')).version);
  assert.equal(env.storage[OLD_KEY], undefined, 'the saved old copy is gone');
});

test('started by an older UtilityKit that had installed this version: runs, confirms, and keeps its copy', async () => {
  let confirmed = 0;
  const oldLoader = { confirm: async () => { confirmed++; } };
  const { env, ask } = start({ oldLoader });
  assert.equal(env.log.ui[0].html, 'SAVED-UI');
  const init = await ask('init');
  assert.equal(init.ok, true);
  assert.equal(confirmed, 1, 'the old loader is told this copy started fine, so it keeps running it');
  assert.notEqual(env.storage[OLD_KEY], undefined, 'its saved copy is left alone, or the old version would come back');
});
