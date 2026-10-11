const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load.js');

const KEY = 'utilitykit.update.v1';
const RAW = 'https://raw.githubusercontent.com/hiteshramawat01-oss/UtilityKit/main/';
const builtHtml = fs.readFileSync(path.join(__dirname, '..', 'ui.html'), 'utf8');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

/** The real plugin files, re-stamped as another version — what a later release looks like on GitHub. */
function release(code, version) {
  return {
    'version.json': JSON.stringify({ version, notes: ['New: something.'] }),
    'code.js': code.replace(/var UK = \{ VERSION: '[\d.]+' \}/, `var UK = { VERSION: '${version}' }`),
    'ui.html': builtHtml.replace(/(utilitykit-version" content=")[\d.]+/, `$1${version}`) + `<!-- release ${version} -->`
  };
}
function serve(sandbox, files, log) {
  sandbox.fetch = async (url) => {
    const name = String(url).replace(RAW, '').replace(/\?.*$/, '');
    if (log) log.push(String(url));
    if (!String(url).startsWith(RAW) || !(name in files)) return reply(404, 'not found');
    if (files[name] instanceof Error) throw files[name];
    return reply(200, files[name]);
  };
}
/** Talks to whichever copy is currently running, the way the interface does. */
function ask(env, type, payload) {
  return new Promise((resolve) => {
    env.figma.ui._sink = (m) => { if (m.type === 'result' && m.id === 77) resolve(JSON.parse(JSON.stringify(m))); };
    env.figma.ui.onmessage({ type, id: 77, payload });
  });
}
const saved = (env) => (env.storage[KEY] ? JSON.parse(env.storage[KEY]) : null);
const lastUi = (env) => env.log.ui[env.log.ui.length - 1].html;

test('nothing saved: the copy in the plugin folder runs', async () => {
  const { UK, UKLoader, env } = load();
  const info = await UKLoader.start(() => UK.boot());
  assert.equal(info.source, 'bundled');
  assert.equal(info.version, UK.VERSION);
  assert.equal(env.log.ui.length, 1);
  assert.equal(lastUi(env), 'BUNDLED-UI');
  const init = await ask(env, 'init');
  assert.equal(init.data.install.source, 'bundled');
  assert.equal(init.data.install.canSelfUpdate, false, 'no fetch in this sandbox');
});

test('update now: download, save, restart into the new version, confirm', async () => {
  const { UK, UKLoader, env, sandbox, code } = load();
  await UKLoader.start(() => UK.boot());
  const urls = [];
  serve(sandbox, release(code, '9.9.0'), urls);

  let res = await ask(env, 'update.check');
  assert.equal(res.data.updateAvailable, true);
  assert.equal(res.data.canSelfUpdate, true);

  urls.length = 0;
  res = await ask(env, 'update.install');
  assert.deepEqual(res.data, { installed: true, version: '9.9.0', previous: UK.VERSION });
  assert.deepEqual(urls.map((u) => u.replace(/\?t=\d+$/, '')), [RAW + 'version.json', RAW + 'code.js', RAW + 'ui.html'], 'fixed addresses only');
  assert.equal(saved(env).version, '9.9.0');
  assert.equal(saved(env).pending, false);
  assert.equal(env.log.ui.length, 1, 'nothing switches until restart');

  env.figma.ui.onmessage({ type: 'update.restart', id: 78 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(env.log.ui.length, 2);
  assert.match(lastUi(env), /<!-- release 9\.9\.0 -->$/, 'the downloaded interface is shown');
  assert.equal(saved(env).pending, true, 'not trusted until its interface loads');
  assert.equal(env.listeners.selectionchange.length, 1, 'the old copy let go of Figma');
  assert.equal(UKLoader.info().source, 'downloaded');

  // the new copy answers, with its own version, and is then confirmed
  const init = await ask(env, 'init');
  assert.equal(init.data.version, '9.9.0');
  assert.equal(init.data.install.source, 'downloaded');
  assert.equal(init.data.install.bundledVersion, UK.VERSION);
  assert.equal(saved(env).pending, false);

  // and it really is the running plugin: a normal request works
  env.figma.currentPage.name = 'Homepage';
  env.select([env.add('FRAME', { name: 'home', width: 1600, height: 900 })]);
  const pre = await ask(env, 'rename.preview', { settings: { client: 'acme' } });
  assert.equal(pre.data.rows[0].proposed, 'Homepage_Desktop_Acme_V1');
});

test('next launch: a saved newer version runs instead of the folder copy', async () => {
  const first = load();
  await first.UKLoader.start(() => first.UK.boot());
  serve(first.sandbox, release(first.code, '9.9.0'));
  await ask(first.env, 'update.install');

  const next = load({ storage: first.env.storage });
  const info = await next.UKLoader.start(() => next.UK.boot());
  assert.equal(info.source, 'downloaded');
  assert.equal(info.version, '9.9.0');
  assert.equal(next.env.log.ui.length, 1);
  assert.match(lastUi(next.env), /release 9\.9\.0/);
});

test('safety net: an update that never finished starting is thrown away', async () => {
  const first = load();
  await first.UKLoader.start(() => first.UK.boot());
  serve(first.sandbox, release(first.code, '9.9.0'));
  await ask(first.env, 'update.install');
  const stuck = saved(first.env);
  stuck.pending = true;                                   // it started last time but its interface never loaded

  const next = load({ storage: { [KEY]: JSON.stringify(stuck) } });
  const info = await next.UKLoader.start(() => next.UK.boot());
  assert.equal(info.source, 'bundled');
  assert.equal(lastUi(next.env), 'BUNDLED-UI');
  assert.equal(saved(next.env), null);
  const init = await ask(next.env, 'init');
  assert.match(init.data.install.note, /Update 9\.9\.0 didn’t start properly.*went back to version/);
});

test('safety net: broken or crashing saved code falls back to the folder copy', async () => {
  for (const code of ['x'.repeat(1200) + ' ((( not javascript', 'throw new Error("boom");' + ' '.repeat(1200)]) {
    const store = { [KEY]: JSON.stringify({ version: '9.9.0', code, html: 'h'.repeat(1200), pending: false }) };
    const { UK, UKLoader, env } = load({ storage: store });
    const info = await UKLoader.start(() => UK.boot());
    assert.equal(info.source, 'bundled');
    assert.match(info.note, /couldn’t be started/);
    assert.equal(lastUi(env), 'BUNDLED-UI');
    assert.equal(saved(env), null);
  }
});

test('a saved copy that is not newer than the folder is dropped', async () => {
  for (const version of ['0.9.0', null]) {
    const probe = load();
    const v = version || probe.UK.VERSION;                 // older, then exactly equal
    const store = { [KEY]: JSON.stringify({ version: v, code: 'figma.__ran = true;' + ' '.repeat(1200), html: 'h'.repeat(1200), pending: false }) };
    const { UK, UKLoader, env } = load({ storage: store });
    const info = await UKLoader.start(() => UK.boot());
    assert.equal(info.source, 'bundled', v);
    assert.equal(env.figma.__ran, undefined);
    assert.equal(saved(env), null);
  }
});

test('install refuses anything that is not a complete, matching release', async () => {
  const cases = [
    ['code from another version', (f) => { f['code.js'] = f['code.js'].replace("VERSION: '9.9.0'", "VERSION: '9.8.0'"); }, /still being published/],
    ['interface from another version', (f) => { f['ui.html'] = f['ui.html'].replace('content="9.9.0"', 'content="9.8.0"'); }, /still being published/],
    ['code.js missing', (f) => { delete f['code.js']; }, /couldn’t provide the update files \(404\)/],
    ['download interrupted', (f) => { f['ui.html'] = new TypeError('Failed to fetch'); }, /download from GitHub was interrupted/],
    ['code that is not valid JavaScript', (f) => { f['code.js'] = "var UK = { VERSION: '9.9.0' }; ((( " + 'x'.repeat(1200); }, /couldn’t be installed.*current version is unchanged/],
    ['a login page instead of code', (f) => { f['code.js'] = '<html>Sign in</html>'; }, /still being published/]
  ];
  for (const [name, breakIt, expected] of cases) {
    const { UK, UKLoader, env, sandbox, code } = load();
    await UKLoader.start(() => UK.boot());
    const files = release(code, '9.9.0');
    breakIt(files);
    serve(sandbox, files);
    const res = await ask(env, 'update.install');
    assert.equal(res.ok, false, name);
    assert.match(res.error.message, expected, name);
    assert.equal(res.error.userFacing, true, name);
    assert.equal(saved(env), null, name + ': nothing saved');
    assert.equal(env.log.ui.length, 1, name + ': still running the same copy');
  }
});

test('install: already up to date, and unsupported environments', async () => {
  const { UK, UKLoader, env, sandbox, code } = load();
  await UKLoader.start(() => UK.boot());
  serve(sandbox, release(code, UK.VERSION));
  let res = await ask(env, 'update.install');
  assert.deepEqual(res.data, { installed: false, current: UK.VERSION, latest: UK.VERSION });
  assert.equal(saved(env), null);

  delete sandbox.fetch;
  res = await ask(env, 'update.install');
  assert.equal(res.error.code, 'UNSUPPORTED');
});

test('remove downloaded update: back to the copy in the plugin folder', async () => {
  const { UK, UKLoader, env, sandbox, code } = load();
  await UKLoader.start(() => UK.boot());
  serve(sandbox, release(code, '9.9.0'));
  await ask(env, 'update.install');
  env.figma.ui.onmessage({ type: 'update.restart', id: 78 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await ask(env, 'init')).data.version, '9.9.0');

  const res = await ask(env, 'update.remove');
  assert.equal(res.data.removed, true);
  env.figma.ui.onmessage({ type: 'update.restart', id: 79 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(lastUi(env), 'BUNDLED-UI');
  const init = await ask(env, 'init');
  assert.equal(init.data.version, UK.VERSION);
  assert.equal(init.data.install.source, 'bundled');
  assert.equal(saved(env), null);
  assert.equal(env.listeners.selectionchange.length, 1);
});

test('installing never touches the document or the saved naming settings', async () => {
  const { UK, UKLoader, env, sandbox, code } = load();
  await UKLoader.start(() => UK.boot());
  env.add('FRAME', { name: 'Home' });
  await ask(env, 'settings.save', { renamer: { mode: 'marketing', phase: 'Wireframes' } });
  serve(sandbox, release(code, '9.9.0'));
  await ask(env, 'update.install');
  env.figma.ui.onmessage({ type: 'update.restart', id: 78 });
  await new Promise((r) => setTimeout(r, 20));
  const init = await ask(env, 'init');
  assert.deepEqual([init.data.settings.renamer.mode, init.data.settings.renamer.phase], ['marketing', 'Wireframes']);
  assert.deepEqual(env.all().map((n) => n.name), ['Home']);
  assert.equal(env.log.undo, 0);
});
