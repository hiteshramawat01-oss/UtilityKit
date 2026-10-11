/*
 * Layer Renamer — reads the selection and the current page, works the names
 * out, and applies them. It only ever changes layer names.
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

  function buildPreview(rawSettings, nodes, limit) {
    var items = [];
    for (var i = 0; i < nodes.length; i++) items.push(readItem(nodes[i]));
    var p = N.plan(rawSettings, items, { pageName: figma.currentPage.name });
    var max = typeof limit === 'number' ? limit : MAX_ROWS_TO_UI;
    return {
      error: p.error,
      mode: p.mode,
      pageName: p.pageName,
      pageType: p.pageType,
      autoPageType: p.autoPageType,
      summary: p.summary,
      versionsAuto: p.versionsAuto,
      versionList: p.versionList.slice(0, 12),
      versionCount: p.versionList.length,
      counts: p.counts,
      rows: p.rows.slice(0, max),
      hiddenRows: Math.max(0, p.rows.length - max),
      // Every id + proposed name, so apply() can prove nothing moved underneath it.
      expected: p.rows.map(function (r) { return { id: r.id, proposed: r.proposed }; })
    };
  }

  function preview(payload) {
    payload = payload || {};
    return buildPreview(payload.settings, figma.currentPage.selection.slice(), payload.limit);
  }

  /**
   * Applies exactly the names in `expected`. If any layer was deleted, renamed,
   * moved or resized in between (so its name would now come out differently),
   * nothing is changed and a fresh preview is returned.
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
    if (!nodes.length) throw UK.userError('Those layers no longer exist. Select layers and try again.');

    var fresh = buildPreview(settings, nodes, MAX_ROWS_TO_UI);
    if (fresh.error) throw UK.userError(fresh.error);

    var wanted = {};
    for (i = 0; i < expected.length; i++) wanted[expected[i].id] = expected[i].proposed;
    var stale = missing > 0 || fresh.expected.length !== expected.length;
    for (i = 0; !stale && i < fresh.expected.length; i++) {
      if (wanted[fresh.expected[i].id] !== fresh.expected[i].proposed) stale = true;
    }
    if (stale) return { stale: true, preview: fresh };

    var renamed = 0, unchanged = 0, failed = [];
    for (i = 0; i < fresh.expected.length; i++) {
      var n = byId[fresh.expected[i].id];
      var proposed = fresh.expected[i].proposed;
      var before = n.name;
      if (proposed === before) { unchanged++; continue; }
      try {
        n.name = proposed;
        renamed++;
        try {
          if (!n.getPluginData(PD_ORIGINAL)) n.setPluginData(PD_ORIGINAL, before);
        } catch (e1) { /* naming worked; remembering the original is optional */ }
      } catch (e2) {
        failed.push({ name: before, reason: UK.describeError(e2) });
      }
    }

    try { figma.commitUndo(); } catch (e4) { /* older runtimes */ }

    var summary = renamed === 0 ? 'Nothing needed changing' : 'Renamed ' + UK.plural(renamed, 'frame');
    UK.notify(failed.length ? summary + ' — ' + failed.length + ' failed' : summary, failed.length > 0 && renamed === 0);

    return {
      stale: false,
      renamed: renamed,
      unchanged: unchanged,
      failed: failed.slice(0, 20),
      failedCount: failed.length
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

  return { preview: preview, apply: apply, run: run, detectClient: detectClient, clientExample: clientExample, buildPreview: buildPreview };
})();
