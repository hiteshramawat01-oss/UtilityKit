const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const snapshot = (env) => env.all().map((n) => [n.id, n.name, n.type, n.x, n.y, n.width, n.height, n.parent && n.parent.id].join('|'));
const temps = (env) => env.all().filter((n) => /UtilityKit temp/.test(n.name));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('summary: reports the image size and what is left out; changes nothing', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a', x: 0, y: 0, width: 200, height: 100 });
  const b = env.add('RECTANGLE', { name: 'b', x: 300, y: 50, width: 100, height: 150 });
  const hidden = env.add('RECTANGLE', { name: 'hidden', visible: false });
  env.select([a, b, hidden]);
  const before = snapshot(env);
  const res = await call('flatten.summary');
  assert.equal(res.data.count, 3);
  assert.equal(res.data.usable, 2);
  assert.equal(res.data.skippedCount, 1);
  assert.equal(res.data.skipped[0].reason, 'Layer is hidden');
  assert.equal(res.data.resultName, '[Print]');
  assert.deepEqual([res.data.width, res.data.height, res.data.tiles, res.data.tooLarge], [400, 200, 1, false]);
  assert.deepEqual(snapshot(env), before);
});

test('summary: nothing selected', async () => {
  const { call } = load();
  const res = await call('flatten.summary');
  assert.deepEqual([res.data.count, res.data.usable, res.data.tiles], [0, 0, 0]);
});

test('merge: several layers become one image named [Print], beside the originals', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const bottom = env.add('RECTANGLE', { name: 'Bottom', x: 0, y: 0, width: 200, height: 200 }, art);
  env.add('RECTANGLE', { name: 'Not selected', x: 10, y: 10, width: 50, height: 50 }, art);
  const top = env.add('RECTANGLE', { name: 'Top', x: 150, y: 150, width: 200, height: 200, flags: { shadow: 20 } }, art);
  env.select([top, bottom]);                 // selection order differs from paint order
  const before = snapshot(env);

  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.equal(res.data.name, '[Print]');
  assert.equal(res.data.sourceCount, 2);
  assert.equal(res.data.created.length, 1);
  assert.equal(res.data.tiles, 1);
  assert.equal(res.data.tiled, false);

  const img = env.byId[res.data.created[0]];
  assert.equal(img.name, '[Print]');
  assert.equal(img.type, 'RECTANGLE');
  assert.equal(img.fills[0].type, 'IMAGE');
  assert.equal(img.parent.type, 'PAGE');
  // union of render bounds: x 100..470 (the shadow adds 20), y 100..470
  assert.deepEqual([img.width, img.height], [370, 370]);
  // beside the artboard: its right edge (1100) plus the gap (80); same height on the canvas
  assert.deepEqual([img.x, img.y], [1180, 100]);

  // what was rendered: the two copies, bottom first, at 1x
  const exp = env.log.exports[0];
  assert.equal(exp.scale, 1);
  assert.deepEqual(exp.contents.children[0].children.map((c) => [c.name, c.x, c.y]), [['Bottom', 0, 0], ['Top', 150, 150]]);
  assert.deepEqual([exp.pxWidth, exp.pxHeight], [370, 370]);

  // originals: identical to before; nothing temporary left; the image is selected; one undo step
  const after = snapshot(env);
  before.forEach((line) => assert.ok(after.includes(line), 'original changed: ' + line));
  assert.equal(temps(env).length, 0, 'temporary copies are removed');
  assert.equal(env.all().length, before.length + 1);
  assert.equal(env.figma.currentPage.selection.map((n) => n.id).join(), res.data.created.join());
  assert.equal(res.data.selectionKey, (await call('selection.get')).data.key);
  assert.equal(env.log.undo, 1);
});

test('one layer: also becomes [Print], exported straight from the layer', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const a = env.add('RECTANGLE', { name: 'Hero', x: 50, y: 60, width: 200, height: 100 }, art);
  env.select([a, env.add('RECTANGLE', { name: 'h', visible: false })]);
  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.equal(res.data.sourceCount, 1);
  assert.equal(res.data.skippedCount, 1);
  const img = env.byId[res.data.created[0]];
  assert.equal(img.name, '[Print]');
  assert.deepEqual([img.x, img.y, img.width, img.height], [1180, 160, 200, 100]);
  assert.equal(env.log.exports.length, 1);
  assert.equal(env.log.exports[0].nodeId, a.id);
  assert.equal(env.log.exports[0].scale, 1);
  assert.deepEqual([a.name, a.x, a.y, a.parent], ['Hero', 50, 60, art]);
  assert.equal(a.removed, false);
});

test('a result larger than 4096 px is split into pieces in a [Print] group, never shrunk', async () => {
  const { env, call, UK } = load();
  assert.deepEqual(plain(UK.flatten.tilePlan(1600, 9000)), { tile: 4096, cols: 1, rows: 3, count: 3 });
  const page = env.add('FRAME', { name: 'Long page', x: 0, y: 0, width: 1600, height: 9000 });
  env.select([page]);
  const sum = await call('flatten.summary');
  assert.equal(sum.data.tiles, 3);
  assert.equal(sum.data.tooLarge, false);

  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.equal(res.data.tiles, 3);
  assert.equal(res.data.tiled, true);
  assert.equal(res.data.created.length, 1);
  const group = env.byId[res.data.created[0]];
  assert.equal(group.type, 'GROUP');
  assert.equal(group.name, '[Print]');
  const tiles = group.children;
  assert.deepEqual(tiles.map((t) => t.name), ['Part 1', 'Part 2', 'Part 3']);
  assert.deepEqual(tiles.map((t) => t.height), [4096, 4096, 808]);
  assert.deepEqual(tiles.map((t) => t.y), [0, 4096, 8192]);                    // they fit together exactly
  assert.ok(tiles.every((t) => t.x === 1680 && t.width === 1600));             // beside the page
  assert.ok(env.log.exports.every((e) => e.scale === 1 && e.pxWidth <= 4096 && e.pxHeight <= 4096));
  assert.deepEqual([page.x, page.y, page.width, page.height], [0, 0, 1600, 9000]);
  assert.equal(temps(env).length, 0);
});

test('an absurdly large selection is refused with a clear message', async () => {
  const { env, call } = load();
  const huge = env.add('FRAME', { name: 'Huge', width: 30000, height: 30000 });
  env.select([huge]);
  assert.equal((await call('flatten.summary')).data.tooLarge, true);
  const res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /too large to turn into an image \(30000 × 30000 px\)\. Select fewer layers\./);
  assert.equal(env.all().length, 1);
});

test('there is no way to replace or remove the originals', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'Hero' });
  const b = env.add('RECTANGLE', { name: 'Card', x: 300 });
  env.select([a, b]);
  // options the old version understood are ignored
  const res = await call('flatten.run', { mode: 'each', scale: 4, replace: true, confirmReplace: true });
  assert.equal(res.ok, true);
  assert.equal(res.data.created.length, 1);
  assert.equal(env.byId[res.data.created[0]].name, '[Print]');
  assert.equal(env.log.exports[0].scale, 1);
  assert.deepEqual([a.removed, b.removed], [false, false]);
  assert.equal(env.all().length, 3);
});

test('failure: clear error, nothing left behind, originals intact', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a', flags: { failExport: true } });
  env.select([a]);
  let res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /The image couldn’t be made — Failed to export node\. Your layers were not changed\./);
  assert.equal(a.removed, false);
  assert.equal(env.all().length, 1);

  // a copy cannot be made: the temporary frames are cleaned up
  const b = env.add('RECTANGLE', { name: 'b', flags: { failClone: true } });
  const c = env.add('RECTANGLE', { name: 'c' });
  env.select([b, c]);
  res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Your layers were not changed\./);
  assert.equal(temps(env).length, 0);
  assert.equal(env.all().length, 3);
  assert.equal(env.log.undo, 0);
});

test('invalid selections', async () => {
  const { env, call } = load();
  let res = await call('flatten.run');
  assert.match(res.error.message, /Select at least one layer to merge/);
  env.select([env.add('RECTANGLE', { name: 'h', visible: false }), env.add('RECTANGLE', { name: 'z', width: 0 })]);
  res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Nothing in the selection can be turned into an image — layer is hidden/);
});
