const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const REPO = 'https://github.com/hiteshramawat01-oss/UtilityKit';
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('version comparison', () => {
  const { UK } = load();
  const { parseVersion: p, compare: c } = UK.updates;
  assert.equal(c(p('1.2.0'), p('1.1.9')), 1);
  assert.equal(c(p('1.10.0'), p('1.9.0')), 1, 'numeric, not alphabetical');
  assert.equal(c(p('v2.0'), p('2.0.0')), 0);
  assert.equal(c(p('1.0.0'), p('1.0.1')), -1);
  for (const bad of ['', 'latest', '1', '1.2.3.4', '1.x.0', '<script>']) assert.equal(p(bad), null, bad);
  assert.match(UK.VERSION, /^\d+\.\d+\.\d+$/, 'build fills the version in from version.json');
  assert.equal(UK.VERSION, require('../version.json').version);
});

test('up to date, update available, and running ahead', async () => {
  const { UK, call, sandbox } = load();
  const urls = [];
  let body = JSON.stringify({ version: UK.VERSION });
  sandbox.fetch = async (url) => { urls.push(url); return reply(200, body); };

  let res = await call('update.check');
  assert.equal(res.ok, true);
  assert.equal(res.data.updateAvailable, false);
  assert.equal(res.data.current, UK.VERSION);
  assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/hiteshramawat01-oss\/UtilityKit\/main\/version\.json\?t=\d+$/);

  body = JSON.stringify({ version: '9.4.0', released: '2027-01-15', notes: ['New: thing.', '  ', 42, 'Fix: other thing.'] });
  res = await call('update.check');
  assert.equal(res.data.updateAvailable, true);
  assert.equal(res.data.latest, '9.4.0');
  assert.deepEqual(res.data.notes, ['New: thing.', 'Fix: other thing.']);
  assert.equal(res.data.released, '2027-01-15');
  assert.equal(res.data.downloadUrl, REPO + '/archive/refs/heads/main.zip');
  assert.equal(res.data.pageUrl, REPO);

  body = JSON.stringify({ version: '0.9.0' });
  res = await call('update.check');
  assert.deepEqual([res.data.updateAvailable, res.data.ahead], [false, true]);
});

test('the remote file is not trusted: links must stay inside the repository', async () => {
  const { call, sandbox } = load();
  const check = async (data) => { sandbox.fetch = async () => reply(200, JSON.stringify(data)); return (await call('update.check')).data; };

  let d = await check({ version: '9.0.0', download: REPO + '/releases/download/v9.0.0/UtilityKit.zip', page: REPO + '/releases/tag/v9.0.0' });
  assert.equal(d.downloadUrl, REPO + '/releases/download/v9.0.0/UtilityKit.zip');
  assert.equal(d.pageUrl, REPO + '/releases/tag/v9.0.0');

  for (const evil of ['https://evil.example.com/x.zip', 'javascript:alert(1)', REPO + '-evil/archive/main.zip',
    'https://github.com/someone-else/UtilityKit/archive/main.zip', REPO + '/x y', 7, null]) {
    d = await check({ version: '9.0.0', download: evil, page: evil });
    assert.equal(d.downloadUrl, REPO + '/archive/refs/heads/main.zip', String(evil));
    assert.equal(d.pageUrl, REPO, String(evil));
  }
  d = await check({ version: '9.0.0', released: '<b>soon</b>', notes: 'not a list' });
  assert.equal(d.released, '');
  assert.deepEqual(d.notes, []);
});

test('failures are explained, never thrown at the designer raw', async () => {
  const { call, sandbox } = load();
  sandbox.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let res = await call('update.check');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Couldn’t reach GitHub/);

  sandbox.fetch = async () => reply(404, '404: Not Found');
  res = await call('update.check');
  assert.match(res.error.message, /may be private, or version\.json is missing/);

  sandbox.fetch = async () => reply(503, 'unavailable');
  res = await call('update.check');
  assert.match(res.error.message, /error \(503\)/);

  for (const body of ['<html>login</html>', '[]x', 'null', JSON.stringify({ version: 'latest' }), JSON.stringify({})]) {
    sandbox.fetch = async () => reply(200, body);
    res = await call('update.check');
    assert.equal(res.ok, false, body);
    assert.equal(res.error.userFacing, true);
  }
});

test('when the plugin side cannot fetch, the interface fetches and the plugin still validates', async () => {
  const { UK, call, sandbox } = load();
  assert.equal(typeof sandbox.fetch, 'undefined');
  let res = await call('update.check');
  assert.deepEqual(res.data, { fetchInUi: true, url: UK.updates.VERSION_URL });
  res = await call('update.check', { text: JSON.stringify({ version: '9.0.0', download: 'https://evil.example.com' }) });
  assert.equal(res.data.updateAvailable, true);
  assert.equal(res.data.downloadUrl, REPO + '/archive/refs/heads/main.zip');
});

test('opening: only repository links are ever opened', async () => {
  const { env, call } = load();
  await call('update.open', { which: 'download', url: REPO + '/releases/download/v9/UtilityKit.zip' });
  await call('update.open', { which: 'download', url: 'https://evil.example.com/x.zip' });
  await call('update.open', { which: 'page', url: 'https://evil.example.com' });
  await call('update.open', {});
  assert.deepEqual(env.log.opened, [
    REPO + '/releases/download/v9/UtilityKit.zip', REPO + '/archive/refs/heads/main.zip', REPO, REPO + '/archive/refs/heads/main.zip']);
  delete env.figma.openExternal;
  const res = await call('update.open', { which: 'page' });
  assert.deepEqual(res.data, { opened: false, url: REPO });
});

test('checking for updates never touches the document', async () => {
  const { env, call, sandbox } = load();
  env.add('FRAME', { name: 'Home' });
  sandbox.fetch = async () => reply(200, JSON.stringify({ version: '9.0.0' }));
  const before = JSON.stringify(env.all().map((n) => [n.id, n.name]));
  await call('update.check');
  assert.equal(JSON.stringify(env.all().map((n) => [n.id, n.name])), before);
  assert.equal(env.log.undo, 0);
});
