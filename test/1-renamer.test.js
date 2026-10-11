const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const web = (over) => Object.assign({ mode: 'web', phase: 'Mockups', client: 'Acme' }, over);
const mkt = (over) => Object.assign({ mode: 'marketing', deliverable: 'Meta Ads', task: 'black friday', client: 'Acme' }, over);
const names = (res) => res.data.rows.map((r) => r.proposed);

function scene(pageName) {
  const ctx = load();
  ctx.env.figma.currentPage.name = pageName || '2026-05 - Homepage';
  ctx.frame = (name, x, width, height, extra) => ctx.env.add('FRAME', Object.assign({ name, x, y: 0, width, height: height || 3000 }, extra || {}));
  return ctx;
}

// ── the guideline's own examples ─────────────────────────────────────────────

test('guideline: parts are written without spaces, dashes or symbols', () => {
  const { UK } = load();
  const c = UK.naming.compact;
  assert.equal(c('All-fit Automotive & Parts'), 'AllfitAutomotiveAndParts');
  assert.equal(c('Estate Guys'), 'EstateGuys');
  assert.equal(c('Atlanta Light Bulbs'), 'AtlantaLightBulbs');
  assert.equal(c('Trumpet and Horn'), 'TrumpetAndHorn');
  assert.equal(c('UCA Lingerie'), 'UCALingerie');
  assert.equal(c('FAQ page edit'), 'FAQPageEdit');
  assert.equal(c('5 tips for sales'), '5TipsForSales');
  assert.equal(c('guide for winter fashion'), 'GuideForWinterFashion');
  assert.equal(c('Black Friday Sale'), 'BlackFridaySale');
  assert.equal(c('IGReel'), 'IGReel');
  // words that already carry capitals are left as typed
  assert.equal(c('iOS app'), 'iOSApp');
  assert.equal(c('eBay banner'), 'eBayBanner');
  // punctuation, emoji and odd spacing
  assert.equal(c("  Men's & Women's  "), 'MensAndWomens');
  assert.equal(c('home_page / hero (v2)'), 'HomePageHeroV2');
  assert.equal(c('📎 For Designers'), 'ForDesigners');
  assert.equal(c('Atlanta Light Bulbs, Inc.'), 'AtlantaLightBulbsInc');
  assert.equal(c('Über uns'), 'ÜberUns');
  assert.equal(c(''), '');
  assert.equal(c(null), '');
  // specific task: articles are dropped
  assert.equal(c('The guide for a winter', true), 'GuideForWinter');
  assert.equal(c('the', true), 'The');
});

test('guideline: the sample file names come out exactly', async () => {
  // Web samples: page name on the Figma page, one frame that is not a standard device width
  for (const [page, settings, want] of [
    ['Homepage', { phase: 'Mockups', client: 'Estate Guys' }, 'Homepage_Mockups_EstateGuys_V1'],
    ['Homepage', { phase: 'Wireframes', client: 'Atlanta Light Bulbs', versions: 'r1' }, 'Homepage_Wireframes_AtlantaLightBulbs_V1R1'],
    ['Product Page', { phase: 'Mockups', client: 'Trumpet and Horn', versions: 'r1' }, 'ProductPage_Mockups_TrumpetAndHorn_V1R1'],
    ['FAQ Page Edit', { phase: '', client: 'American Coil', versions: 'r1' }, 'FAQPageEdit_AmericanCoil_V1R1'],
    ['Brand Guide', { phase: '', client: 'UCA Lingerie' }, 'BrandGuide_UCALingerie_V1']
  ]) {
    const { env, call, frame } = scene(page);
    env.select([frame('Frame 1', 0, 1440)]);
    assert.deepEqual(names(await call('rename.preview', { settings: web(settings) })), [want]);
  }
  // Marketing samples
  for (const [w, h, settings, want] of [
    [800, 2000, { includeSize: false, deliverable: 'Infographic', task: 'Guide for winter fashion', client: 'Magnolia Boutique', versions: 'r3' }, 'Infographic_GuideForWinterFashion_MagnoliaBoutique_V1R3'],
    [1080, 1920, { includeSize: false, deliverable: 'IG Reel', task: 'Summer tips', client: 'Megan Mae Miami', versions: '2' }, 'IGReel_SummerTips_MeganMaeMiami_V2'],
    [1200, 300, { deliverable: 'Google Responsive Ads', task: 'Black Friday Sale', client: 'West Point Home' }, '1200x300_GoogleResponsiveAds_BlackFridaySale_WestPointHome_V1'],
    [1080, 1920, { deliverable: 'Meta Video Ads', task: 'Prime Day Sale', client: 'House of Savage', versions: 'r1' }, 'V_MetaVideoAds_PrimeDaySale_HouseOfSavage_V1R1']
  ]) {
    const { env, call, frame } = scene('Ads');
    env.select([frame('Frame 1', 0, w, h)]);
    assert.deepEqual(names(await call('rename.preview', { settings: mkt(settings) })), [want]);
  }
});

// ── Web ──────────────────────────────────────────────────────────────────────

test('web: page type is read from the current Figma page', async () => {
  const { UK } = load();
  const p = UK.naming.pageTypeFrom;
  assert.equal(p('2026-05 - Homepage'), 'Homepage');
  assert.equal(p('2026-05 - Home page'), 'HomePage');
  assert.equal(p('Category Page'), 'CategoryPage');
  assert.equal(p('2026-05-12 — Product page'), 'ProductPage');
  assert.equal(p('2026-05 - Website Navigation / Information architecture'), 'WebsiteNavigationInformationArchitecture');
  assert.equal(p('2026-05'), '');
  assert.equal(p('🏠'), '');

  const { env, call, frame } = scene('2026-05 - Category Page');
  env.select([frame('whatever the layer was called', 0, 1600)]);
  let res = await call('rename.preview', { settings: web() });
  assert.equal(res.data.pageType, 'CategoryPage');
  assert.equal(res.data.pageName, '2026-05 - Category Page');
  assert.deepEqual(names(res), ['CategoryPage_Desktop_Mockups_Acme_V1'], 'the layer\'s own name is not used');

  // the designer can type a different page type
  res = await call('rename.preview', { settings: web({ pageType: 'category landing' }) });
  assert.deepEqual(names(res), ['CategoryLanding_Desktop_Mockups_Acme_V1']);
  assert.equal(res.data.autoPageType, 'CategoryPage');

  // switching to another page changes it
  const other = env.figma.createPage(); other.name = 'Checkout';
  const f = env.make('FRAME', { name: 'x', width: 320, height: 900 }); other.appendChild(f);
  await env.figma.setCurrentPageAsync(other); other.selection = [f];
  assert.deepEqual(names(await call('rename.preview', { settings: web() })), ['Checkout_Mobile_Mockups_Acme_V1']);
});

test('web: device tag comes from the frame width and sits right after the page type', async () => {
  const { UK } = load();
  assert.equal(UK.naming.deviceFor(1600), 'Desktop');
  assert.equal(UK.naming.deviceFor(320), 'Mobile');
  assert.equal(UK.naming.deviceFor(1600.2), 'Desktop');
  for (const w of [1440, 1920, 375, 768, 0, 1601, 319]) assert.equal(UK.naming.deviceFor(w), '', String(w));

  const { env, call, frame } = scene();
  env.select([frame('a', 0, 1600), frame('b', 2000, 320), frame('c', 3000, 1440)]);
  const res = await call('rename.preview', { settings: web() });
  assert.deepEqual(names(res), ['Homepage_Desktop_Mockups_Acme_V1', 'Homepage_Mobile_Mockups_Acme_V1', 'Homepage_Mockups_Acme_V1']);
  assert.deepEqual(res.data.summary, { desktop: 1, mobile: 1, otherWidth: 1 });
  assert.deepEqual(res.data.rows.map((r) => r.note), ['', '', '1440 px wide — no Desktop / Mobile tag']);
});

test('web: design phase is optional and limited to the guideline values', async () => {
  const { UK, env, call, frame } = scene();
  env.select([frame('a', 0, 1600)]);
  assert.deepEqual(names(await call('rename.preview', { settings: web({ phase: '' }) })), ['Homepage_Desktop_Acme_V1']);
  assert.deepEqual(names(await call('rename.preview', { settings: web({ phase: 'Wireframes' }) })), ['Homepage_Desktop_Wireframes_Acme_V1']);
  assert.equal(UK.naming.normalize({ phase: 'design' }).phase, '', 'anything else is dropped');
});

test('several frames: versions are numbered left to right, separately for each device', async () => {
  const { env, call, frame } = scene();
  // created and selected in a jumbled order; position on the canvas decides
  const m1 = frame('m', 5000, 320), d2 = frame('d2', 2000, 1600), d3 = frame('d3', 4000, 1600), d1 = frame('d1', 0, 1600);
  env.select([m1, d2, d3, d1]);
  const res = await call('rename.preview', { settings: web() });
  assert.deepEqual(res.data.rows.map((r) => [r.current, r.proposed]), [
    ['d1', 'Homepage_Desktop_Mockups_Acme_V1'],
    ['d2', 'Homepage_Desktop_Mockups_Acme_V2'],
    ['d3', 'Homepage_Desktop_Mockups_Acme_V3'],
    ['m', 'Homepage_Mobile_Mockups_Acme_V1']
  ]);
  // same x: top to bottom
  const s2 = scene();
  const top = s2.env.add('FRAME', { name: 'top', x: 0, y: 0, width: 1600, height: 900 });
  const low = s2.env.add('FRAME', { name: 'low', x: 0, y: 2000, width: 1600, height: 900 });
  s2.env.select([low, top]);
  assert.deepEqual((await s2.call('rename.preview', { settings: web() })).data.rows.map((r) => r.current + '>' + r.version), ['top>V1', 'low>V2']);
});

test('automatic versions: frames keep the version they have; only new frames get numbers', async () => {
  const { env, call, frame } = scene();
  const a = frame('a', 0, 1600), b = frame('b', 2000, 1600), c = frame('c', 4000, 1600);
  env.select([a, b, c]);
  let pre = await call('rename.preview', { settings: web() });
  await call('rename.apply', { settings: web(), expected: pre.data.expected });
  assert.deepEqual([a.name, b.name, c.name].map((n) => n.split('_').pop()), ['V1', 'V2', 'V3']);

  // run again: nothing changes
  pre = await call('rename.preview', { settings: web() });
  assert.deepEqual([pre.data.counts.willRename, pre.data.counts.unchanged], [0, 3]);

  // drag the frames into a different order and add a new one in the middle: versions do not shuffle
  a.x = 9000; c.x = -500;
  const d = frame('Frame 9', 1000, 1600);
  env.select([a, b, c, d]);
  pre = await call('rename.preview', { settings: web() });
  assert.deepEqual([a, b, c, d].map((n) => pre.data.rows.find((r) => r.id === n.id).version), ['V1', 'V2', 'V3', 'V4']);
  assert.equal(pre.data.counts.willRename, 1);

  // a duplicated frame carries the same name: the left one keeps the version, the copy takes the next free one
  const s2 = scene();
  const o = s2.frame('Homepage_Desktop_Mockups_Acme_V1R2', 0, 1600), copy = s2.frame('Homepage_Desktop_Mockups_Acme_V1R2', 2000, 1600);
  s2.env.select([copy, o]);
  assert.deepEqual(names(await s2.call('rename.preview', { settings: web() })), ['Homepage_Desktop_Mockups_Acme_V1R2', 'Homepage_Desktop_Mockups_Acme_V2']);
});

test('the Version box: one value for every frame, or one each, left to right', async () => {
  const { UK, env, call, frame } = scene();
  const a = frame('Homepage_Desktop_Mockups_Acme_V1', 0, 1600);
  const b = frame('Homepage_Desktop_Mockups_Acme_V2R1', 2000, 1600);
  const n = frame('Frame 3', 4000, 320);                        // never named
  env.select([n, b, a]);
  const data = async (versions) => (await call('rename.preview', { settings: web({ versions }) })).data;
  const v = async (versions) => (await data(versions)).versionList;

  // nothing typed: what the frames have, and the next free number for new ones
  let d = await data('');
  assert.deepEqual(d.versionList, ['V1', 'V2R1', 'V1']);
  assert.equal(d.versionsAuto, 'V1, V2R1, V1', 'this is what the box shows');
  assert.equal(d.error, '');

  // one value applies to every frame
  assert.deepEqual(await v('2'), ['V2', 'V2', 'V2']);
  assert.deepEqual(await v('v3'), ['V3', 'V3', 'V3']);
  assert.deepEqual(await v('1r2'), ['V1R2', 'V1R2', 'V1R2']);
  assert.deepEqual(await v(' V 1 R 2 '), ['V1R2', 'V1R2', 'V1R2']);
  assert.deepEqual(await v('r3'), ['V1R3', 'V2R3', 'V1R3'], 'r alone keeps each frame\'s version');

  // a list is handed out left to right
  assert.deepEqual(await v('v1,2,3'), ['V1', 'V2', 'V3']);
  assert.deepEqual(await v('V1,V1r1,R2'), ['V1', 'V1R1', 'V1R2']);
  assert.deepEqual(await v('1; 2; 3'), ['V1', 'V2', 'V3']);
  assert.deepEqual(await v('1, 2, 3,'), ['V1', 'V2', 'V3'], 'a trailing comma while typing is fine');
  d = await data('1, 2, 3');
  assert.deepEqual(d.rows.map((r) => r.proposed), ['Homepage_Desktop_Mockups_Acme_V1', 'Homepage_Desktop_Mockups_Acme_V2', 'Homepage_Mobile_Mockups_Acme_V3']);

  // mistakes block the rename and say why
  for (const [typed, message] of [
    ['1, 2', /3 frames selected, 2 versions typed/],
    ['1, 2, 3, 4', /3 frames selected, 4 versions typed/],
    ['final', /“final” isn’t a version/],
    ['1.2', /isn’t a version/],
    ['1,,3', /empty version in the list/],
    ['0', /Versions start at 1/]
  ]) {
    d = await data(typed);
    assert.match(d.error, message, typed);
    assert.equal(d.counts.willRename, 0, typed);
    const res = await call('rename.run', { settings: web({ versions: typed }) });
    assert.equal(res.ok, false, typed);
  }
  assert.equal(n.name, 'Frame 3');

  // all the same collapses to one value in the box
  const s2 = scene();
  s2.env.select([s2.frame('x', 0, 1600), s2.frame('y', 2000, 320)]);
  assert.equal((await s2.call('rename.preview', { settings: web() })).data.versionsAuto, 'V1');
  assert.equal(JSON.stringify(UK.naming.parseVersions('')), '{"entries":[]}');
});

test('reading a version out of an existing name', () => {
  const { UK } = load();
  const r = (n) => JSON.parse(JSON.stringify(UK.naming.readVersion(n)));
  assert.deepEqual(r('Homepage_Mockups_Acme_V1'), { v: 1, r: 0 });
  assert.deepEqual(r('Homepage_Mockups_Acme_V12R3'), { v: 12, r: 3 });
  assert.deepEqual(r('1080x1080_MetaAds_Sale_Acme_V2R1_B'), { v: 2, r: 1 }, 'a variation after it is fine');
  assert.deepEqual(r('home_v3'), { v: 3, r: 0 });
  for (const n of ['Frame 1', 'Homepage V1', 'Vault_Door', 'Homepage_Mockups_Acme', 'V1R', '']) assert.equal(UK.naming.readVersion(n), null, n);
});

// ── Marketing ────────────────────────────────────────────────────────────────

test('marketing: size is read from each frame; same-size frames are numbered', async () => {
  const { env, call, frame } = scene('Ads');
  const sq1 = frame('a', 0, 1080, 1080), sq2 = frame('b', 1200, 1080, 1080), wide = frame('c', 2400, 1200, 628), frac = frame('d', 4000, 1199.6, 627.5);
  env.select([wide, sq2, sq1, frac]);
  const res = await call('rename.preview', { settings: mkt() });
  assert.deepEqual(names(res), [
    '1080x1080_MetaAds_BlackFriday_Acme_V1',
    '1080x1080_MetaAds_BlackFriday_Acme_V2',
    '1200x628_MetaAds_BlackFriday_Acme_V1',
    '1200x628_MetaAds_BlackFriday_Acme_V2'
  ]);
  assert.equal(res.data.rows[0].device, '', 'no Desktop / Mobile tag in marketing names');
  assert.equal(res.data.rows[0].note, '');
});

test('marketing: size can be left out, variation goes last, video sizes use the letter codes', async () => {
  const { UK, env, call, frame } = scene('Ads');
  env.select([frame('a', 0, 1080, 1080)]);
  assert.deepEqual(names(await call('rename.preview', { settings: mkt({ includeSize: false }) })), ['MetaAds_BlackFriday_Acme_V1']);
  assert.deepEqual(names(await call('rename.preview', { settings: mkt({ variation: 'a', versions: 'r2' }) })), ['1080x1080_MetaAds_BlackFriday_Acme_V1R2_A']);
  assert.deepEqual(names(await call('rename.preview', { settings: mkt({ task: 'The 5 tips for a sale' }) })), ['1080x1080_MetaAds_5TipsForSale_Acme_V1']);

  const size = UK.naming.sizeFor;
  assert.equal(size(1080, 1920, 'MetaVideoAds'), 'V');
  assert.equal(size(1920, 1080, 'MetaVideoAds'), 'H');
  assert.equal(size(1080, 1350, 'IGReel'), 'P');
  assert.equal(size(1080, 1080, 'IGReel'), 'S');
  assert.equal(size(1080, 1080, 'MetaAds'), '1080x1080', 'only for video deliverables');
  assert.equal(size(1000, 1000, 'MetaVideoAds'), '1000x1000', 'only for the four standard video sizes');
  assert.equal(size(0, 100, 'MetaAds'), '');
});

// ── required parts ───────────────────────────────────────────────────────────

test('required parts: the preview says what is missing and nothing can be applied', async () => {
  const { env, call, frame } = scene();
  const a = frame('Frame 1', 0, 1600);
  env.select([a]);
  const err = async (settings) => (await call('rename.preview', { settings })).data;
  assert.match((await err(web({ client: '  ' }))).error, /Add the client name/);
  assert.match((await err(web({ client: '-- / --' }))).error, /Add the client name/);
  assert.match((await err(mkt({ deliverable: '' }))).error, /Add the deliverable type/);
  assert.match((await err(mkt({ task: ' - ' }))).error, /Add the specific task/);
  const p = await err(web({ client: '' }));
  assert.deepEqual([p.counts.willRename, p.rows[0].proposed], [0, 'Frame 1']);

  env.figma.currentPage.name = '2026-05';
  assert.match((await err(web())).error, /can’t be used as a page type/);
  assert.equal((await err(web({ pageType: 'Homepage' }))).error, '');

  env.figma.currentPage.name = 'Homepage';
  const res = await call('rename.apply', { settings: web({ client: '' }), expected: [{ id: a.id, proposed: 'x' }] });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Add the client name/);
  assert.equal(a.name, 'Frame 1');
});

// ── preview / apply ──────────────────────────────────────────────────────────

test('preview changes nothing; apply renames, counts, and is one undo step', async () => {
  const { env, call, frame } = scene();
  const a = frame('Frame 1', 0, 1600), b = frame('Homepage_Mobile_Mockups_Acme_V1', 2000, 320);
  env.select([a, b]);
  const pre = await call('rename.preview', { settings: web() });
  assert.deepEqual(pre.data.counts, { selected: 2, willRename: 1, unchanged: 1 });
  assert.equal(a.name, 'Frame 1');

  const res = await call('rename.apply', { settings: web(), expected: pre.data.expected });
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.renamed, res.data.unchanged, res.data.failedCount], [1, 1, 0]);
  assert.equal(a.name, 'Homepage_Desktop_Mockups_Acme_V1');
  assert.equal(a.getPluginData('uk.originalName'), 'Frame 1');
  assert.equal(env.log.undo, 1);
});

test('empty selection is reported, not thrown', async () => {
  const { call } = scene();
  const res = await call('rename.preview', { settings: web() });
  assert.equal(res.ok, true);
  assert.equal(res.data.counts.selected, 0);
  const applied = await call('rename.apply', { settings: web(), expected: [] });
  assert.match(applied.error.message, /Select at least one layer/);
});

test('apply refuses a stale preview and changes nothing', async () => {
  const { env, call, frame } = scene();
  const a = frame('a', 0, 1600), b = frame('b', 2000, 1600);
  env.select([a, b]);
  const pre = await call('rename.preview', { settings: web() });

  b.width = 320;                                   // resized after the preview: its name would now differ
  let res = await call('rename.apply', { settings: web(), expected: pre.data.expected });
  assert.equal(res.data.stale, true);
  assert.deepEqual([a.name, b.name], ['a', 'b']);
  assert.equal(res.data.preview.rows.find((r) => r.id === b.id).proposed, 'Homepage_Mobile_Mockups_Acme_V1');

  a.remove();                                      // deleted after the preview
  res = await call('rename.apply', { settings: web(), expected: pre.data.expected });
  assert.equal(res.data.stale, true);
  assert.equal(b.name, 'b');
});

test('a layer that cannot be renamed is reported and the rest still rename', async () => {
  const { env, call, frame } = scene();
  const a = frame('a', 0, 1600), bad = frame('locked thing', 2000, 1600, 3000, { flags: { failRename: true } });
  env.select([a, bad]);
  const pre = await call('rename.preview', { settings: web() });
  const res = await call('rename.apply', { settings: web(), expected: pre.data.expected });
  assert.equal(res.data.renamed, 1);
  assert.equal(res.data.failedCount, 1);
  assert.match(res.data.failed[0].reason, /Cannot rename/);
  assert.equal(bad.name, 'locked thing');
});

// ── never resizes ────────────────────────────────────────────────────────────

test('renaming never changes a frame\'s size, whatever an older version saved', async () => {
  const { env, call, frame } = scene();
  const a = frame('a', 0, 1440, 900);
  const m = frame('m', 3000, 375, 800);
  env.select([a, m]);
  const settings = web({ resize: true, resizeTarget: 1600, resizeMode: 'scale' });    // what v1.5 could save
  const pre = await call('rename.preview', { settings });
  assert.equal(pre.data.resize, undefined);
  assert.equal(pre.data.counts.willResize, undefined);
  assert.deepEqual(pre.data.rows.map((r) => r.proposed), ['Homepage_Mockups_Acme_V1', 'Homepage_Mockups_Acme_V2'], 'tagged by the width it has');
  const res = await call('rename.run', { settings });
  assert.equal(res.data.renamed, 2);
  assert.equal(res.data.resized, undefined);
  assert.deepEqual([a.width, a.height, m.width, m.height], [1440, 900, 375, 800]);
  const saved = (await call('init')).data.settings.renamer;
  assert.equal('resize' in saved, false);
  assert.equal('resizeTarget' in saved, false);
});

// ── saved settings ───────────────────────────────────────────────────────────

test('old or broken saved settings are repaired', () => {
  const { UK } = load();
  const N = UK.naming;
  const old = N.normalize({ order: ['client', 'page'], separator: 'pipe', client: 42, phase: 'design', version: '3', capitalize: true, resizeTarget: 1440, versions: 7, mode: 'print' });
  assert.equal(old.client, '42');
  assert.equal(old.phase, '');
  assert.equal(old.mode, 'web');
  assert.equal('resizeTarget' in old, false);
  assert.equal(old.versions, '7');
  assert.equal(JSON.stringify(N.normalize(null)), JSON.stringify(N.defaults()));
});

test('settings: saved per designer; one-off choices and the client are not carried between files', async () => {
  const { env, call, frame } = scene();
  let init = await call('init');
  assert.equal(init.data.settings.renamer.client, '');
  assert.equal(init.data.settings.clientSource, '');
  assert.equal(init.data.settings.renamer.mode, 'web');
  assert.deepEqual(init.data.naming.phases, ['Wireframes', 'Mockups']);

  await call('settings.save', { renamer: web({ client: 'Typed In Another File', mode: 'marketing', deliverable: 'MetaAds', pageType: 'Override', versions: '4r2', variation: 'B' }), flatten: { scale: 3 } });
  init = await call('init');
  const r = init.data.settings.renamer;
  assert.deepEqual([r.mode, r.deliverable], ['marketing', 'MetaAds']);
  assert.equal(r.client, '', 'a client never follows the designer into another file');
  assert.deepEqual([r.pageType, r.versions, r.variation], ['', '', ''], 'one-off choices start fresh');
  assert.equal(init.data.settings.flatten, undefined, 'Flatten & Merge has nothing to remember');
  assert.equal(env.figma.root.getPluginData('utilitykit.file.v1'), '', 'typing alone never writes to the file');

  const a = frame('a', 0, 1600);
  env.select([a]);
  const settings = web({ client: 'Acme', phase: 'Wireframes' });
  await call('rename.run', { settings });
  assert.deepEqual(JSON.parse(env.figma.root.getPluginData('utilitykit.file.v1')), { client: 'Acme', phase: 'Wireframes', mode: 'web', deliverable: '', task: '' });

  // this file restores its own client and phase whatever was used elsewhere since
  await call('settings.save', { renamer: web({ client: 'Other Client', phase: 'Mockups' }) });
  init = await call('init');
  assert.deepEqual([init.data.settings.renamer.client, init.data.settings.renamer.phase, init.data.settings.clientSource], ['Acme', 'Wireframes', 'file']);
});

test('client: read from the file, or from frames already named to the guideline, otherwise unknown', async () => {
  const { UK } = load();
  const c = UK.naming.clientIn;
  assert.equal(c('Homepage_Mockups_EstateGuys_V1'), 'EstateGuys');
  assert.equal(c('Homepage_Desktop_Wireframes_AtlantaLightBulbs_V1R1'), 'AtlantaLightBulbs');
  assert.equal(c('1200x300_GoogleResponsiveAds_BlackFridaySale_WestPointHome_V1'), 'WestPointHome');
  assert.equal(c('1080x1080_MetaAds_Sale_Acme_V2R1_B'), 'Acme', 'a variation after the version is fine');
  for (const n of ['Frame 1', 'home_v3', 'Homepage_Desktop_V1', 'Homepage_Mockups_V1', 'Home page_some client_V1', 'Homepage_Mockups_EstateGuys', '']) assert.equal(c(n), '', n);

  // nothing to go on
  let s = scene();
  s.frame('Frame 1', 0, 1600);
  assert.deepEqual((await s.call('client.detect')).data, { client: '', source: '' });

  // frames on the page already carry it; the most common one wins
  s = scene();
  s.frame('Homepage_Desktop_Mockups_EstateGuys_V1', 0, 1600);
  s.frame('Homepage_Mobile_Mockups_EstateGuys_V1', 2000, 320);
  s.frame('Homepage_Mockups_OldClient_V1', 4000, 1440);
  s.frame('Frame 9', 6000, 1600);
  assert.deepEqual((await s.call('client.detect')).data, { client: 'EstateGuys', source: 'frames' });
  let init = await s.call('init');
  assert.deepEqual([init.data.settings.renamer.client, init.data.settings.clientSource], ['EstateGuys', 'frames']);
  assert.equal(s.env.figma.root.getPluginData('utilitykit.file.v1'), '', 'reading it changes nothing');

  // once saved in the file, that wins
  await s.call('client.set', { client: 'Estate Guys Ltd' });
  assert.deepEqual((await s.call('client.detect')).data, { client: 'Estate Guys Ltd', source: 'file' });
});

test('client: asked once, saved in the file, shared by Web and Marketing', async () => {
  const { env, call, frame } = scene();
  let res = await call('client.set', { client: '   ' });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Type the client/);
  res = await call('client.set', { client: '-- / --' });
  assert.equal(res.ok, false);

  res = await call('client.example', { client: 'All-fit Automotive & Parts' });
  assert.deepEqual(res.data, { compact: 'AllfitAutomotiveAndParts', example: 'Homepage_AllfitAutomotiveAndParts_V1' });
  assert.deepEqual((await call('client.example', { client: '' })).data, { compact: '', example: '' });

  res = await call('client.set', { client: '  All-fit Automotive &  Parts ' });
  assert.deepEqual(res.data, { client: 'All-fit Automotive & Parts', saved: true });
  assert.equal(JSON.parse(env.figma.root.getPluginData('utilitykit.file.v1')).client, 'All-fit Automotive & Parts');

  const init = await call('init');
  const client = init.data.settings.renamer.client;
  env.select([frame('a', 0, 1600), frame('b', 3000, 1080, 1080)]);
  assert.match(names(await call('rename.preview', { settings: web({ client, phase: '' }) }))[0], /^Homepage_Desktop_AllfitAutomotiveAndParts_V1$/);
  assert.match(names(await call('rename.preview', { settings: mkt({ client }) }))[1], /^1080x1080_MetaAds_BlackFriday_AllfitAutomotiveAndParts_V1$/);

  // changing it keeps the other things the file remembers
  await call('rename.run', { settings: web({ client, phase: 'Mockups' }) });
  await call('client.set', { client: 'New Name' });
  assert.deepEqual(JSON.parse(env.figma.root.getPluginData('utilitykit.file.v1')), { client: 'New Name', phase: 'Mockups', mode: 'web', deliverable: '', task: '' });
});

test('rename in one click: names and applies the current selection', async () => {
  const { env, call, frame } = scene();
  let res = await call('rename.run', { settings: web() });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Select at least one frame/);

  const a = frame('Frame 1', 2000, 1600), b = frame('Frame 2', 0, 1600), m = frame('Frame 3', 4000, 320);
  env.select([a, b, m]);
  res = await call('rename.run', { settings: web({ client: '' }) });
  assert.match(res.error.message, /Add the client name/);
  assert.equal(a.name, 'Frame 1');

  res = await call('rename.run', { settings: web() });
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.renamed, res.data.unchanged, res.data.failedCount, res.data.stale], [3, 0, 0, false]);
  assert.deepEqual([b.name, a.name, m.name], ['Homepage_Desktop_Mockups_Acme_V1', 'Homepage_Desktop_Mockups_Acme_V2', 'Homepage_Mobile_Mockups_Acme_V1']);
  assert.equal(env.log.undo, 1, 'one undo step');

  res = await call('rename.run', { settings: web() });          // again: nothing to do
  assert.deepEqual([res.data.renamed, res.data.unchanged], [0, 3]);
  res = await call('rename.run', { settings: web({ versions: 'r1' }) });
  assert.deepEqual([b.name, a.name, m.name].map((n) => n.split('_').pop()), ['V1R1', 'V2R1', 'V1R1']);
});

test('settings: reset puts this designer back to defaults and leaves the file alone', async () => {
  const { env, call, UK, frame } = scene();
  const a = frame('a', 0, 1600);
  env.select([a]);
  const settings = web({ client: 'Acme', includeSize: false });
  const pre = await call('rename.preview', { settings });
  await call('rename.apply', { settings, expected: pre.data.expected });
  let init = await call('init');
  assert.equal(init.data.settings.renamer.includeSize, false);

  const res = await call('settings.reset');
  assert.equal(JSON.stringify(res.data.renamer), JSON.stringify(UK.naming.defaults()));
  assert.equal(a.name, 'Homepage_Desktop_Mockups_Acme_V1', 'reset never touches layers');

  init = await call('init');
  assert.equal(init.data.settings.renamer.includeSize, true);
  assert.equal(init.data.settings.renamer.client, 'Acme', 'the file still remembers its own client');
});
