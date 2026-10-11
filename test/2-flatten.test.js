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

test('merge: the layers become one image named [Print], in the same place and the same spot in the layer list', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const under = env.add('RECTANGLE', { name: 'under', x: 0, y: 0, width: 10, height: 10 }, art);
  const bottom = env.add('RECTANGLE', { name: 'Bottom', x: 20, y: 30, width: 200, height: 200 }, art);
  const between = env.add('RECTANGLE', { name: 'Not selected', x: 10, y: 10, width: 50, height: 50 }, art);
  const top = env.add('RECTANGLE', { name: 'Top', x: 170, y: 180, width: 200, height: 200, flags: { shadow: 20 } }, art);
  const over = env.add('RECTANGLE', { name: 'over', x: 0, y: 0, width: 10, height: 10 }, art);
  const elsewhere = env.add('FRAME', { name: 'Other artboard', x: 2000, y: 0, width: 500, height: 500 });
  env.select([top, bottom]);                 // selection order differs from paint order
  const count = env.all().length;

  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.equal(res.data.name, '[Print]');
  assert.deepEqual([res.data.sourceCount, res.data.removed, res.data.keptCount], [2, 2, 0]);
  assert.equal(res.data.created.length, 1);
  assert.deepEqual([res.data.tiles, res.data.tiled], [1, false]);

  const img = env.byId[res.data.created[0]];
  assert.equal(img.name, '[Print]');
  assert.equal(img.type, 'RECTANGLE');
  assert.equal(img.fills[0].type, 'IMAGE');
  // no new layer beside the artboard: the image sits inside it, where the top-most selected layer was
  assert.equal(img.parent, art);
  assert.deepEqual(art.children.map((c) => c.name), ['under', 'Not selected', '[Print]', 'over']);
  // union of what was drawn: x 20..390 (the shadow adds 20), y 30..400, inside the artboard
  assert.deepEqual([img.x, img.y, img.width, img.height], [20, 30, 370, 370]);
  assert.deepEqual([img.absoluteBoundingBox.x, img.absoluteBoundingBox.y], [120, 130]);

  // what was rendered: the two copies, bottom first, at 1x
  const exp = env.log.exports[0];
  assert.equal(exp.scale, 1);
  assert.deepEqual(exp.contents.children[0].children.map((c) => [c.name, c.x, c.y]), [['Bottom', 0, 0], ['Top', 150, 150]]);
  assert.deepEqual([exp.pxWidth, exp.pxHeight], [370, 370]);

  // the merged layers are gone, everything else is untouched, nothing temporary is left
  assert.deepEqual([top.removed, bottom.removed], [true, true]);
  assert.deepEqual([under.removed, between.removed, over.removed, elsewhere.removed], [false, false, false, false]);
  assert.deepEqual([between.x, between.y, art.x, art.y, art.width, art.height], [10, 10, 100, 100, 1000, 800]);
  assert.equal(temps(env).length, 0, 'temporary copies are removed');
  assert.equal(env.all().length, count - 1, 'two layers out, one image in');
  // the image is selected; one undo step brings the layers back
  assert.equal(env.figma.currentPage.selection.map((n) => n.id).join(), res.data.created.join());
  assert.equal(res.data.selectionKey, (await call('selection.get')).data.key);
  assert.equal(env.log.undo, 1);
});

test('one layer: replaced by [Print], exported straight from the layer', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const a = env.add('RECTANGLE', { name: 'Hero', x: 50, y: 60, width: 200, height: 100 }, art);
  const hidden = env.add('RECTANGLE', { name: 'h', visible: false }, art);
  env.select([a, hidden]);
  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.sourceCount, res.data.removed, res.data.skippedCount], [1, 1, 1]);
  const img = env.byId[res.data.created[0]];
  assert.equal(img.name, '[Print]');
  assert.deepEqual([img.parent, img.x, img.y, img.width, img.height], [art, 50, 60, 200, 100]);
  assert.deepEqual(art.children.map((c) => c.name), ['[Print]', 'h']);
  assert.equal(env.log.exports.length, 1);
  assert.equal(env.log.exports[0].nodeId, a.id);
  assert.equal(env.log.exports[0].scale, 1);
  assert.equal(a.removed, true);
  assert.equal(hidden.removed, false, 'a layer that was left out is not removed');
});

test('top-level frames and layers inside a group are replaced where they are', async () => {
  const { env, call } = load();
  const f1 = env.add('FRAME', { name: 'Frame 1', x: 500, y: 40, width: 300, height: 200 });
  const other = env.add('FRAME', { name: 'Stays', x: 0, y: 0, width: 100, height: 100 });
  env.select([f1]);
  let res = await call('flatten.run');
  let img = env.byId[res.data.created[0]];
  assert.equal(img.parent.type, 'PAGE');
  assert.deepEqual([img.x, img.y, img.width, img.height], [500, 40, 300, 200]);
  assert.deepEqual(env.figma.currentPage.children.map((c) => c.name), ['[Print]', 'Stays']);
  assert.equal(other.removed, false);

  // inside a group inside a frame: positions are relative to the frame
  const art = env.add('FRAME', { name: 'Artboard', x: 1000, y: 1000, width: 800, height: 600 });
  const p = env.add('RECTANGLE', { name: 'p', x: 10, y: 20, width: 50, height: 50 }, art);
  const q = env.add('RECTANGLE', { name: 'q', x: 100, y: 20, width: 50, height: 50 }, art);
  const r = env.add('RECTANGLE', { name: 'r', x: 200, y: 20, width: 50, height: 50 }, art);
  const group = env.figma.group([p, q, r], art);
  env.select([p, q]);
  res = await call('flatten.run');
  img = env.byId[res.data.created[0]];
  assert.equal(img.parent, group);
  assert.deepEqual(group.children.map((c) => c.name), ['[Print]', 'r']);
  assert.deepEqual([img.absoluteBoundingBox.x, img.absoluteBoundingBox.y, img.width, img.height], [1010, 1020, 140, 50]);
});

test('layers from different parents: the image goes where the top-most one was', async () => {
  const { env, call } = load();
  const a1 = env.add('FRAME', { name: 'A', x: 0, y: 0, width: 400, height: 400 });
  const a2 = env.add('FRAME', { name: 'B', x: 500, y: 0, width: 400, height: 400 });
  const one = env.add('RECTANGLE', { name: 'one', x: 10, y: 10, width: 100, height: 100 }, a1);
  const two = env.add('RECTANGLE', { name: 'two', x: 20, y: 30, width: 100, height: 100 }, a2);
  env.select([one, two]);
  const res = await call('flatten.run');
  const img = env.byId[res.data.created[0]];
  assert.equal(img.parent, a2);
  assert.deepEqual([img.absoluteBoundingBox.x, img.absoluteBoundingBox.y, img.width, img.height], [10, 10, 610, 120]);
  assert.deepEqual([one.removed, two.removed], [true, true]);
  assert.equal(a1.children.length, 0);
});

test('a result larger than 4096 px becomes pieces in a [Print] group, in place, never shrunk', async () => {
  const { env, call, UK } = load();
  assert.deepEqual(plain(UK.flatten.tilePlan(1600, 9000)), { tile: 4096, cols: 1, rows: 3, count: 3 });
  const before = env.add('FRAME', { name: 'Before', x: -3000, y: 0, width: 100, height: 100 });
  const page = env.add('FRAME', { name: 'Long page', x: 200, y: 50, width: 1600, height: 9000 });
  const after = env.add('FRAME', { name: 'After', x: 5000, y: 0, width: 100, height: 100 });
  env.select([page]);
  const sum = await call('flatten.summary');
  assert.deepEqual([sum.data.tiles, sum.data.tooLarge], [3, false]);

  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.tiles, res.data.tiled, res.data.created.length], [3, true, 1]);
  const group = env.byId[res.data.created[0]];
  assert.equal(group.type, 'GROUP');
  assert.equal(group.name, '[Print]');
  assert.deepEqual(env.figma.currentPage.children.map((c) => c.name), ['Before', '[Print]', 'After']);
  const tiles = group.children;
  assert.deepEqual(tiles.map((t) => t.name), ['Part 1', 'Part 2', 'Part 3']);
  assert.deepEqual(tiles.map((t) => t.height), [4096, 4096, 808]);
  assert.deepEqual(tiles.map((t) => t.y), [50, 4146, 8242]);                   // they fit together exactly, where the page was
  assert.ok(tiles.every((t) => t.x === 200 && t.width === 1600));
  assert.ok(env.log.exports.every((e) => e.scale === 1 && e.pxWidth <= 4096 && e.pxHeight <= 4096));
  assert.equal(page.removed, true);
  assert.deepEqual([before.removed, after.removed], [false, false]);
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
  assert.equal(huge.removed, false);
});

test('layers inside an instance cannot be replaced, so they are left out', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', width: 800, height: 600 });
  const inst = env.add('INSTANCE', { name: 'Card', x: 10, y: 10, width: 300, height: 200 }, art);
  const inside = env.add('RECTANGLE', { name: 'Photo', x: 0, y: 0, width: 100, height: 100, flags: { failRemove: true } }, inst);
  const free = env.add('RECTANGLE', { name: 'Free', x: 400, y: 10, width: 100, height: 100 }, art);

  env.select([inside]);
  let sum = await call('flatten.summary');
  assert.equal(sum.data.usable, 0);
  assert.match(sum.data.skipped[0].reason, /Inside an instance/);
  let res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Nothing in the selection can be turned into an image — inside an instance/);
  assert.equal(env.all().length, 4);

  env.select([inside, free]);
  res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.sourceCount, res.data.skippedCount], [1, 1]);
  assert.deepEqual([inside.removed, free.removed], [false, true]);

  // the instance itself is an ordinary layer and can be replaced
  env.select([inst]);
  res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.equal(inst.removed, true);
});

test('failure: clear error, nothing left behind, layers intact', async () => {
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
  assert.deepEqual([b.removed, c.removed], [false, false]);
  assert.equal(env.all().length, 3);

  // the image cannot be put in place: it is thrown away and the layers stay
  const locked = env.add('FRAME', { name: 'Refuses', x: 900, width: 300, height: 300 });
  const d = env.add('RECTANGLE', { name: 'd', width: 50, height: 50 }, locked);
  locked._flags.failInsert = true;
  const before = snapshot(env);
  env.select([d]);
  res = await call('flatten.run');
  assert.equal(res.ok, false);
  assert.match(res.error.message, /couldn’t be put in place of your layers — .*Your layers were not changed\./);
  assert.deepEqual(snapshot(env), before);
  assert.equal(env.log.undo, 0);
});

test('a layer that cannot be removed is kept and reported', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a', width: 50, height: 50 });
  const stuck = env.add('RECTANGLE', { name: 'stuck', x: 100, width: 50, height: 50, flags: { failRemove: true } });
  env.select([a, stuck]);
  const res = await call('flatten.run');
  assert.equal(res.ok, true);
  assert.deepEqual([res.data.removed, res.data.keptCount], [1, 1]);
  assert.equal(res.data.kept[0].name, 'stuck');
  assert.deepEqual([a.removed, stuck.removed], [true, false]);
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

test('matrix helpers: inverse really inverts', () => {
  const { UK } = load();
  const m = [[0, -1, 40], [1, 0, 10]];
  const id = UK.flatten.multiply(UK.flatten.invert(m), m);
  [[1, 0, 0], [0, 1, 0]].forEach((row, r) => row.forEach((v, c) => assert.ok(Math.abs(id[r][c] - v) < 1e-9)));
});
