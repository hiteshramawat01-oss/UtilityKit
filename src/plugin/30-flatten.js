/*
 * Flatten & Merge — turns the selected layers into one image named "[Print Section]",
 * in the same place: the image takes the layers' spot and the layers are removed.
 *
 * Rules this module keeps:
 *  - The image is made and put in place first. Only then are the layers removed,
 *    so a failure on the way leaves the file exactly as it was.
 *  - Rendering works on temporary copies that are deleted again, even on failure.
 *  - The image is made at 1x (the layers' own pixel size).
 *  - Figma rejects image fills larger than 4096 px on a side, so a larger result
 *    is split into seamless pieces in one group rather than being shrunk.
 *  - One undo (Cmd/Ctrl+Z) brings the layers back.
 */
UK.flatten = (function () {
  var MAX_IMAGE = 4096;
  var MAX_TILES = 36;
  var SCALE = 1;
  var RESULT_NAME = '[Print Section]';
  var TEMP_NAME = 'UtilityKit temp (safe to delete)';

  function boundsOf(node) {
    var b = null;
    try { b = node.absoluteRenderBounds || node.absoluteBoundingBox; } catch (e) { b = null; }
    if (!b) return null;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  function union(list) {
    var out = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      if (!out) { out = { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height }; continue; }
      out.x = Math.min(out.x, b.x); out.y = Math.min(out.y, b.y);
      out.r = Math.max(out.r, b.x + b.width); out.b = Math.max(out.b, b.y + b.height);
    }
    return out ? { x: out.x, y: out.y, width: out.r - out.x, height: out.b - out.y } : null;
  }

  function insideInstance(node) {
    var n = node ? node.parent : null;
    while (n) {
      if (n.type === 'INSTANCE') return true;
      n = n.parent;
    }
    return false;
  }

  /** '' when the node can be merged, otherwise why not. */
  function problemWith(node) {
    if (!node || node.removed) return 'Layer no longer exists';
    if (insideInstance(node)) return 'Inside an instance, which can’t be changed';
    if (typeof node.exportAsync !== 'function') return 'This layer type can’t be exported';
    if (node.type === 'SLICE') return 'Slices have nothing of their own to flatten';
    if (node.visible === false) return 'Layer is hidden';
    var b = boundsOf(node);
    if (!b || !(b.width > 0) || !(b.height > 0)) return 'Layer has no visible area';
    return '';
  }

  function split(nodes) {
    var usable = [], skipped = [];
    for (var i = 0; i < nodes.length; i++) {
      var why = problemWith(nodes[i]);
      if (why) skipped.push({ name: nodes[i] ? nodes[i].name : 'Layer', reason: why });
      else usable.push(nodes[i]);
    }
    return { usable: usable, skipped: skipped };
  }

  /** Whole-pixel box around a set of bounds. */
  function snap(b) {
    var x0 = Math.floor(b.x), y0 = Math.floor(b.y);
    return { x: x0, y: y0, width: Math.max(1, Math.ceil(b.x + b.width) - x0), height: Math.max(1, Math.ceil(b.y + b.height) - y0) };
  }

  function tilePlan(width, height) {
    var tile = Math.max(1, Math.floor(MAX_IMAGE / SCALE));
    var cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
    return { tile: tile, cols: cols, rows: rows, count: cols * rows };
  }

  /** Read-only description of what "Merge into one" would produce. */
  function summary() {
    var nodes = figma.currentPage.selection.slice();
    var parts = split(nodes);
    var out = {
      count: nodes.length,
      usable: parts.usable.length,
      skipped: parts.skipped.slice(0, 20),
      skippedCount: parts.skipped.length,
      maxImage: MAX_IMAGE,
      resultName: RESULT_NAME,
      width: 0, height: 0, tiles: 0, tooLarge: false
    };
    if (!parts.usable.length) return out;
    var box = snap(union(parts.usable.map(boundsOf)));
    var t = tilePlan(box.width, box.height);
    out.width = box.width;
    out.height = box.height;
    out.tiles = t.count;
    out.tooLarge = t.count > MAX_TILES;
    return out;
  }

  function indexPath(node) {
    var path = [];
    var n = node;
    while (n && n.parent && n.type !== 'PAGE') {
      path.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    return path;
  }

  /** Bottom-most layer first, the way Figma paints them. */
  function inPaintOrder(nodes) {
    var keyed = nodes.map(function (n) { return { node: n, path: indexPath(n) }; });
    keyed.sort(function (p, q) {
      var len = Math.min(p.path.length, q.path.length);
      for (var i = 0; i < len; i++) {
        if (p.path[i] !== q.path[i]) return p.path[i] - q.path[i];
      }
      return p.path.length - q.path.length;
    });
    return keyed.map(function (k) { return k.node; });
  }

  function invert(m) {
    var a = m[0][0], c = m[0][1], e = m[0][2], b = m[1][0], d = m[1][1], f = m[1][2];
    var det = a * d - b * c;
    if (!det) return [[1, 0, -e], [0, 1, -f]];
    return [
      [d / det, -c / det, (c * f - d * e) / det],
      [-b / det, a / det, (b * e - a * f) / det]
    ];
  }

  function multiply(m, n) {
    return [
      [m[0][0] * n[0][0] + m[0][1] * n[1][0], m[0][0] * n[0][1] + m[0][1] * n[1][1], m[0][0] * n[0][2] + m[0][1] * n[1][2] + m[0][2]],
      [m[1][0] * n[0][0] + m[1][1] * n[1][0], m[1][0] * n[0][1] + m[1][1] * n[1][1], m[1][0] * n[0][2] + m[1][1] * n[1][2] + m[1][2]]
    ];
  }

  /** Puts `result` into `parent` at `index`, keeping its position on the canvas. Throws if the parent refuses it. */
  function moveInto(result, parent, index, at) {
    parent.insertChild(index, result);
    try {
      // Layers inside a group are positioned relative to the nearest frame around the group.
      var container = parent;
      while (container && (container.type === 'GROUP' || container.type === 'BOOLEAN_OPERATION')) container = container.parent;
      if (container && container.type !== 'PAGE' && container.absoluteTransform) {
        result.relativeTransform = multiply(invert(container.absoluteTransform), [[1, 0, at.x], [0, 1, at.y]]);
      } else {
        result.x = at.x;
        result.y = at.y;
      }
    } catch (e) { /* auto layout parents position their children themselves */ }
  }

  function imageRect(bytes, box, name) {
    var image = figma.createImage(bytes);
    var rect = figma.createRectangle();
    rect.name = name;
    rect.x = box.x;
    rect.y = box.y;
    rect.resize(box.width, box.height);
    rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
    return rect;
  }

  var PNG = { format: 'PNG', constraint: { type: 'SCALE', value: SCALE } };

  /**
   * Renders nodes into one result node sitting on the current page at the
   * selection's own position. Returns { node, tiles, box }.
   */
  async function render(nodes) {
    var box = snap(union(nodes.map(boundsOf)));
    var plan = tilePlan(box.width, box.height);
    if (plan.count > MAX_TILES) {
      throw UK.userError('This selection is too large to turn into an image (' + box.width + ' × ' + box.height + ' px). Select fewer layers.');
    }

    // One layer that fits in one image: export it directly, no copies involved.
    if (nodes.length === 1 && plan.count === 1) {
      var exact = boundsOf(nodes[0]);
      var direct = await nodes[0].exportAsync(PNG);
      return { node: imageRect(direct, exact, RESULT_NAME), tiles: 1, box: exact };
    }

    // Otherwise render copies inside a temporary clipping frame ("view").
    var view = figma.createFrame();
    var rects = [];
    try {
      view.name = TEMP_NAME;
      view.fills = [];
      view.clipsContent = true;
      view.x = box.x;
      view.y = box.y;
      view.resize(box.width, box.height);

      var stage = figma.createFrame();
      stage.name = TEMP_NAME;
      stage.fills = [];
      stage.clipsContent = false;
      view.appendChild(stage);
      stage.x = 0;
      stage.y = 0;
      stage.resize(box.width, box.height);

      var ordered = inPaintOrder(nodes);
      for (var i = 0; i < ordered.length; i++) {
        var src = ordered[i];
        var copy = src.type === 'COMPONENT' ? src.createInstance() : src.clone();
        stage.appendChild(copy);
        var t = src.absoluteTransform;
        copy.relativeTransform = [
          [t[0][0], t[0][1], t[0][2] - box.x],
          [t[1][0], t[1][1], t[1][2] - box.y]
        ];
      }

      for (var row = 0; row < plan.rows; row++) {
        for (var col = 0; col < plan.cols; col++) {
          var tx = col * plan.tile, ty = row * plan.tile;
          var tw = Math.min(plan.tile, box.width - tx), th = Math.min(plan.tile, box.height - ty);
          view.x = box.x + tx;
          view.y = box.y + ty;
          view.resize(tw, th);
          stage.x = -tx;
          stage.y = -ty;
          var bytes = await view.exportAsync(PNG);
          var tileName = plan.count > 1 ? 'Part ' + (row * plan.cols + col + 1) : RESULT_NAME;
          rects.push(imageRect(bytes, { x: box.x + tx, y: box.y + ty, width: tw, height: th }, tileName));
        }
      }
    } catch (err) {
      for (var r = 0; r < rects.length; r++) { try { rects[r].remove(); } catch (e) { /* already gone */ } }
      throw err;
    } finally {
      try { view.remove(); } catch (e2) { /* already gone */ }
    }

    if (rects.length === 1) return { node: rects[0], tiles: 1, box: box };
    var group = figma.group(rects, figma.currentPage);
    group.name = RESULT_NAME;
    return { node: group, tiles: rects.length, box: box };
  }

  /** Merges the selected layers into one image named "[Print Section]" that takes their place. */
  async function run() {
    var selection = figma.currentPage.selection.slice();
    if (!selection.length) throw UK.userError('Select at least one layer to merge.');
    var parts = split(selection);
    if (!parts.usable.length) {
      throw UK.userError('Nothing in the selection can be turned into an image — ' + parts.skipped[0].reason.toLowerCase() + '.');
    }
    var usable = inPaintOrder(parts.usable);

    // The image goes where the top-most selected layer sits: same parent, same place in the layer list.
    var top = usable[usable.length - 1];
    var parent = top.parent;
    var index = parent ? parent.children.indexOf(top) + 1 : -1;

    var out;
    try {
      out = await render(usable);
    } catch (err) {
      if (err && err.userFacing) throw err;
      var why = UK.describeError(err).replace(/[.\s]*$/, '.');
      throw UK.userError('The image couldn’t be made — ' + why + ' Your layers were not changed.');
    }

    // In place first; the layers are only removed once the image is where they were.
    try {
      if (!parent || index < 1) throw new Error('The layers have no parent to hold the image');
      moveInto(out.node, parent, index, { x: out.box.x, y: out.box.y });
    } catch (err2) {
      try { out.node.remove(); } catch (e) { /* already gone */ }
      var reason = UK.describeError(err2).replace(/[.\s]*$/, '.');
      throw UK.userError('The image couldn’t be put in place of your layers — ' + reason + ' Your layers were not changed.');
    }

    var removed = 0, kept = [];
    for (var i = 0; i < usable.length; i++) {
      try { usable[i].remove(); removed++; } catch (e2) { kept.push({ name: usable[i].name, reason: UK.describeError(e2) }); }
    }

    try { figma.currentPage.selection = [out.node]; } catch (e3) { /* selecting it is a convenience */ }
    try { figma.commitUndo(); } catch (e4) { /* older runtimes */ }
    UK.notify(usable.length > 1 ? 'Merged ' + usable.length + ' layers into ' + RESULT_NAME : 'Turned 1 layer into ' + RESULT_NAME);

    return {
      name: RESULT_NAME,
      created: [out.node.id],
      selectionKey: UK.selectionKey(figma.currentPage.selection),
      sourceCount: usable.length,
      removed: removed,
      kept: kept.slice(0, 20),
      keptCount: kept.length,
      tiles: out.tiles,
      tiled: out.tiles > 1,
      skipped: parts.skipped.slice(0, 20),
      skippedCount: parts.skipped.length
    };
  }

  return { MAX_IMAGE: MAX_IMAGE, RESULT_NAME: RESULT_NAME, summary: summary, run: run, tilePlan: tilePlan, invert: invert, multiply: multiply };
})();
