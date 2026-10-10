/*
 * Layer Renamer — reads the selection and the current page, previews, applies
 * names, and optionally resizes frames to the standard Desktop / Mobile width.
 */
UK.renamer = (function () {
  var N = UK.naming;
  var PD_ORIGINAL = 'uk.originalName';   // the layer's name before UtilityKit first renamed it
  var MAX_ROWS_TO_UI = 300;

  function readItem(node) {
    var box = null;
    try { box = node.absoluteBoundingBox; } catch (e) { box = null; }
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      width: typeof node.width === 'number' ? node.width : 0,
      height: typeof node.height === 'number' ? node.height : 0,
      x: box ? box.x : (typeof node.x === 'number' ? node.x : 0),
      y: box ? box.y : (typeof node.y === 'number' ? node.y : 0)
    };
  }

  /** What resizing would do to one node, without doing it. */
  function resizePlan(node, settings) {
    var target = settings.resizeTarget, mode = settings.resizeMode;
    if (N.RESIZABLE.indexOf(node.type) === -1) return { action: 'skip', reason: 'Only frames are resized' };
    var w = node.width, h = node.height;
    if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0)) {
      return { action: 'skip', reason: 'This layer has no size to change' };
    }
    if (typeof node.resize !== 'function' && typeof node.rescale !== 'function' && typeof node.resizeWithoutConstraints !== 'function') {
      return { action: 'skip', reason: 'This layer type can’t be resized' };
    }
    if (Math.abs(w - target) < 0.01) return { action: 'none' };
    var toHeight = mode === 'width' ? h : h * (target / w);
    return { action: 'resize', toWidth: target, toHeight: toHeight, fromWidth: w, fromHeight: h };
  }

  function resizeNode(node, settings) {
    var rp = resizePlan(node, settings);
    if (rp.action !== 'resize') return rp;
    if (settings.resizeMode === 'scale' && typeof node.rescale === 'function') {
      node.rescale(rp.toWidth / node.width);
    } else if (typeof node.resize === 'function') {
      node.resize(rp.toWidth, Math.max(0.01, rp.toHeight));
    } else {
      node.resizeWithoutConstraints(rp.toWidth, Math.max(0.01, rp.toHeight));
    }
    return rp;
  }

  function round(n) { return Math.round(n * 100) / 100; }

  function buildPreview(rawSettings, nodes, limit) {
    var byId = {}, items = [];
    for (var i = 0; i < nodes.length; i++) {
      var item = readItem(nodes[i]);
      items.push(item);
      byId[item.id] = nodes[i];
    }
    var p = N.plan(rawSettings, items, { pageName: figma.currentPage.name });
    var settings = p.settings;
    var resizing = settings.mode === 'web' && settings.resize;

    var willResize = 0, resizeSkipped = 0;
    if (resizing && !p.error) {
      for (var j = 0; j < p.rows.length; j++) {
        var row = p.rows[j];
        var rp = resizePlan(byId[row.id], settings);
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
      mode: p.mode,
      pageName: p.pageName,
      pageType: p.pageType,
      autoPageType: p.autoPageType,
      summary: p.summary,
      counts: {
        selected: p.counts.selected,
        willRename: p.counts.willRename,
        unchanged: p.counts.unchanged,
        willResize: willResize,
        resizeSkipped: resizeSkipped
      },
      resize: resizing,
      resizeTarget: settings.resizeTarget,
      rows: p.rows.slice(0, max),
      hiddenRows: Math.max(0, p.rows.length - max),
      // Every id + proposed name, so Apply can prove nothing moved under the preview.
      expected: p.rows.map(function (r) { return { id: r.id, proposed: r.proposed }; })
    };
  }

  function preview(payload) {
    payload = payload || {};
    return buildPreview(payload.settings, figma.currentPage.selection.slice(), payload.limit);
  }

  /**
   * Applies exactly what the designer saw. If any layer was deleted, renamed,
   * moved or resized since the preview (so its name would now come out
   * differently), nothing is changed and a fresh preview is returned.
   */
  async function apply(payload) {
    payload = payload || {};
    var expected = Array.isArray(payload.expected) ? payload.expected : [];
    if (!expected.length) throw UK.userError('Select at least one layer to rename.');

    var settings = N.normalize(payload.settings);
    var nodes = [], byId = {}, missing = 0, i;
    for (i = 0; i < expected.length; i++) {
      var node = await figma.getNodeByIdAsync(expected[i].id);
      if (!node || node.removed) missing++;
      else { nodes.push(node); byId[node.id] = node; }
    }
    if (!nodes.length) throw UK.userError('Those layers no longer exist. Select layers and preview again.');

    var fresh = buildPreview(settings, nodes, MAX_ROWS_TO_UI);
    if (fresh.error) throw UK.userError(fresh.error);

    var wanted = {};
    for (i = 0; i < expected.length; i++) wanted[expected[i].id] = expected[i].proposed;
    var stale = missing > 0 || fresh.expected.length !== expected.length;
    for (i = 0; !stale && i < fresh.expected.length; i++) {
      if (wanted[fresh.expected[i].id] !== fresh.expected[i].proposed) stale = true;
    }
    if (stale) return { stale: true, preview: fresh };

    var renamed = 0, unchanged = 0, resized = 0;
    var failed = [], resizeSkipped = [];
    var resizing = settings.mode === 'web' && settings.resize;

    for (i = 0; i < fresh.expected.length; i++) {
      var n = byId[fresh.expected[i].id];
      var proposed = fresh.expected[i].proposed;
      var before = n.name;
      if (proposed !== before) {
        try {
          n.name = proposed;
          renamed++;
          try {
            if (!n.getPluginData(PD_ORIGINAL)) n.setPluginData(PD_ORIGINAL, before);
          } catch (e1) { /* naming worked; remembering the original is optional */ }
        } catch (e2) {
          failed.push({ name: before, reason: UK.describeError(e2) });
        }
      } else {
        unchanged++;
      }
      if (resizing) {
        try {
          var rp = resizeNode(n, settings);
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
      : 'Renamed ' + UK.plural(renamed, 'layer') + (resizing ? ', resized ' + resized : '');
    UK.notify(failed.length ? summary + ' — ' + failed.length + ' failed' : summary, failed.length > 0 && renamed === 0);

    return {
      stale: false,
      renamed: renamed,
      unchanged: unchanged,
      resized: resized,
      resizeRequested: resizing,
      resizeTarget: settings.resizeTarget,
      failed: failed.slice(0, 20),
      failedCount: failed.length,
      resizeSkipped: resizeSkipped.slice(0, 20),
      resizeSkippedCount: resizeSkipped.length
    };
  }

  /** Renames the current selection in one go: works the names out and applies them. */
  async function run(payload) {
    payload = payload || {};
    var nodes = figma.currentPage.selection.slice();
    if (!nodes.length) throw UK.userError('Select at least one frame to rename.');
    var p = buildPreview(payload.settings, nodes, 0);
    if (p.error) throw UK.userError(p.error);
    return apply({ settings: payload.settings, expected: p.expected });
  }

  /** Looks for the client in frames on this page that are already named to the guideline. */
  function detectClient() {
    var names = [], i;
    var top = figma.currentPage.children || [];
    for (i = 0; i < top.length && i < 500; i++) names.push(top[i].name);
    var sel = figma.currentPage.selection;
    for (i = 0; i < sel.length && i < 200; i++) names.push(sel[i].name);
    return N.clientFromNames(names);
  }

  /** What a name will look like with this client, for the "which client?" screen. */
  function clientExample(payload) {
    var client = N.compact(payload && payload.client);
    var pageType = N.pageTypeFrom(figma.currentPage.name) || 'Homepage';
    return { compact: client, example: client ? pageType + '_' + client + '_V1' : '' };
  }

  return { preview: preview, apply: apply, run: run, detectClient: detectClient, clientExample: clientExample, resizePlan: resizePlan, buildPreview: buildPreview };
})();
