const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const base = (over) => Object.assign({ phase: 'design', client: 'acme corp', version: '1' }, over);

test('naming: builds Page - Phase - Client - Version from the layer name', () => {
  const { UK } = load();
  const s = UK.naming.normalize(base());
  assert.equal(UK.naming.buildName(s, 'home page').name, 'Home Page - Design - Acme Corp - V1');
});

test('naming: removes a leading YYYY-MM date (and optional day) with its separator', () => {
  const { UK } = load();
  const strip = UK.naming.stripLeadingDate;
  assert.equal(strip('2026-05 - Website Navigation / Information architecture'), 'Website Navigation / Information architecture');
  assert.equal(strip('2026-05_Home'), 'Home');
  assert.equal(strip('2026-05 Home'), 'Home');
  assert.equal(strip('2026-05-12 — Landing'), 'Landing');
  assert.equal(strip('2026/05 | Pricing'), 'Pricing');
  // not dates: left alone
  assert.equal(strip('2026 Rebrand'), '2026 Rebrand');
  assert.equal(strip('Home 2026-05'), 'Home 2026-05');
  assert.equal(strip('2026-13 Home'), '2026-13 Home');
  assert.equal(strip('20260-05 Home'), '20260-05 Home');
});

test('naming: strip date can be switched off', () => {
  const { UK } = load();
  const s = UK.naming.normalize({ stripDate: false, enabled: { phase: false, client: false, version: false } });
  assert.equal(UK.naming.buildName(s, '2026-05 - home').name, '2026-05 - Home');
});

test('naming: capitalises words without flattening acronyms; can be switched off', () => {
  const { UK } = load();
  const cap = UK.naming.capitalizeWords;
  assert.equal(cap('landing page CTA'), 'Landing Page CTA');
  assert.equal(cap('e-commerce / product page'), 'E-commerce / Product Page');
  assert.equal(cap('über uns'), 'Über Uns');
  assert.equal(cap('hero (mobile)'), 'Hero (Mobile)');
  const off = UK.naming.normalize(base({ capitalize: false }));
  assert.equal(UK.naming.buildName(off, 'home page').name, 'home page - design - acme corp - V1');
});

test('naming: empty and switched-off fields are omitted, with no stray separators', () => {
  const { UK } = load();
  const N = UK.naming;
  assert.equal(N.buildName(N.normalize({ client: 'Acme' }), 'Home').name, 'Home - Acme');
  assert.equal(N.buildName(N.normalize(base({ client: '   ' })), 'Home').name, 'Home - Design - V1');
  assert.equal(N.buildName(N.normalize(base({ enabled: { phase: false } })), 'Home').name, 'Home - Acme Corp - V1');
  assert.equal(N.buildName(N.normalize(base({ enabled: { page: false } })), 'Home').name, 'Design - Acme Corp - V1');
});

test('naming: consistent spacing, underscores, and edge punctuation', () => {
  const { UK } = load();
  const N = UK.naming;
  const s = N.normalize(base({ client: '  acme   corp - ', phase: '-design' }));
  assert.equal(N.buildName(s, '  home_page   v2 - ').name, 'Home Page V2 - Design - Acme Corp - V1');
});

test('naming: version formatting', () => {
  const { UK } = load();
  const f = UK.naming.formatVersion;
  assert.equal(f('1', true), 'V1');
  assert.equal(f('v2', true), 'V2');
  assert.equal(f('Version 3.1', true), 'V3.1');
  assert.equal(f('final', true), 'final');
  assert.equal(f('2', false), '2');
  assert.equal(f('  ', true), '');
});

test('naming: field order, separator and custom page text', () => {
  const { UK } = load();
  const N = UK.naming;
  const s = N.normalize(base({ order: ['client', 'page', 'version', 'phase'], separator: 'pipe', pageSource: 'custom', page: 'checkout' }));
  assert.equal(N.buildName(s, 'ignored layer name').name, 'Acme Corp | Checkout | V1 | Design');
  assert.equal(N.buildName(N.normalize(base({ separator: 'underscore' })), 'Home').name, 'Home_Design_Acme Corp_V1');
});

test('naming: normalize repairs bad saved data', () => {
  const { UK } = load();
  const s = UK.naming.normalize({ order: ['client', 'client', 'bogus'], separator: 'nope', resizeMode: 7, client: 42, capitalize: 'yes' });
  assert.equal(s.order.join(), 'client,page,phase,version');
  assert.equal(s.separator, 'dash');
  assert.equal(s.resizeMode, 'scale');
  assert.equal(s.client, '42');
  assert.equal(s.capitalize, true);
  assert.equal(JSON.stringify(UK.naming.normalize(null)), JSON.stringify(UK.naming.defaults()));
});

test('preview: counts selected / will rename / unchanged', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: '2026-05 - home page' });
  const b = env.add('FRAME', { name: 'Home Page' });
  const c = env.add('FRAME', { name: 'About' });
  env.select([a, b, c]);
  const res = await call('rename.preview', { settings: base({ enabled: { phase: false, client: false, version: false } }) });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.counts, { selected: 3, willRename: 1, unchanged: 2, willResize: 0, resizeSkipped: 0 });
  assert.equal(res.data.rows[0].proposed, 'Home Page');
  assert.equal(res.data.rows[1].changed, false);
  assert.equal(res.data.rows[2].changed, false);
  assert.equal(res.data.rows[2].note, 'Already named this way');
  // preview must not touch the document
  assert.equal(a.name, '2026-05 - home page');
});

test('preview: empty selection and no fields are reported, not thrown', async () => {
  const { env, call } = load();
  let res = await call('rename.preview', { settings: base() });
  assert.equal(res.data.counts.selected, 0);
  env.select([env.add('FRAME', { name: 'Home' })]);
  res = await call('rename.preview', { settings: { enabled: { page: false }, phase: '', client: ' ', version: '' } });
  assert.match(res.data.error, /at least one naming field/);
  assert.equal(res.data.counts.willRename, 0);
});

test('apply: renames, reports counts, is one undo step', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: '2026-05 - home page' });
  const b = env.add('TEXT', { name: 'pricing' });
  env.select([a, b]);
  const settings = base();
  const pre = await call('rename.preview', { settings });
  const res = await call('rename.apply', { settings, expected: pre.data.expected });
  assert.equal(res.ok, true);
  assert.equal(res.data.renamed, 2);
  assert.equal(res.data.unchanged, 0);
  assert.equal(a.name, 'Home Page - Design - Acme Corp - V1');
  assert.equal(b.name, 'Pricing - Design - Acme Corp - V1');
  assert.equal(env.log.undo, 1);
});

test('apply: running again with a new version does not stack names', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: '2026-05 - home page' });
  env.select([a]);
  let settings = base();
  let pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected });
  assert.equal(a.name, 'Home Page - Design - Acme Corp - V1');

  // same settings again -> unchanged
  pre = await call('rename.preview', { settings });
  assert.deepEqual([pre.data.counts.willRename, pre.data.counts.unchanged], [0, 1]);

  settings = base({ version: '2', phase: 'final' });
  pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected });
  assert.equal(a.name, 'Home Page - Final - Acme Corp - V2');

  // a manual rename by the designer becomes the new starting point
  a.name = 'Landing';
  pre = await call('rename.preview', { settings });
  assert.equal(pre.data.rows[0].proposed, 'Landing - Final - Acme Corp - V2');
});

test('names that already follow the format are recognised, not doubled', async () => {
  const { env, call, UK } = load();
  const N = UK.naming;
  const s = N.normalize(base());
  assert.equal(N.unwrapPage(s, 'About - Design - Acme Corp - V1'), 'About');
  assert.equal(N.unwrapPage(s, 'about-design - ACME  corp -v1'), 'about');
  assert.equal(N.unwrapPage(s, 'About - Design - Acme Corp - V7.2'), 'About', 'a different version still matches');
  assert.equal(N.unwrapPage(s, 'About - Wireframe - Acme Corp - V1'), '', 'a different phase does not');
  assert.equal(N.unwrapPage(s, 'About'), '');
  assert.equal(N.unwrapPage(N.normalize(base({ order: ['client', 'page', 'phase', 'version'] })), 'Acme Corp - A - B - Design - V1'), 'A - B');
  assert.equal(N.unwrapPage(N.normalize(base({ client: 'A+B (EU)', separator: 'underscore' })), 'Home_Design_A+B (EU)_V1'), 'Home');
  assert.equal(N.unwrapPage(N.normalize({}), 'Anything'), '', 'nothing to unwrap when only Page is set');

  const a = env.add('FRAME', { name: 'About - Design - Acme Corp - V1' });     // named by hand, already right
  const b = env.add('FRAME', { name: '2026-05 - contact - design - acme corp - v1' });
  env.select([a, b]);
  let pre = await call('rename.preview', { settings: base() });
  assert.deepEqual(pre.data.rows.map((r) => [r.proposed, r.changed]), [
    ['About - Design - Acme Corp - V1', false], ['Contact - Design - Acme Corp - V1', true]]);
  pre = await call('rename.preview', { settings: base({ version: '2' }) });
  assert.equal(pre.data.rows[0].proposed, 'About - Design - Acme Corp - V2');
});

test('apply: refuses to apply a stale preview and changes nothing', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: 'home' });
  const b = env.add('FRAME', { name: 'about' });
  env.select([a, b]);
  const settings = base();
  const pre = await call('rename.preview', { settings });
  b.name = 'contact';            // renamed by hand after the preview
  let res = await call('rename.apply', { settings, expected: pre.data.expected });
  assert.equal(res.data.stale, true);
  assert.equal(a.name, 'home');
  assert.equal(b.name, 'contact');
  assert.equal(res.data.preview.rows[1].proposed, 'Contact - Design - Acme Corp - V1');

  a.remove();                     // deleted after the preview
  res = await call('rename.apply', { settings, expected: res.data.preview.expected.concat([{ id: a.id, proposed: 'x' }]) });
  assert.equal(res.data.stale, true);
});

test('apply: a layer that cannot be renamed is reported and the rest still rename', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: 'home' });
  const bad = env.add('FRAME', { name: 'locked thing', flags: { failRename: true } });
  env.select([a, bad]);
  const settings = base();
  const pre = await call('rename.preview', { settings });
  const res = await call('rename.apply', { settings, expected: pre.data.expected });
  assert.equal(res.data.renamed, 1);
  assert.equal(res.data.failedCount, 1);
  assert.match(res.data.failed[0].reason, /Cannot rename/);
  assert.equal(bad.name, 'locked thing');
});

test('apply: errors for no selection / no fields are user-facing', async () => {
  const { env, call } = load();
  let res = await call('rename.apply', { settings: base(), expected: [] });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Select at least one layer/);
  const a = env.add('FRAME', { name: 'home' });
  res = await call('rename.apply', { settings: { enabled: { page: false } }, expected: [{ id: a.id, proposed: 'x' }] });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /at least one naming field/);
  assert.equal(a.name, 'home');
});

test('duplicates: optional numbering', async () => {
  const { env, call } = load();
  const nodes = [1, 2, 3].map(() => env.add('FRAME', { name: 'x' }));
  env.select(nodes);
  const settings = base({ pageSource: 'custom', page: 'home', numberDuplicates: true });
  const pre = await call('rename.preview', { settings });
  assert.deepEqual(pre.data.rows.map((r) => r.proposed), [
    'Home - Design - Acme Corp - V1 - 01', 'Home - Design - Acme Corp - V1 - 02', 'Home - Design - Acme Corp - V1 - 03'
  ]);
});

test('resize: scale keeps the aspect ratio, width-only keeps the height', async () => {
  const { env, call } = load();
  const a = env.add('FRAME', { name: 'a', width: 800, height: 600 });
  const b = env.add('FRAME', { name: 'b', width: 1600, height: 900 });       // already 1600
  const c = env.add('FRAME', { name: 'c', width: 400, height: 300, flags: { failResize: true } });
  env.select([a, b, c]);
  let settings = base({ resize: true, resizeMode: 'scale' });
  let pre = await call('rename.preview', { settings });
  assert.equal(pre.data.counts.willResize, 2);
  assert.equal(pre.data.rows[0].resize, '800 × 600 → 1600 × 1200');
  let res = await call('rename.apply', { settings, expected: pre.data.expected });
  assert.deepEqual([a.width, a.height], [1600, 1200]);
  assert.deepEqual([b.width, b.height], [1600, 900]);
  assert.equal(res.data.resized, 1);
  assert.equal(res.data.resizeSkippedCount, 1);
  assert.match(res.data.resizeSkipped[0].reason, /inside an instance/);
  assert.equal(c.name, 'C - Design - Acme Corp - V1', 'rename still happens when resize fails');

  const d = env.add('FRAME', { name: 'd', width: 1440, height: 3000 });
  env.select([d]);
  settings = base({ resize: true, resizeMode: 'width' });
  pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected });
  assert.deepEqual([d.width, d.height], [1600, 3000]);
});

test('settings: saved per designer, client/phase/version remembered per file', async () => {
  const { env, call } = load();
  let init = await call('init');
  assert.equal(init.data.settings.renamer.client, '');
  assert.equal(init.data.settings.flatten.scale, 2);

  await call('settings.save', { renamer: base({ client: 'Typed Not Applied', separator: 'pipe' }), flatten: { scale: 3 } });
  init = await call('init');
  assert.equal(init.data.settings.renamer.client, 'Typed Not Applied');
  assert.equal(init.data.settings.renamer.separator, 'pipe');
  assert.equal(init.data.settings.flatten.scale, 3);
  assert.equal(env.figma.root.getPluginData('utilitykit.file.v1'), '', 'typing alone never writes to the file');

  const a = env.add('FRAME', { name: 'home' });
  env.select([a]);
  const settings = base({ client: 'Acme', version: '4' });
  const pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected });
  assert.deepEqual(JSON.parse(env.figma.root.getPluginData('utilitykit.file.v1')), { client: 'Acme', phase: 'design', version: '4' });

  // later, another file's client was used last; this file still restores its own
  await call('settings.save', { renamer: base({ client: 'Other Client' }) });
  init = await call('init');
  assert.equal(init.data.settings.renamer.client, 'Acme');
  assert.equal(init.data.settings.renamer.version, '4');
});

test('settings: reset puts this designer back to defaults and leaves the file alone', async () => {
  const { env, call, UK } = load();
  const a = env.add('FRAME', { name: 'home' });
  env.select([a]);
  const settings = base({ client: 'Acme', separator: 'pipe', resize: true });
  const pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected, flatten: { scale: 4 } });
  let init = await call('init');
  assert.equal(init.data.settings.renamer.separator, 'pipe');
  assert.equal(init.data.settings.flatten.scale, 4);

  const res = await call('settings.reset');
  assert.equal(JSON.stringify(res.data.renamer), JSON.stringify(UK.naming.defaults()));
  assert.equal(res.data.flatten.scale, 2);
  assert.equal(a.name, 'Home | Design | Acme | V1', 'reset never touches layers');

  init = await call('init');
  assert.equal(init.data.settings.renamer.separator, 'dash');
  assert.equal(init.data.settings.renamer.resize, false);
  assert.equal(init.data.settings.flatten.scale, 2);
  assert.equal(init.data.settings.renamer.client, 'Acme', 'the file still remembers its own client');
});
