const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

function withPage(env, name) {
  const page = env.figma.createPage();
  page.name = name || 'For Designers';
  page._loaded = false;                       // like a real dynamic-page file: other pages start unloaded
  return page;
}
const text = (env, page, props) => { const t = env.make('TEXT', props); page.children.push(t); t.parent = page; return t; };

test('url rules: only Google Drive / Docs hosts are accepted', () => {
  const { UK } = load();
  const p = UK.drive.parseGoogleUrl;
  assert.equal(p('https://drive.google.com/drive/folders/abc?usp=sharing').url, 'https://drive.google.com/drive/folders/abc?usp=sharing');
  assert.equal(p('docs.google.com/document/d/1/edit').url, 'https://docs.google.com/document/d/1/edit');
  assert.equal(p('http://DRIVE.google.com/file/d/9/view').url, 'https://drive.google.com/file/d/9/view');
  for (const bad of ['', 'not a url', 'https://example.com/drive.google.com', 'https://drive.google.com.evil.io/x',
    'https://evil.io@drive.google.com/x', 'javascript:alert(1)', 'https://google.com/drive', 'ftp://drive.google.com/x']) {
    assert.equal(p(bad), null, bad);
  }
  const kind = (u) => UK.drive.kindOf(p(u));
  assert.equal(kind('https://drive.google.com/drive/folders/abc'), 'Folder');
  assert.equal(kind('https://drive.google.com/file/d/9/view'), 'File');
  assert.equal(kind('https://docs.google.com/document/d/1/edit'), 'Doc');
  assert.equal(kind('https://docs.google.com/spreadsheets/d/1/edit'), 'Sheet');
  assert.equal(kind('https://docs.google.com/presentation/d/1/edit'), 'Slides');
});

test('scan: no page', async () => {
  const { call } = load();
  const res = await call('drive.scan');
  assert.deepEqual(res.data, { pageFound: false, pageName: 'For Designers', links: [] });
});

test('scan: finds hyperlinks and pasted URLs, ignores other sites, orders top-to-bottom', async () => {
  const { env, call } = load();
  const page = withPage(env, '📎 For Designers');
  text(env, page, { name: 'low', y: 500, characters: 'Brand assets and Brief',
    links: [{ start: 0, end: 12, url: 'https://drive.google.com/drive/folders/ASSETS' }, { start: 17, end: 22, url: 'https://docs.google.com/document/d/BRIEF/edit' }] });
  text(env, page, { name: 'top', y: 10, characters: 'Project folder', links: [{ start: 0, end: 14, url: 'https://drive.google.com/drive/folders/PROJECT' }] });
  text(env, page, { name: 'other site', y: 20, characters: 'Staging', links: [{ start: 0, end: 7, url: 'https://staging.example.com' }] });
  text(env, page, { name: 'Sheet note', y: 300, characters: 'Tracker: https://docs.google.com/spreadsheets/d/TRACK/edit.' });
  text(env, page, { name: 'dupe', y: 900, characters: 'Folder again', links: [{ start: 0, end: 12, url: 'https://drive.google.com/drive/folders/PROJECT' }] });

  const res = await call('drive.scan');
  assert.equal(res.data.pageFound, true);
  assert.equal(res.data.pageName, '📎 For Designers');
  assert.equal(res.data.isCurrentPage, false);
  assert.deepEqual(res.data.links.map((l) => [l.label, l.kind, l.source, l.count]), [
    ['Project folder', 'Folder', 'hyperlink', 2],
    ['Sheet note', 'Sheet', 'text', 1],
    ['Brand assets', 'Folder', 'hyperlink', 1],
    ['Brief', 'Doc', 'hyperlink', 1]
  ]);
  assert.equal(res.data.links[1].url, 'https://docs.google.com/spreadsheets/d/TRACK/edit');
  assert.equal(env.figma.currentPage.name, 'Page 1', 'scanning does not switch pages');
});

test('add: validates, refuses duplicates, and never creates a page unasked', async () => {
  const { env, call } = load();
  let res = await call('drive.add', { url: 'https://example.com/file', label: 'x' });
  assert.match(res.error.message, /isn’t a Google Drive or Google Docs link/);
  res = await call('drive.add', { url: '  ' });
  assert.match(res.error.message, /Paste a Google Drive/);
  res = await call('drive.add', { url: 'https://drive.google.com/drive/folders/A', label: 'Assets' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NO_PAGE');
  assert.equal(env.figma.root.children.length, 1);

  res = await call('drive.add', { url: 'https://drive.google.com/drive/folders/A', label: 'Assets', createPage: true });
  assert.equal(res.ok, true);
  assert.equal(env.figma.root.children.length, 2);
  assert.equal(res.data.pageName, 'For Designers');
  assert.deepEqual(res.data.links.map((l) => [l.label, l.url]), [['Assets', 'https://drive.google.com/drive/folders/A']]);
  assert.equal(env.figma.currentPage.name, 'Page 1');

  // lands in one "Drive Links" frame on that page, as a real hyperlink
  const page = env.figma.root.children[1];
  assert.equal(page.children.length, 1);
  const frame = page.children[0];
  assert.equal(frame.name, 'Drive Links');
  const link = frame.children[1];
  assert.equal(link.characters, 'Assets');
  assert.deepEqual(JSON.parse(JSON.stringify(link._links)), [{ start: 0, end: 6, url: 'https://drive.google.com/drive/folders/A' }]);

  res = await call('drive.add', { url: 'drive.google.com/drive/folders/A', label: 'Again' });
  assert.match(res.error.message, /already on the “For Designers” page as “Assets”/);

  res = await call('drive.add', { url: 'https://docs.google.com/document/d/B/edit' });   // no label
  assert.equal(res.ok, true);
  assert.equal(frame.children.length, 3, 'reuses the same frame');
  assert.equal(frame.children[2].characters, 'Google Doc link');
  assert.equal(page.children.length, 1);
});

test('add: new frame goes below existing page content', async () => {
  const { env, call } = load();
  const page = withPage(env);
  const existing = env.make('FRAME', { name: 'Notes', x: 40, y: 100, width: 600, height: 400 });
  page.children.push(existing); existing.parent = page;
  await call('drive.add', { url: 'https://drive.google.com/drive/folders/A', label: 'Assets' });
  const frame = page.children[1];
  assert.deepEqual([frame.x, frame.y], [40, 580]);
  assert.deepEqual([existing.x, existing.y], [40, 100]);
});

test('add: falls back when Inter is unavailable', async () => {
  const { env, call } = load();
  env.figma._missingFonts = ['Inter', 'Roboto', 'Arial'];
  const res = await call('drive.add', { url: 'https://drive.google.com/drive/folders/A', label: 'Assets', createPage: true });
  assert.equal(res.ok, true);
  assert.equal(env.figma.root.children[1].children[0].children[1].fontName.family, 'Helvetica');
});

test('create page: makes it once', async () => {
  const { env, call } = load();
  let res = await call('drive.createPage');
  assert.equal(res.data.pageFound, true);
  res = await call('drive.createPage');
  assert.equal(env.figma.root.children.filter((p) => p.name === 'For Designers').length, 1);
});

test('open: only validated Google links are opened', async () => {
  const { env, call } = load();
  let res = await call('drive.open', { url: 'https://drive.google.com/drive/folders/A' });
  assert.deepEqual(res.data, { opened: true, url: 'https://drive.google.com/drive/folders/A' });
  res = await call('drive.open', { url: 'https://phish.example.com/drive.google.com' });
  assert.equal(res.ok, false);
  assert.deepEqual(env.log.opened, ['https://drive.google.com/drive/folders/A']);
  delete env.figma.openExternal;                       // older Figma: the interface opens it instead
  res = await call('drive.open', { url: 'https://drive.google.com/drive/folders/A' });
  assert.equal(res.data.opened, false);
});

test('go to: switches to the page and focuses the link', async () => {
  const { env, call } = load();
  const page = withPage(env);
  const t = text(env, page, { name: 'top', characters: 'Folder', links: [{ start: 0, end: 6, url: 'https://drive.google.com/drive/folders/P' }] });
  const res = await call('drive.goto', { nodeId: t.id });
  assert.equal(res.ok, true);
  assert.equal(env.figma.currentPage, page);
  assert.equal(env.log.zoomed.join(), t.id);
});

test('router: unknown requests and thrown errors become error results', async () => {
  const { call } = load();
  const res = await call('nope');
  assert.equal(res.ok, false);
  assert.equal(res.error.userFacing, false);
});
