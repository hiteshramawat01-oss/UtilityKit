/*
 * Flatten & Merge — renders selected layers to PNG and places the result on the canvas.
 *
 * Rules this module keeps:
 *  - Originals are never edited. Rendering works on temporary copies that are
 *    removed again, even if something fails.
 *  - Originals are only removed when the designer chose "Replace originals"
 *    AND confirmed it, and only after the image exists.
 *  - Figma rejects image fills larger than 4096 px on a side, so large output is
 *    split into seamless tiles and grouped instead of being silently downscaled.
 */
UK.flatten = (function () {
  var MAX_IMAGE = 4096;
  var MAX_TILES = 36;
  var SCALES = [1, 2, 3, 4];
  var GAP = 80;
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

  /** '' when the node can be flattened, otherwise why not. */
  function problemWith(node) {
    if (!node || node.removed) return 'Layer no longer exists';
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

  function tilePlan(width, height, scale) {
    var tile = Math.max(1, Math.floor(MAX_IMAGE / scale));
    var cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
    return { tile: tile, cols: cols, rows: rows, count: cols * rows };
  }

  function cleanScale(scale) {
    var s = Number(scale);
    return SCALES.indexOf(s) === -1 ? 2 : s;
  }

  function describe(box, scale) {
    var t = tilePlan(box.width, box.height, scale);
    return {
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
      pxWidth: Math.ceil(box.width * scale),
      pxHeight: Math.ceil(box.height * scale),
      tiles: t.count,
      tooLarge: t.count > MAX_TILES
    };
  }

  /** Read-only description of what a flatten would produce. */
  function summary(payload) {
    payload = payload || {};
    var scale = cleanScale(payload.scale);
    var nodes = figma.currentPage.selection.slice();
    var parts = split(nodes);
    var out = {
      count: nodes.length,
      usable: parts.usable.length,
      skipped: parts.skipped.slice(0, 20),
      skippedCount: parts.skipped.length,
      scale: scale,
      maxImage: MAX_IMAGE,
      merged: null,
      each: null
    };
    if (!parts.usable.length) return out;

    var boxes = parts.usable.map(boundsOf);
    out.merged = describe(snap(union(boxes)), scale);

    var tiled = 0, tooLarge = 0;
    for (var i = 0; i < boxes.length; i++) {
      var d = describe(snap(boxes[i]), scale);
      if (d.tiles > 1) tiled++;
      if (d.tooLarge) tooLarge++;
    }
    out.each = { tiled: tiled, tooLarge: tooLarge };
    return out;
  }

  // ---- geometry helpers -------------------------------------------------

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

  function topLevel(node) {
    var n = node;
    while (n.parent && n.parent.type !== 'PAGE' && n.parent.type !== 'DOCUMENT') n = n.parent;
    return n;
  }

  // ---- rendering --------------------------------------------------------

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

  function pngSettings(scale) {
    return { format: 'PNG', constraint: { type: 'SCALE', value: scale } };
  }

  /**
   * Renders nodes into one result node sitting on the current page at the
   * selection's own position. Returns { node, tiles, box }.
   */
  async function render(nodes, name, scale) {
    var box = snap(union(nodes.map(boundsOf)));
    var plan = tilePlan(box.width, box.height, scale);
    if (plan.count > MAX_TILES) {
      throw UK.userError('“' + name + '” is too large to flatten at ' + scale + '×. Try a lower scale.');
    }

    // One layer that fits in one image: export it directly, no copies involved.
    if (nodes.length === 1 && plan.count === 1) {
      var exact = boundsOf(nodes[0]);
      var direct = await nodes[0].exportAsync(pngSettings(scale));
      return { node: imageRect(direct, exact, name), tiles: 1, box: exact };
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
          var bytes = await view.exportAsync(pngSettings(scale));
          var tileName = plan.count > 1 ? 'Tile ' + (row * plan.cols + col + 1) : name;
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
    group.name = name;
    return { node: group, tiles: rects.length, box: box };
  }

  /** Puts `result` into `parent` at `index`, keeping its position on the canvas. */
  function moveInto(result, parent, index, at) {
    try {
      parent.insertChild(index, result);
    } catch (e) {
      return false;
    }
    try {
      var container = parent;
      while (container && (container.type === 'GROUP' || container.type === 'BOOLEAN_OPERATION')) container = container.parent;
      if (container && container.type !== 'PAGE' && container.absoluteTransform) {
        result.relativeTransform = multiply(invert(container.absoluteTransform), [[1, 0, at.x], [0, 1, at.y]]);
      } else {
        result.x = at.x;
        result.y = at.y;
      }
    } catch (e2) { /* auto layout parents position their children themselves */ }
    return true;
  }

  function removeOriginals(nodes) {
    var removed = 0, kept = 0;
    for (var i = 0; i < nodes.length; i++) {
      try { nodes[i].remove(); removed++; } catch (e) { kept++; }
    }
    return { removed: removed, kept: kept };
  }

  /**
   * payload: { mode: 'each' | 'merge', scale, replace, confirmReplace }
   */
  async function run(payload) {
    payload = payload || {};
    var mode = payload.mode === 'merge' ? 'merge' : 'each';
    var scale = cleanScale(payload.scale);
    var replace = payload.replace === true;
    if (replace && payload.confirmReplace !== true) {
      throw UK.userError('Replacing originals needs to be confirmed first.');
    }

    var selection = figma.currentPage.selection.slice();
    if (!selection.length) throw UK.userError('Select at least one layer to flatten.');
    var parts = split(selection);
    if (!parts.usable.length) {
      throw UK.userError('Nothing in the selection can be flattened — ' + parts.skipped[0].reason.toLowerCase() + '.');
    }
    if (mode === 'merge' && parts.usable.length < 2) mode = 'each';

    var usable = inPaintOrder(parts.usable);
    var jobs = [];
    if (mode === 'merge') {
      jobs.push({ nodes: usable, name: 'Merged — ' + UK.plural(usable.length, 'layer') });
    } else {
      for (var i = 0; i < usable.length; i++) jobs.push({ nodes: [usable[i]], name: usable[i].name + ' (Flattened)' });
    }

    // Where "beside the originals" is: clear of every artboard the selection lives in.
    var selectionBox = union(usable.map(boundsOf));
    var anchors = union(usable.map(function (n) { return boundsOf(topLevel(n)) || boundsOf(n); }));
    var shiftX = (anchors.x + anchors.width + GAP) - selectionBox.x;

    var created = [], failed = [], tiles = 0, removed = 0, keptOriginals = 0;

    for (var j = 0; j < jobs.length; j++) {
      var job = jobs[j];
      UK.emit('progress', { done: j, total: jobs.length, label: job.name });
      try {
        // Remember where the originals sit before anything is created.
        var parent = job.nodes[0].parent;
        var sameParent = true, topIndex = -1;
        for (var k = 0; k < job.nodes.length; k++) {
          if (job.nodes[k].parent !== parent) sameParent = false;
        }
        if (sameParent && parent) {
          for (var m = 0; m < job.nodes.length; m++) topIndex = Math.max(topIndex, parent.children.indexOf(job.nodes[m]));
        }

        var out = await render(job.nodes, job.name, scale);
        tiles += out.tiles;

        if (replace) {
          if (sameParent && parent && topIndex >= 0) {
            moveInto(out.node, parent, topIndex + 1, { x: out.box.x, y: out.box.y });
          }
          var res = removeOriginals(job.nodes);
          removed += res.removed;
          keptOriginals += res.kept;
        } else {
          out.node.x = out.node.x + shiftX;
        }
        created.push(out.node);
      } catch (err) {
        failed.push({ name: job.name, reason: UK.describeError(err) });
      }
    }
    UK.emit('progress', { done: jobs.length, total: jobs.length, label: '' });

    if (created.length) {
      try { figma.currentPage.selection = created; } catch (e) { /* selection is a convenience */ }
    }
    try { figma.commitUndo(); } catch (e2) { /* older runtimes */ }

    if (!created.length) {
      var why = (failed[0] ? failed[0].reason : 'the export did not complete').replace(/[.\s]*$/, '.');
      throw UK.userError('Flatten failed — ' + why + ' Your layers were not changed.');
    }

    UK.notify(mode === 'merge'
      ? 'Merged ' + UK.plural(usable.length, 'layer') + ' into one image'
      : 'Flattened ' + UK.plural(created.length, 'layer'));

    return {
      mode: mode,
      scale: scale,
      created: created.map(function (n) { return n.id; }),
      selectionKey: UK.selectionKey(figma.currentPage.selection),
      createdCount: created.length,
      sourceCount: usable.length,
      tiles: tiles,
      tiled: tiles > created.length,
      replaced: replace,
      removed: removed,
      keptOriginals: keptOriginals,
      failed: failed.slice(0, 20),
      failedCount: failed.length,
      skipped: parts.skipped.slice(0, 20),
      skippedCount: parts.skipped.length
    };
  }

  return {
    MAX_IMAGE: MAX_IMAGE,
    SCALES: SCALES,
    summary: summary,
    run: run,
    tilePlan: tilePlan,
    invert: invert,
    multiply: multiply
  };
})();
