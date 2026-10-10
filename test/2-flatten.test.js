const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load.js');

const snapshot = (env) => env.all().map((n) => [n.id, n.name, n.type, n.x, n.y, n.width, n.height, n.parent && n.parent.id].join('|'));
const temps = (env) => env.all().filter((n) => /UtilityKit temp/.test(n.name));

test('summary: reports size, output pixels and what is skipped; changes nothing', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a', x: 0, y: 0, width: 200, height: 100 });
  const b = env.add('RECTANGLE', { name: 'b', x: 300, y: 50, width: 100, height: 150 });
  const hidden = env.add('RECTANGLE', { name: 'hidden', visible: false });
  env.select([a, b, hidden]);
  const before = snapshot(env);
  const res = await call('flatten.summary', { scale: 2 });
  assert.equal(res.data.count, 3);
  assert.equal(res.data.usable, 2);
  assert.equal(res.data.skipped[0].reason, 'Layer is hidden');
  assert.deepEqual(res.data.merged, { width: 400, height: 200, pxWidth: 800, pxHeight: 400, tiles: 1, tooLarge: false });
  assert.deepEqual(snapshot(env), before);
});

test('flatten each: one image per layer, placed beside, originals untouched', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const a = env.add('RECTANGLE', { name: 'Hero', x: 50, y: 60, width: 200, height: 100 }, art);
  const b = env.add('RECTANGLE', { name: 'Card', x: 400, y: 300, width: 100, height: 150 }, art);
  env.select([a, b]);
  const before = snapshot(env);

  const res = await call('flatten.run', { mode: 'each', scale: 2 });
  assert.equal(res.ok, true);
  assert.equal(res.data.createdCount, 2);
  assert.equal(res.data.removed, 0);

  // originals: identical to before
  const after = snapshot(env);
  before.forEach((line) => assert.ok(after.includes(line), 'original changed: ' + line));
  assert.equal(temps(env).length, 0);

  const made = res.data.created.map((id) => env.byId[id]);
  assert.deepEqual(made.map((n) => n.name), ['Hero (Flattened)', 'Card (Flattened)']);
  assert.equal(made[0].fills[0].type, 'IMAGE');
  assert.deepEqual([made[0].width, made[0].height], [200, 100]);
  // beside the artboard (right edge 1100 + gap 80), keeping their relative layout
  assert.equal(made[0].x, 1180);
  assert.equal(made[0].y, 160);
  assert.equal(made[1].x - made[0].x, 350);
  assert.equal(made[1].y, 400);
  assert.equal(made[0].parent.type, 'PAGE');
  // new images are selected; one undo step
  assert.equal(env.figma.currentPage.selection.map((n) => n.id).join(), res.data.created.join());
  assert.equal(env.log.undo, 1);
  // exported straight from the layer at the chosen scale
  assert.equal(env.log.exports[0].nodeId, a.id);
  assert.equal(env.log.exports[0].scale, 2);
});

test('merge: several layers become one image in paint order, including a shadow margin', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const bottom = env.add('RECTANGLE', { name: 'Bottom', x: 0, y: 0, width: 200, height: 200 }, art);
  env.add('RECTANGLE', { name: 'Not selected', x: 10, y: 10, width: 50, height: 50 }, art);
  const top = env.add('RECTANGLE', { name: 'Top', x: 150, y: 150, width: 200, height: 200, flags: { shadow: 20 } }, art);
  env.select([top, bottom]);                 // selection order differs from paint order
  const before = snapshot(env);

  const res = await call('flatten.run', { mode: 'merge', scale: 1 });
  assert.equal(res.data.mode, 'merge');
  assert.equal(res.data.createdCount, 1);
  assert.equal(res.data.tiles, 1);
  const img = env.byId[res.data.created[0]];
  assert.equal(img.name, 'Merged — 2 layers');
  // union of render bounds: x 100..470 (shadow adds 20), y 100..470
  assert.deepEqual([img.width, img.height], [370, 370]);

  // what was rendered: the two copies, bottom first, positioned inside the box
  const exp = env.log.exports[0];
  const staged = exp.contents.children[0].children;
  assert.deepEqual(staged.map((c) => [c.name, c.x, c.y]), [['Bottom', 0, 0], ['Top', 150, 150]]);
  assert.deepEqual([exp.pxWidth, exp.pxHeight], [370, 370]);

  const after = snapshot(env);
  before.forEach((line) => assert.ok(after.includes(line)));
  assert.equal(temps(env).length, 0, 'temporary copies are removed');
});

test('merge with one usable layer falls back to a plain flatten', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a' });
  env.select([a, env.add('RECTANGLE', { name: 'h', visible: false })]);
  const res = await call('flatten.run', { mode: 'merge', scale: 1 });
  assert.equal(res.data.mode, 'each');
  assert.equal(res.data.skippedCount, 1);
});

test('large output is tiled (never downscaled) and grouped', async () => {
  const { env, call, UK } = load();
  assert.deepEqual(JSON.parse(JSON.stringify(UK.flatten.tilePlan(1600, 9000, 2))), { tile: 2048, cols: 1, rows: 5, count: 5 });
  const page = env.add('FRAME', { name: 'Long page', x: 0, y: 0, width: 1600, height: 9000 });
  env.select([page]);
  const sum = await call('flatten.summary', { scale: 2 });
  assert.equal(sum.data.merged.tiles, 5);

  const res = await call('flatten.run', { mode: 'each', scale: 2 });
  assert.equal(res.ok, true);
  assert.equal(res.data.tiles, 5);
  assert.equal(res.data.tiled, true);
  const group = env.byId[res.data.created[0]];
  assert.equal(group.type, 'GROUP');
  assert.equal(group.name, 'Long page (Flattened)');
  const tiles = group.children;
  assert.deepEqual(tiles.map((t) => t.height), [2048, 2048, 2048, 2048, 808]);
  assert.deepEqual(tiles.map((t) => t.y), [0, 2048, 4096, 6144, 8192]);       // seamless
  assert.ok(env.log.exports.every((e) => e.pxWidth <= 4096 && e.pxHeight <= 4096));
  assert.deepEqual([page.x, page.y, page.width, page.height], [0, 0, 1600, 9000]);
  assert.equal(temps(env).length, 0);
});

test('absurdly large output is refused with a clear message', async () => {
  const { env, call } = load();
  const huge = env.add('FRAME', { name: 'Huge', width: 30000, height: 30000 });
  env.select([huge]);
  const res = await call('flatten.run', { mode: 'each', scale: 4 });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /too large to flatten at 4×.*lower scale.*not changed/);
  assert.equal(env.all().length, 1);
});

test('replace: needs explicit confirmation; then swaps in place', async () => {
  const { env, call } = load();
  const art = env.add('FRAME', { name: 'Artboard', x: 100, y: 100, width: 1000, height: 800 });
  const under = env.add('RECTANGLE', { name: 'under' }, art);
  const a = env.add('RECTANGLE', { name: 'Hero', x: 50, y: 60, width: 200, height: 100 }, art);
  const over = env.add('RECTANGLE', { name: 'over' }, art);
  env.select([a]);

  let res = await call('flatten.run', { mode: 'each', scale: 1, replace: true });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /confirmed/);
  assert.equal(a.removed, false);
  assert.equal(env.all().length, 4);

  res = await call('flatten.run', { mode: 'each', scale: 1, replace: true, confirmReplace: true });
  assert.equal(res.ok, true);
  assert.equal(res.data.removed, 1);
  assert.equal(a.removed, true);
  const img = env.byId[res.data.created[0]];
  assert.equal(img.parent, art);
  assert.deepEqual(art.children.map((c) => c.name), ['under', 'Hero (Flattened)', 'over']);   // same stacking slot
  assert.deepEqual([img.x, img.y], [50, 60]);                                                  // same place
});

test('replace: originals that cannot be removed are kept and counted', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'in instance', flags: { failRemove: true } });
  env.select([a]);
  const res = await call('flatten.run', { mode: 'each', scale: 1, replace: true, confirmReplace: true });
  assert.equal(res.ok, true);
  assert.equal(res.data.removed, 0);
  assert.equal(res.data.keptOriginals, 1);
  assert.equal(a.removed, false);
});

test('export failure: clear error, nothing left behind, originals intact', async () => {
  const { env, call } = load();
  const a = env.add('RECTANGLE', { name: 'a', flags: { failExport: true } });
  env.select([a]);
  let res = await call('flatten.run', { mode: 'each', scale: 1, replace: true, confirmReplace: true });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Flatten failed — Failed to export node\. Your layers were not changed\./);
  assert.equal(a.removed, false);
  assert.equal(env.all().length, 1);

  // merge where a copy cannot be made: temp frames are cleaned up
  const b = env.add('RECTANGLE', { name: 'b', flags: { failClone: true } });
  const c = env.add('RECTANGLE', { name: 'c' });
  env.select([b, c]);
  res = await call('flatten.run', { mode: 'merge', scale: 1 });
  assert.equal(res.ok, false);
  assert.equal(temps(env).length, 0);
  assert.equal(env.all().length, 3);
});

test('partial failure: good layers still flatten, bad ones are listed', async () => {
  const { env, call } = load();
  const good = env.add('RECTANGLE', { name: 'good' });
  const bad = env.add('RECTANGLE', { name: 'bad', flags: { failExport: true } });
  env.select([good, bad]);
  const res = await call('flatten.run', { mode: 'each', scale: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.data.createdCount, 1);
  assert.equal(res.data.failedCount, 1);
  assert.equal(res.data.failed[0].name, 'bad (Flattened)');
});

test('invalid selections', async () => {
  const { env, call } = load();
  let res = await call('flatten.run', { mode: 'each' });
  assert.match(res.error.message, /Select at least one layer/);
  env.select([env.add('RECTANGLE', { name: 'h', visible: false }), env.add('RECTANGLE', { name: 'z', width: 0 })]);
  res = await call('flatten.run', { mode: 'merge' });
  assert.equal(res.ok, false);
  assert.match(res.error.message, /Nothing in the selection can be flattened — layer is hidden/);
});

test('matrix helpers: inverse really inverts', () => {
  const { UK } = load();
  const m = [[0, -1, 40], [1, 0, 10]];
  const id = UK.flatten.multiply(UK.flatten.invert(m), m);
  [[1, 0, 0], [0, 1, 0]].forEach((row, r) => row.forEach((v, c) => assert.ok(Math.abs(id[r][c] - v) < 1e-9)));
});
