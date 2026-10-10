/*
 * Layer Renamer — reads the selection, previews, applies names, optional resize.
 */
UK.renamer = (function () {
  var N = UK.naming;
  var PD_BASE = 'uk.pageBase';        // the layer's name before UtilityKit first renamed it
  var PD_APPLIED = 'uk.appliedName';  // the name UtilityKit last gave it
  var MAX_ROWS_TO_UI = 300;

  function readItem(node) {
    var base = '', applied = '';
    try {
      base = node.getPluginData(PD_BASE) || '';
      applied = node.getPluginData(PD_APPLIED) || '';
    } catch (e) { /* some nodes cannot hold plugin data; that is fine */ }
    return { id: node.id, name: node.name, type: node.type, storedBase: base, storedApplied: applied };
  }

  /** What resizing would do to one node, without doing it. */
  function resizePlan(node, mode) {
    var w = node.width, h = node.height;
    if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0)) {
      return { action: 'skip', reason: 'This layer has no size to change' };
    }
    if (typeof node.resize !== 'function' && typeof node.rescale !== 'function' && typeof node.resizeWithoutConstraints !== 'function') {
      return { action: 'skip', reason: 'This layer type can’t be resized' };
    }
    if (Math.abs(w - N.RESIZE_WIDTH) < 0.01) return { action: 'none' };
    var toHeight = mode === 'width' ? h : h * (N.RESIZE_WIDTH / w);
    return { action: 'resize', toWidth: N.RESIZE_WIDTH, toHeight: toHeight, fromWidth: w, fromHeight: h };
  }

  function resizeNode(node, mode) {
    var rp = resizePlan(node, mode);
    if (rp.action !== 'resize') return rp;
    if (mode === 'scale' && typeof node.rescale === 'function') {
      node.rescale(N.RESIZE_WIDTH / node.width);
    } else if (typeof node.resize === 'function') {
      node.resize(rp.toWidth, Math.max(0.01, rp.toHeight));
    } else {
      node.resizeWithoutConstraints(rp.toWidth, Math.max(0.01, rp.toHeight));
    }
    return rp;
  }

  function round(n) { return Math.round(n * 100) / 100; }

  function buildPreview(rawSettings, nodes, limit) {
    var items = [];
    for (var i = 0; i < nodes.length; i++) items.push(readItem(nodes[i]));
    var p = N.plan(rawSettings, items);
    var settings = p.settings;

    var willResize = 0, resizeSkipped = 0;
    for (var j = 0; j < p.rows.length; j++) {
      var row = p.rows[j];
      row.type = items[j].type;
      if (settings.resize) {
        var rp = resizePlan(nodes[j], settings.resizeMode);
        if (rp.action === 'resize') {
          willResize++;
          row.resize = round(rp.fromWidth) + ' × ' + round(rp.fromHeight) + ' → ' + round(rp.toWidth) + ' × ' + round(rp.toHeight);
        } else if (rp.action === 'skip') {
          resizeSkipped++;
          row.resizeNote = rp.reason;
        }
      }
    }

    var max = typeof limit === 'number' ? limit : MAX_ROWS_TO_UI;
    return {
      error: p.error,
      counts: {
        selected: p.counts.selected,
        willRename: p.counts.willRename,
        unchanged: p.counts.unchanged,
        willResize: willResize,
        resizeSkipped: resizeSkipped
      },
      resize: settings.resize,
      rows: p.rows.slice(0, max),
      hiddenRows: Math.max(0, p.rows.length - max),
      // Every id + proposed name, so Apply can prove nothing moved under the preview.
      expected: p.rows.map(function (r) { return { id: r.id, proposed: r.proposed }; })
    };
  }

  function preview(payload) {
    payload = payload || {};
    var nodes = figma.currentPage.selection.slice();
    return buildPreview(payload.settings, nodes, payload.limit);
  }

  /**
   * Applies exactly what the designer saw. If any layer was deleted or renamed
   * since the preview, nothing is changed and a fresh preview is returned.
   */
  async function apply(payload) {
    payload = payload || {};
    var expected = Array.isArray(payload.expected) ? payload.expected : [];
    if (!expected.length) throw UK.userError('Select at least one layer to rename.');

    var settings = N.normalize(payload.settings);
    var problem = N.validate(settings);
    if (problem) throw UK.userError(problem);

    var nodes = [], missing = 0, i;
    for (i = 0; i < expected.length; i++) {
      var node = await figma.getNodeByIdAsync(expected[i].id);
      if (!node || node.removed) missing++; else nodes.push(node);
    }
    if (!nodes.length) throw UK.userError('Those layers no longer exist. Select layers and preview again.');

    var fresh = buildPreview(settings, nodes, MAX_ROWS_TO_UI);
    var stale = missing > 0 || fresh.expected.length !== expected.length;
    for (i = 0; !stale && i < expected.length; i++) {
      if (fresh.expected[i].id !== expected[i].id || fresh.expected[i].proposed !== expected[i].proposed) stale = true;
    }
    if (stale) return { stale: true, preview: fresh };

    var items = nodes.map(readItem);
    var p = N.plan(settings, items);
    var renamed = 0, unchanged = 0, resized = 0;
    var failed = [], resizeSkipped = [];

    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i], row = p.rows[i];
      if (row.changed) {
        try {
          n.name = row.proposed;
          renamed++;
          try {
            n.setPluginData(PD_BASE, row.base);
            n.setPluginData(PD_APPLIED, row.proposed);
          } catch (e1) { /* naming worked; remembering the original is optional */ }
        } catch (e2) {
          failed.push({ name: row.current, reason: UK.describeError(e2) });
        }
      } else {
        unchanged++;
      }
      if (settings.resize) {
        try {
          var rp = resizeNode(n, settings.resizeMode);
          if (rp.action === 'resize') resized++;
          else if (rp.action === 'skip') resizeSkipped.push({ name: n.name, reason: rp.reason });
        } catch (e3) {
          resizeSkipped.push({ name: n.name, reason: UK.describeError(e3) });
        }
      }
    }

    try { figma.commitUndo(); } catch (e4) { /* older runtimes */ }

    var summary = renamed === 0 && resized === 0
      ? 'Nothing needed changing'
      : 'Renamed ' + UK.plural(renamed, 'layer') + (settings.resize ? ', resized ' + resized : '');
    UK.notify(failed.length ? summary + ' — ' + failed.length + ' failed' : summary, failed.length > 0 && renamed === 0);

    return {
      stale: false,
      renamed: renamed,
      unchanged: unchanged,
      resized: resized,
      resizeRequested: settings.resize,
      failed: failed.slice(0, 20),
      failedCount: failed.length,
      resizeSkipped: resizeSkipped.slice(0, 20),
      resizeSkippedCount: resizeSkipped.length
    };
  }

  return { preview: preview, apply: apply, resizePlan: resizePlan, buildPreview: buildPreview };
})();
