// ---- 00-core.js ----
/*
 * UtilityKit — plugin logic (Figma sandbox).
 *
 * This file is built from src/plugin/*.js by build.js. The sandbox never
 * touches the DOM; it talks to the interface (ui.html) only through messages.
 *
 * Syntax is kept conservative on purpose (no optional chaining, no object
 * spread) because Figma's sandbox is stricter than a browser.
 */
var UK = { VERSION: '1.3.0' };   // filled in from version.json by build.js

/** An error whose message is safe and useful to show to the designer. */
UK.userError = function (message, code) {
  var e = new Error(message);
  e.userFacing = true;
  if (code) e.code = code;
  return e;
};

UK.collapse = function (value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
};

UK.plural = function (n, one, many) {
  return n + ' ' + (n === 1 ? one : (many || one + 's'));
};

/** Turns anything thrown by Figma into one readable sentence. */
UK.describeError = function (err) {
  if (!err) return 'Something went wrong.';
  var msg = typeof err === 'string' ? err : (err.message || String(err));
  msg = UK.collapse(msg).replace(/^in \w+:\s*/i, '');
  return msg || 'Something went wrong.';
};

/** Pushes an event to the interface. Wired up in boot(); a no-op in tests. */
UK.emit = function (type, data) {
  if (typeof UK._post === 'function') UK._post({ type: type, data: data });
};

/** A short signature of a selection, used to notice when it has changed. */
UK.selectionKey = function (nodes) {
  var ids = [];
  for (var i = 0; i < nodes.length && i < 40; i++) ids.push(nodes[i].id);
  return nodes.length + ':' + ids.join(',');
};

UK.notify = function (message, isError) {
  try {
    figma.notify(message, isError ? { error: true, timeout: 5000 } : { timeout: 3000 });
  } catch (e) { /* notify is a nicety, never a reason to fail */ }
};

// ---- 05-loader.js ----
/*
 * Loader — decides which copy of UtilityKit runs when the plugin starts.
 *
 * A Figma plugin cannot change the files in its own folder. What it can do is
 * keep a newer copy of its code in Figma's plugin storage and run that copy
 * instead. That is how "Update now" works:
 *
 *   1. The update is downloaded from the UtilityKit repository and saved here.
 *   2. On every start the loader runs the saved copy if it is newer than the
 *      files in the plugin folder; otherwise it runs the files in the folder.
 *
 * Safety nets:
 *   - A saved copy is marked "pending" each time it starts and "confirmed" once
 *     its interface has loaded. If it never confirms, the next start throws it
 *     away and goes back to the files in the plugin folder.
 *   - If the files in the folder are the same version or newer, the saved copy
 *     is deleted.
 *
 * The loader itself only changes when the files in the folder change, so keep
 * this API stable: start, confirm, save, clear, restart, info, canRun.
 */

/** Turns source text into a function without running it. Kept at the top level so the
 *  evaluated code cannot see the loader's own variables. */
function __ukCompile(source) {
  return eval(source);
}

var UKLoader = (typeof UKLoader === 'object' && UKLoader) || (function () {
  var KEY = 'utilitykit.update.v1';
  var BUNDLED = '1.3.0';          // the version in the plugin folder
  var MIN_CHARS = 1000;
  var MAX_CHARS = 1500000;

  var state = { source: 'bundled', version: BUNDLED, bundledVersion: BUNDLED, note: '' };
  var bootBundled = null;
  var api = {};

  function parse(value) {
    var m = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(value));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  function newer(a, b) {
    var x = parse(a), y = parse(b);
    if (!x || !y) return false;
    for (var i = 0; i < 3; i++) {
      if (x[i] !== y[i]) return x[i] > y[i];
    }
    return false;
  }

  function wrap(code) {
    return '(function (figma, __html__, UKLoader, __UK_DOWNLOADED__) {\n' + code + '\n})';
  }

  /** Can this Figma run a saved copy at all? */
  function canRun() {
    try { return __ukCompile('(function () { return 7; })')() === 7; } catch (e) { return false; }
  }

  function valid(update) {
    return !!update && typeof update === 'object' && !!parse(update.version) &&
      typeof update.code === 'string' && typeof update.html === 'string' &&
      update.code.length >= MIN_CHARS && update.code.length <= MAX_CHARS &&
      update.html.length >= MIN_CHARS && update.html.length <= MAX_CHARS;
  }

  async function read() {
    try {
      var saved = await figma.clientStorage.getAsync(KEY);
      return valid(saved) ? saved : null;
    } catch (e) { return null; }
  }

  async function clear() {
    try {
      if (typeof figma.clientStorage.deleteAsync === 'function') await figma.clientStorage.deleteAsync(KEY);
      else await figma.clientStorage.setAsync(KEY, null);
    } catch (e) { /* nothing saved, nothing to clear */ }
  }

  /**
   * Starts UtilityKit. `boot` starts the copy in the plugin folder; it is
   * remembered so later restarts can fall back to it.
   */
  async function start(boot) {
    if (typeof boot === 'function') bootBundled = boot;
    state.source = 'bundled';
    state.version = BUNDLED;
    state.note = '';

    var saved = await read();
    if (saved && !newer(saved.version, BUNDLED)) {
      await clear();                      // the folder has caught up with (or passed) the saved copy
      saved = null;
    }
    if (saved && saved.pending) {
      state.note = 'Update ' + saved.version + ' didn’t start properly, so UtilityKit went back to version ' + BUNDLED + '.';
      await clear();
      saved = null;
    }
    if (saved && !canRun()) saved = null;

    if (saved) {
      try {
        var run = __ukCompile(wrap(saved.code));
        saved.pending = true;
        await figma.clientStorage.setAsync(KEY, saved);
        state.source = 'downloaded';
        state.version = saved.version;
        run(figma, saved.html, api, true);
        return info();
      } catch (err) {
        state.source = 'bundled';
        state.version = BUNDLED;
        state.note = 'Update ' + saved.version + ' couldn’t be started, so UtilityKit went back to version ' + BUNDLED + '.';
        await clear();
      }
    }
    if (bootBundled) bootBundled();
    return info();
  }

  /** Called once the running copy's interface has loaded: the saved copy is good. */
  async function confirm() {
    if (state.source !== 'downloaded') return;
    var saved = await read();
    if (saved && saved.pending && saved.version === state.version) {
      saved.pending = false;
      try { await figma.clientStorage.setAsync(KEY, saved); } catch (e) { /* it will simply be retried next start */ }
    }
  }

  /** Saves a downloaded copy. Throws if it is not usable; nothing is saved in that case. */
  async function save(update) {
    if (!canRun()) throw new Error('This version of Figma can’t run downloaded updates.');
    if (!valid(update)) throw new Error('The downloaded update is incomplete.');
    if (!newer(update.version, BUNDLED)) throw new Error('The downloaded update is not newer than the installed version.');
    __ukCompile(wrap(update.code));       // a syntax error stops here, before anything is saved
    await figma.clientStorage.setAsync(KEY, { version: update.version, code: update.code, html: update.html, pending: false, savedAt: Date.now() });
  }

  /** Stops the running copy (via `shutdown`) and starts again from the top. */
  async function restart(shutdown) {
    try { if (typeof shutdown === 'function') shutdown(); } catch (e) { /* start over regardless */ }
    return start();
  }

  function info() {
    return { source: state.source, version: state.version, bundledVersion: state.bundledVersion, note: state.note, canRun: canRun() };
  }

  api.KEY = KEY;
  api.start = start;
  api.confirm = confirm;
  api.save = save;
  api.clear = clear;
  api.restart = restart;
  api.info = info;
  api.canRun = canRun;
  api.newer = newer;
  return api;
})();

// ---- 10-naming.js ----
/*
 * Naming engine — pure functions, no Figma API.
 * Everything the Layer Renamer decides about a name happens here, so it can be
 * unit-tested without Figma and the preview can never disagree with Apply.
 */
UK.naming = (function () {
  var FIELD_KEYS = ['page', 'phase', 'client', 'version'];
  var FIELD_LABELS = { page: 'Page', phase: 'Design Phase', client: 'Client', version: 'Version' };
  var SEPARATORS = { dash: ' - ', pipe: ' | ', slash: ' / ', underscore: '_' };
  var RESIZE_WIDTH = 1600;

  function defaults() {
    return {
      order: FIELD_KEYS.slice(),
      enabled: { page: true, phase: true, client: true, version: true },
      pageSource: 'layer',      // 'layer' = each layer's own name, 'custom' = typed text
      page: '',
      phase: '',
      client: '',
      version: '',
      separator: 'dash',
      capitalize: true,
      stripDate: true,
      versionPrefix: true,
      numberDuplicates: false,
      resize: false,
      resizeMode: 'scale'       // 'scale' = keep aspect ratio, 'width' = width only
    };
  }

  /** Accepts anything (old saved data, partial objects) and returns valid settings. */
  function normalize(raw) {
    var out = defaults();
    if (!raw || typeof raw !== 'object') return out;
    var i, key;

    if (Array.isArray(raw.order)) {
      var order = [];
      for (i = 0; i < raw.order.length; i++) {
        key = raw.order[i];
        if (FIELD_KEYS.indexOf(key) !== -1 && order.indexOf(key) === -1) order.push(key);
      }
      for (i = 0; i < FIELD_KEYS.length; i++) {
        if (order.indexOf(FIELD_KEYS[i]) === -1) order.push(FIELD_KEYS[i]);
      }
      out.order = order;
    }
    if (raw.enabled && typeof raw.enabled === 'object') {
      for (i = 0; i < FIELD_KEYS.length; i++) {
        key = FIELD_KEYS[i];
        if (typeof raw.enabled[key] === 'boolean') out.enabled[key] = raw.enabled[key];
      }
    }
    for (i = 0; i < FIELD_KEYS.length; i++) {
      key = FIELD_KEYS[i];
      if (typeof raw[key] === 'string' || typeof raw[key] === 'number') out[key] = String(raw[key]).slice(0, 200);
    }
    if (raw.pageSource === 'custom' || raw.pageSource === 'layer') out.pageSource = raw.pageSource;
    if (Object.prototype.hasOwnProperty.call(SEPARATORS, raw.separator)) out.separator = raw.separator;
    if (raw.resizeMode === 'scale' || raw.resizeMode === 'width') out.resizeMode = raw.resizeMode;
    var flags = ['capitalize', 'stripDate', 'versionPrefix', 'numberDuplicates', 'resize'];
    for (i = 0; i < flags.length; i++) {
      if (typeof raw[flags[i]] === 'boolean') out[flags[i]] = raw[flags[i]];
    }
    return out;
  }

  var collapse = UK.collapse;

  // Leading "YYYY-MM" (optionally "-DD"), plus whatever separator follows it.
  var LEADING_DATE = /^\s*(?:19|20)\d{2}[-_.\/](?:0[1-9]|1[0-2])(?:[-_.\/](?:0[1-9]|[12]\d|3[01]))?(?!\d)\s*(?:[-–—_:|\/,]+\s*)*/;
  var EDGE_JUNK = /^[\s\-–—_|\/:,]+|[\s\-–—_|\/:,]+$/g;

  function stripLeadingDate(value) {
    return String(value).replace(LEADING_DATE, '');
  }

  /** Uppercases the first letter of each word and leaves the rest alone (so "CTA" and "iPad" survive). */
  function capitalizeWords(value) {
    return String(value).replace(/(^|[\s\/(\[_]+)([^\s\/(\[_])/g, function (m, lead, ch) {
      return lead + ch.toUpperCase();
    });
  }

  function tidy(value) {
    return collapse(value).replace(EDGE_JUNK, '');
  }

  function formatVersion(value, prefix) {
    var v = tidy(value);
    if (!v || !prefix) return v;
    var m = /^v(?:ersion)?[\s.\-_]*(\d.*)$/i.exec(v);
    if (m) return 'V' + m[1];
    if (/^\d/.test(v)) return 'V' + v;
    return v;
  }

  /** The Page value taken from a layer's own name. */
  function pageFromLayerName(layerName, settings) {
    var v = String(layerName === null || layerName === undefined ? '' : layerName);
    if (settings.stripDate) v = stripLeadingDate(v);
    v = tidy(v.replace(/_/g, ' '));
    return v;
  }

  function fieldValue(key, settings, layerName) {
    var v;
    if (key === 'page') {
      v = settings.pageSource === 'layer' ? pageFromLayerName(layerName, settings) : tidy(settings.page);
    } else if (key === 'version') {
      v = formatVersion(settings.version, settings.versionPrefix);
    } else {
      v = tidy(settings[key]);
    }
    if (v && settings.capitalize) v = capitalizeWords(v);
    return v;
  }

  /** Builds one name. Empty and switched-off fields are simply left out. */
  function buildName(settings, layerName) {
    var parts = [];
    for (var i = 0; i < settings.order.length; i++) {
      var key = settings.order[i];
      if (!settings.enabled[key]) continue;
      var v = fieldValue(key, settings, layerName);
      if (v) parts.push({ key: key, value: v });
    }
    var values = [];
    for (var j = 0; j < parts.length; j++) values.push(parts[j].value);
    return { name: values.join(SEPARATORS[settings.separator]), parts: parts };
  }

  /** Returns '' when the settings can produce a name, otherwise the reason they cannot. */
  function validate(settings) {
    for (var i = 0; i < FIELD_KEYS.length; i++) {
      var key = FIELD_KEYS[i];
      if (!settings.enabled[key]) continue;
      if (key === 'page' && settings.pageSource === 'layer') return '';
      if (tidy(settings[key])) return '';
    }
    return 'Add at least one naming field (Page, Design Phase, Client or Version) before renaming.';
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

  /**
   * If a layer name already follows the current format (for example it was named
   * by hand or by an older tool), returns just its Page part so the fields are
   * not appended a second time. A different version number still counts as a
   * match, so "Home - Design - Acme - V1" can become "... - V2". Otherwise ''.
   */
  function unwrapPage(settings, layerName) {
    if (settings.pageSource !== 'layer' || !settings.enabled.page) return '';
    var before = [], after = [], seenPage = false;
    for (var i = 0; i < settings.order.length; i++) {
      var key = settings.order[i];
      if (key === 'page') { seenPage = true; continue; }
      if (!settings.enabled[key]) continue;
      var v = fieldValue(key, settings, '');
      if (!v) continue;
      var re = key === 'version' && /^v?\d/i.test(v) ? 'v?\\d+(?:\\.\\d+)*' : escapeRe(v).replace(/ /g, '\\s+');
      (seenPage ? after : before).push(re);
    }
    if (!before.length && !after.length) return '';
    var sep = SEPARATORS[settings.separator];
    var sepRe = sep === '_' ? '_' : '\\s*' + escapeRe(sep.trim()) + '\\s*';
    var pattern = '^' + (before.length ? before.join(sepRe) + sepRe : '') + '(.+?)' + (after.length ? sepRe + after.join(sepRe) : '') + '$';
    var m = new RegExp(pattern, 'i').exec(collapse(layerName));
    return m ? m[1] : '';
  }

  /**
   * Works out the new name for every layer.
   * items: [{ id, name, storedBase, storedApplied }]
   *   storedBase / storedApplied let a second run start from the layer's original
   *   page name instead of stacking "Home - Design - Acme - V1 - Design - Acme - V2".
   */
  function plan(rawSettings, items) {
    var settings = normalize(rawSettings);
    var error = validate(settings);
    var rows = [];
    var i, item, base, built;

    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (item.storedApplied && item.storedBase && item.storedApplied === item.name) base = item.storedBase;
      else base = (!error && unwrapPage(settings, item.name)) || item.name;
      built = error ? { name: '', parts: [] } : buildName(settings, base);
      rows.push({
        id: item.id,
        current: item.name,
        base: base,
        proposed: built.name,
        changed: false,
        note: ''
      });
    }

    if (!error && settings.numberDuplicates) {
      var seen = {}, counters = {};
      for (i = 0; i < rows.length; i++) {
        if (rows[i].proposed) seen[rows[i].proposed] = (seen[rows[i].proposed] || 0) + 1;
      }
      for (i = 0; i < rows.length; i++) {
        var p = rows[i].proposed;
        if (p && seen[p] > 1) {
          counters[p] = (counters[p] || 0) + 1;
          rows[i].proposed = p + SEPARATORS[settings.separator] + pad2(counters[p]);
        }
      }
    }

    var willRename = 0, unchanged = 0;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (error) {
        row.proposed = row.current;
        row.note = 'No naming fields set';
      } else if (!row.proposed) {
        row.proposed = row.current;
        row.note = 'Nothing left to name it with';
      } else if (row.proposed === row.current) {
        row.note = 'Already named this way';
      } else {
        row.changed = true;
      }
      if (row.changed) willRename++; else unchanged++;
    }

    return {
      error: error,
      settings: settings,
      rows: rows,
      counts: { selected: rows.length, willRename: willRename, unchanged: unchanged }
    };
  }

  return {
    FIELD_KEYS: FIELD_KEYS,
    FIELD_LABELS: FIELD_LABELS,
    SEPARATORS: SEPARATORS,
    RESIZE_WIDTH: RESIZE_WIDTH,
    defaults: defaults,
    normalize: normalize,
    stripLeadingDate: stripLeadingDate,
    capitalizeWords: capitalizeWords,
    formatVersion: formatVersion,
    pageFromLayerName: pageFromLayerName,
    buildName: buildName,
    validate: validate,
    unwrapPage: unwrapPage,
    plan: plan
  };
})();

// ---- 20-renamer.js ----
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

// ---- 30-flatten.js ----
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

// ---- 40-drive.js ----
/*
 * Google Drive Links — finds Drive / Docs hyperlinks on the "For Designers" page.
 *
 * What this can do: read hyperlinks that already exist in this Figma file, open
 * them in the browser, and add new link text to the page.
 * What it cannot do (and does not pretend to): look inside Google Drive, check
 * that a link works or who can open it, upload files, or sync anything. The
 * plugin never contacts Google: its only network permission is the GitHub
 * address used by "Check for updates" (see manifest.json).
 */
UK.drive = (function () {
  var PAGE_NAME = 'For Designers';
  var HOSTS = ['drive.google.com', 'docs.google.com'];
  var PD_CONTAINER = 'uk.driveLinks';
  var CONTAINER_NAME = 'Drive Links';
  var URL_IN_TEXT = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"')\]]*/gi;

  /** Returns { url, host, path } for a Google Drive/Docs URL, or null. */
  function parseGoogleUrl(raw) {
    var value = UK.collapse(raw);
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(value)) value = 'https://' + value;
    var m = /^(https?):\/\/([^\/?#\s]+)([^\s]*)$/i.exec(value);
    if (!m) return null;
    var host = m[2].toLowerCase();
    if (host.indexOf('@') !== -1) return null;
    if (HOSTS.indexOf(host) === -1) return null;
    return { url: 'https://' + host + m[3], host: host, path: m[3] };
  }

  function kindOf(parsed) {
    var p = parsed.path;
    if (parsed.host === 'docs.google.com') {
      if (/^\/document\//.test(p)) return 'Doc';
      if (/^\/spreadsheets\//.test(p)) return 'Sheet';
      if (/^\/presentation\//.test(p)) return 'Slides';
      if (/^\/forms\//.test(p)) return 'Form';
      return 'Docs';
    }
    if (/\/folders\//.test(p) || /folderview/.test(p)) return 'Folder';
    if (/^\/file\//.test(p)) return 'File';
    return 'Drive';
  }

  function findPage() {
    var pages = figma.root.children;
    var wanted = PAGE_NAME.toLowerCase();
    var i;
    for (i = 0; i < pages.length; i++) {
      if (UK.collapse(pages[i].name).toLowerCase() === wanted) return pages[i];
    }
    // Tolerate decorated names such as "📎 For Designers" or "For Designers — links".
    for (i = 0; i < pages.length; i++) {
      if (UK.collapse(pages[i].name).toLowerCase().indexOf(wanted) !== -1) return pages[i];
    }
    return null;
  }

  function positionOf(node) {
    var b = null;
    try { b = node.absoluteBoundingBox; } catch (e) { b = null; }
    return b ? { x: b.x, y: b.y } : { x: Infinity, y: Infinity };
  }

  async function collect(page) {
    await page.loadAsync();
    var texts = page.findAllWithCriteria({ types: ['TEXT'] });
    var found = [];

    for (var i = 0; i < texts.length; i++) {
      var node = texts[i];
      var pos = positionOf(node);
      var linked = {};
      var segments = [];
      try { segments = node.getStyledTextSegments(['hyperlink']); } catch (e) { segments = []; }

      for (var s = 0; s < segments.length; s++) {
        var link = segments[s].hyperlink;
        if (!link || link.type !== 'URL') continue;
        var parsed = parseGoogleUrl(link.value);
        if (!parsed) continue;
        linked[parsed.url] = true;
        found.push({
          url: parsed.url,
          label: UK.collapse(segments[s].characters) || node.name,
          kind: kindOf(parsed),
          source: 'hyperlink',
          nodeId: node.id,
          x: pos.x, y: pos.y, order: found.length
        });
      }

      // Pasted URLs that were never turned into a hyperlink are still useful to surface.
      var chars = '';
      try { chars = node.characters || ''; } catch (e2) { chars = ''; }
      var matches = chars.match(URL_IN_TEXT) || [];
      for (var k = 0; k < matches.length; k++) {
        var plain = parseGoogleUrl(matches[k].replace(/[.,;:!?]+$/, ''));
        if (!plain || linked[plain.url]) continue;
        linked[plain.url] = true;
        found.push({
          url: plain.url,
          label: node.name && node.name !== chars ? UK.collapse(node.name).slice(0, 80) : 'Pasted link',
          kind: kindOf(plain),
          source: 'text',
          nodeId: node.id,
          x: pos.x, y: pos.y, order: found.length
        });
      }
    }

    // "First" means first as a person reads the page: top to bottom, then left to right.
    found.sort(function (a, b) {
      if (Math.abs(a.y - b.y) > 1) return a.y - b.y;
      if (Math.abs(a.x - b.x) > 1) return a.x - b.x;
      return a.order - b.order;
    });

    var byUrl = {}, links = [];
    for (var j = 0; j < found.length; j++) {
      var f = found[j];
      if (byUrl[f.url]) { byUrl[f.url].count++; continue; }
      var entry = { url: f.url, label: f.label, kind: f.kind, source: f.source, nodeId: f.nodeId, count: 1 };
      byUrl[f.url] = entry;
      links.push(entry);
    }
    return links;
  }

  async function scan() {
    var page = findPage();
    if (!page) return { pageFound: false, pageName: PAGE_NAME, links: [] };
    var links = await collect(page);
    return {
      pageFound: true,
      pageName: page.name,
      pageId: page.id,
      isCurrentPage: figma.currentPage.id === page.id,
      links: links
    };
  }

  function createPage() {
    var existing = findPage();
    if (existing) return existing;
    var page = figma.createPage();
    page.name = PAGE_NAME;
    return page;
  }

  async function loadAnyFont() {
    var tries = [
      { family: 'Inter', style: 'Regular' },
      { family: 'Roboto', style: 'Regular' },
      { family: 'Arial', style: 'Regular' }
    ];
    for (var i = 0; i < tries.length; i++) {
      try { await figma.loadFontAsync(tries[i]); return tries[i]; } catch (e) { /* try the next */ }
    }
    var all = await figma.listAvailableFontsAsync();
    if (!all.length) throw UK.userError('No fonts are available to write the link with.');
    await figma.loadFontAsync(all[0].fontName);
    return all[0].fontName;
  }

  function findContainer(page) {
    for (var i = 0; i < page.children.length; i++) {
      var child = page.children[i];
      if (child.type !== 'FRAME') continue;
      var tagged = false;
      try { tagged = child.getPluginData(PD_CONTAINER) === '1'; } catch (e) { tagged = false; }
      if (tagged || child.name === CONTAINER_NAME) return child;
    }
    return null;
  }

  function makeContainer(page, font) {
    // Place it below whatever is already on the page so nothing is covered.
    var left = 0, bottom = null;
    for (var i = 0; i < page.children.length; i++) {
      var b = null;
      try { b = page.children[i].absoluteBoundingBox; } catch (e) { b = null; }
      if (!b) continue;
      if (bottom === null) { left = b.x; bottom = b.y + b.height; }
      else { left = Math.min(left, b.x); bottom = Math.max(bottom, b.y + b.height); }
    }

    var frame = figma.createFrame();
    page.appendChild(frame);
    frame.name = CONTAINER_NAME;
    try { frame.setPluginData(PD_CONTAINER, '1'); } catch (e) { /* found by name instead */ }
    frame.layoutMode = 'VERTICAL';
    frame.primaryAxisSizingMode = 'AUTO';
    frame.counterAxisSizingMode = 'AUTO';
    frame.itemSpacing = 12;
    frame.paddingTop = 24; frame.paddingBottom = 24; frame.paddingLeft = 24; frame.paddingRight = 24;
    frame.cornerRadius = 12;
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    frame.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.92 } }];
    frame.x = left;
    frame.y = bottom === null ? 0 : bottom + 80;

    var title = figma.createText();
    title.fontName = font;
    title.fontSize = 16;
    title.characters = CONTAINER_NAME;
    title.fills = [{ type: 'SOLID', color: { r: 0.11, g: 0.11, b: 0.13 } }];
    frame.appendChild(title);
    return frame;
  }

  /** payload: { url, label, createPage } */
  async function add(payload) {
    payload = payload || {};
    var parsed = parseGoogleUrl(payload.url);
    if (!parsed) {
      throw UK.userError(UK.collapse(payload.url)
        ? 'That isn’t a Google Drive or Google Docs link. It should start with drive.google.com or docs.google.com.'
        : 'Paste a Google Drive or Google Docs link first.');
    }
    var page = findPage();
    if (!page) {
      if (payload.createPage !== true) throw UK.userError('This file has no “' + PAGE_NAME + '” page yet.', 'NO_PAGE');
      page = createPage();
    }

    var existing = await collect(page);
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].url === parsed.url) {
        throw UK.userError('That link is already on the “' + page.name + '” page as “' + existing[i].label + '”.');
      }
    }

    var kind = kindOf(parsed);
    var label = UK.collapse(payload.label) || ('Google ' + kind + ' link');
    var font = await loadAnyFont();
    var container = findContainer(page) || makeContainer(page, font);

    var text = figma.createText();
    try {
      text.fontName = font;
      text.fontSize = 14;
      text.characters = label;
      text.name = label;
      text.fills = [{ type: 'SOLID', color: { r: 9 / 255, g: 80 / 255, b: 135 / 255 } }];
      text.textDecoration = 'UNDERLINE';
      text.setRangeHyperlink(0, label.length, { type: 'URL', value: parsed.url });
      container.appendChild(text);
    } catch (err) {
      try { text.remove(); } catch (e) { /* nothing to clean up */ }
      throw err;
    }

    try { figma.commitUndo(); } catch (e2) { /* older runtimes */ }
    UK.notify('Link added to “' + page.name + '”');
    var result = await scan();
    result.added = { url: parsed.url, label: label };
    return result;
  }

  async function ensurePage() {
    var page = createPage();
    try { figma.commitUndo(); } catch (e) { /* older runtimes */ }
    UK.notify('“' + page.name + '” page is ready');
    return scan();
  }

  /** Opens a link in the browser — only ever a validated Google Drive/Docs URL. */
  function open(payload) {
    var parsed = parseGoogleUrl(payload && payload.url);
    if (!parsed) throw UK.userError('That link isn’t a Google Drive or Google Docs link, so it was not opened.');
    if (typeof figma.openExternal === 'function') {
      figma.openExternal(parsed.url);
      return { opened: true, url: parsed.url };
    }
    return { opened: false, url: parsed.url };   // the interface opens it instead
  }

  /** Jumps to the "For Designers" page, and to a specific link if given. */
  async function goTo(payload) {
    var page = findPage();
    if (!page) throw UK.userError('This file has no “' + PAGE_NAME + '” page yet.', 'NO_PAGE');
    await figma.setCurrentPageAsync(page);
    if (payload && payload.nodeId) {
      var node = await figma.getNodeByIdAsync(payload.nodeId);
      if (node && !node.removed) {
        try {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
        } catch (e) { /* being on the page is enough */ }
      }
    }
    return { ok: true };
  }

  return {
    PAGE_NAME: PAGE_NAME,
    parseGoogleUrl: parseGoogleUrl,
    kindOf: kindOf,
    findPage: findPage,
    scan: scan,
    add: add,
    ensurePage: ensurePage,
    open: open,
    goTo: goTo
  };
})();

// ---- 50-updates.js ----
/*
 * Check for updates — reads version.json from the UtilityKit GitHub repository
 * and compares it with the version that is running.
 *
 * What this can do: tell the designer a newer version exists, show its notes,
 * and open the download page.
 * What it cannot do: install the update. A Figma plugin has no access to the
 * files on the computer, including its own. Updating happens outside Figma
 * (git pull, the update script, or replacing the folder).
 *
 * version.json is remote data, so nothing in it is trusted: the version must
 * look like a version, and links are only used if they point at this repository.
 */
UK.updates = (function () {
  var REPO = 'hiteshramawat01-oss/UtilityKit';
  var BRANCH = 'main';
  var REPO_URL = 'https://github.com/' + REPO;
  var VERSION_URL = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/version.json';
  var DOWNLOAD_URL = REPO_URL + '/archive/refs/heads/' + BRANCH + '.zip';
  var RAW_URL = 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH;
  var CODE_URL = RAW_URL + '/code.js';
  var UI_URL = RAW_URL + '/ui.html';

  /** "1.2.0", "v1.2" -> [1, 2, 0]; anything else -> null */
  function parseVersion(value) {
    var m = /^v?(\d{1,5})\.(\d{1,5})(?:\.(\d{1,5}))?$/.exec(UK.collapse(value));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
  }

  function compare(a, b) {
    for (var i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  }

  /** Only links inside this repository are accepted; anything else falls back. */
  function repoUrl(value, fallback) {
    var v = typeof value === 'string' ? value.trim() : '';
    if (/\s/.test(v)) return fallback;
    if (v === REPO_URL || v.indexOf(REPO_URL + '/') === 0) return v;
    return fallback;
  }

  /** Turns the text of version.json into a result for the interface. */
  function evaluate(text) {
    var data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') {
      throw UK.userError('The version information in the repository couldn’t be read (version.json is not valid).');
    }
    var latest = parseVersion(data.version);
    if (!latest) throw UK.userError('The version information in the repository has no valid version number.');
    var current = parseVersion(UK.VERSION);

    var notes = [];
    if (Array.isArray(data.notes)) {
      for (var i = 0; i < data.notes.length && notes.length < 8; i++) {
        var line = UK.collapse(data.notes[i]).slice(0, 160);
        if (typeof data.notes[i] === 'string' && line) notes.push(line);
      }
    }
    var released = /^\d{4}-\d{2}-\d{2}$/.test(String(data.released)) ? String(data.released) : '';
    var order = compare(latest, current);
    return {
      current: UK.VERSION,
      latest: latest.join('.'),
      updateAvailable: order > 0,
      ahead: order < 0,                      // running something newer than the repository
      notes: order > 0 ? notes : [],
      released: released,
      downloadUrl: repoUrl(data.download, DOWNLOAD_URL),
      pageUrl: repoUrl(data.page, REPO_URL),
      canSelfUpdate: canSelfUpdate()
    };
  }

  /**
   * payload.text: the file's text, when the interface had to fetch it.
   * Returns the result, or { fetchInUi, url } when this side cannot fetch.
   */
  async function check(payload) {
    if (payload && typeof payload.text === 'string') return evaluate(payload.text);
    if (typeof fetch !== 'function') return { fetchInUi: true, url: VERSION_URL };

    var response;
    try {
      response = await fetch(VERSION_URL + '?t=' + Date.now(), { method: 'GET' });
    } catch (err) {
      throw UK.userError('Couldn’t reach GitHub to check for updates. Check your internet connection and try again.');
    }
    if (response.status === 404) {
      throw UK.userError('No version information was found. The repository may be private, or version.json is missing from it.');
    }
    if (!response.ok) {
      throw UK.userError('GitHub answered with an error (' + response.status + '). Try again in a few minutes.');
    }
    return evaluate(await response.text());
  }

  // ---- installing from inside the plugin ----------------------------------

  /** True when an update can be downloaded and switched to without leaving Figma. */
  function canSelfUpdate() {
    return typeof fetch === 'function' && typeof UKLoader === 'object' && !!UKLoader && UKLoader.canRun();
  }

  function installInfo() {
    var info = UKLoader.info();
    return { source: info.source, bundledVersion: info.bundledVersion, note: info.note, canSelfUpdate: canSelfUpdate() };
  }

  async function fetchText(url) {
    var response;
    try {
      response = await fetch(url + '?t=' + Date.now(), { method: 'GET' });
    } catch (err) {
      throw UK.userError('The download from GitHub was interrupted. Check your internet connection and try again.');
    }
    if (!response.ok) throw UK.userError('GitHub couldn\u2019t provide the update files (' + response.status + '). Try again in a few minutes.');
    return response.text();
  }

  /** The version a downloaded file says it is, or ''. Both files must agree with version.json. */
  function versionInCode(code) {
    var m = /var UK = \{ VERSION: '(\d+\.\d+\.\d+)' \}/.exec(code);
    return m ? m[1] : '';
  }
  function versionInHtml(html) {
    var m = /<meta name="utilitykit-version" content="(\d+\.\d+\.\d+)">/.exec(html);
    return m ? m[1] : '';
  }

  /**
   * Downloads the latest code.js and ui.html from this repository and saves
   * them as the copy to run. The addresses are fixed; nothing in version.json
   * can point the download anywhere else. Nothing changes until restart().
   */
  async function install() {
    if (!canSelfUpdate()) {
      throw UK.userError('Updates can\u2019t be installed from inside Figma here. Use Download update instead.', 'UNSUPPORTED');
    }
    var latest = await check();
    if (!latest.updateAvailable) return { installed: false, current: UK.VERSION, latest: latest.latest };

    var code = await fetchText(CODE_URL);
    var html = await fetchText(UI_URL);
    if (versionInCode(code) !== latest.latest || versionInHtml(html) !== latest.latest) {
      throw UK.userError('Version ' + latest.latest + ' is still being published on GitHub (its files don\u2019t match yet). Try again in a few minutes.', 'NOT_READY');
    }
    try {
      await UKLoader.save({ version: latest.latest, code: code, html: html });
    } catch (err) {
      throw UK.userError('The update couldn\u2019t be installed: ' + UK.describeError(err).replace(/[.\s]*$/, '') + '. Your current version is unchanged.');
    }
    return { installed: true, version: latest.latest, previous: UK.VERSION };
  }

  /** Switches to whatever the loader now considers current (a saved update, or the folder's copy). */
  function restart() {
    return UKLoader.restart(UK.shutdown).then(function (info) {
      UK.notify('UtilityKit is now on version ' + info.version);
      return { restarted: true, version: info.version };
    });
  }

  /** Forgets the saved update; after restart() the copy in the plugin folder runs again. */
  async function remove() {
    await UKLoader.clear();
    return { removed: true };
  }

  /** Opens the download or repository page — only ever a link inside this repository. */
  function open(payload) {
    var wantsPage = payload && payload.which === 'page';
    var url = repoUrl(payload && payload.url, wantsPage ? REPO_URL : DOWNLOAD_URL);
    if (typeof figma.openExternal === 'function') {
      figma.openExternal(url);
      return { opened: true, url: url };
    }
    return { opened: false, url: url };
  }

  return {
    REPO_URL: REPO_URL,
    VERSION_URL: VERSION_URL,
    DOWNLOAD_URL: DOWNLOAD_URL,
    parseVersion: parseVersion,
    compare: compare,
    evaluate: evaluate,
    check: check,
    open: open,
    canSelfUpdate: canSelfUpdate,
    installInfo: installInfo,
    install: install,
    restart: restart,
    remove: remove,
    versionInCode: versionInCode,
    versionInHtml: versionInHtml
  };
})();

// ---- 90-main.js ----
/*
 * Message router, saved settings and start-up.
 * The interface sends { type, id, payload }; every request gets exactly one
 * { type: 'result', id, ok, data | error } back.
 */
(function () {
  var STORAGE_KEY = 'utilitykit.settings.v1';   // per designer, across files
  var FILE_KEY = 'utilitykit.file.v1';          // per file: client / phase / version
  var FILE_FIELDS = ['client', 'phase', 'version'];
  var SIZE = { width: 360, height: 600, minW: 300, maxW: 560, minH: 440, maxH: 900 };

  function readFileData() {
    try {
      var raw = figma.root.getPluginData(FILE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }

  async function loadSettings() {
    var stored = null;
    try { stored = await figma.clientStorage.getAsync(STORAGE_KEY); } catch (e) { stored = null; }
    stored = stored && typeof stored === 'object' ? stored : {};
    var renamer = stored.renamer && typeof stored.renamer === 'object' ? stored.renamer : {};
    var file = readFileData();
    var merged = {}, key;
    for (key in renamer) { if (Object.prototype.hasOwnProperty.call(renamer, key)) merged[key] = renamer[key]; }
    // A file remembers its own client, phase and version; they win over "last used".
    for (var i = 0; i < FILE_FIELDS.length; i++) {
      if (typeof file[FILE_FIELDS[i]] === 'string') merged[FILE_FIELDS[i]] = file[FILE_FIELDS[i]];
    }
    var flatten = stored.flatten && typeof stored.flatten === 'object' ? stored.flatten : {};
    return {
      renamer: UK.naming.normalize(merged),
      flatten: { scale: UK.flatten.SCALES.indexOf(Number(flatten.scale)) === -1 ? 2 : Number(flatten.scale) },
      fileHasOwn: Object.keys(file).length > 0
    };
  }

  async function saveSettings(payload) {
    payload = payload || {};
    var data = {
      renamer: UK.naming.normalize(payload.renamer),
      flatten: { scale: payload.flatten && UK.flatten.SCALES.indexOf(Number(payload.flatten.scale)) !== -1 ? Number(payload.flatten.scale) : 2 }
    };
    await figma.clientStorage.setAsync(STORAGE_KEY, data);
    return { saved: true };
  }

  /** Remembers client / phase / version inside the file, only when they changed. */
  function saveFileData(settings) {
    try {
      var current = readFileData();
      var next = {}, changed = false;
      for (var i = 0; i < FILE_FIELDS.length; i++) {
        var k = FILE_FIELDS[i];
        next[k] = UK.collapse(settings[k]);
        if (next[k] !== current[k]) changed = true;
      }
      if (changed) figma.root.setPluginData(FILE_KEY, JSON.stringify(next));
    } catch (e) { /* view-only files cannot store it; the rename itself is unaffected */ }
  }

  function selectionInfo() {
    var sel = figma.currentPage.selection;
    var names = [];
    for (var i = 0; i < sel.length && i < 3; i++) names.push(sel[i].name);
    return { count: sel.length, names: names, page: figma.currentPage.name, key: UK.selectionKey(sel) };
  }

  var handlers = {
    'init': async function () {
      // The interface is up and asking for data, so the running copy is good.
      try { await UKLoader.confirm(); } catch (e) { /* confirmed next time */ }
      return {
        version: UK.VERSION,
        install: UK.updates.installInfo(),
        settings: await loadSettings(),
        selection: selectionInfo(),
        fields: UK.naming.FIELD_LABELS,
        resizeWidth: UK.naming.RESIZE_WIDTH,
        scales: UK.flatten.SCALES
      };
    },
    'settings.save': saveSettings,
    /** Puts this designer's saved choices back to the defaults. Files keep their own client / phase / version. */
    'settings.reset': async function () {
      var fresh = { renamer: UK.naming.defaults(), flatten: { scale: 2 } };
      await figma.clientStorage.setAsync(STORAGE_KEY, fresh);
      return fresh;
    },
    'selection.get': function () { return selectionInfo(); },

    'rename.preview': function (payload) { return UK.renamer.preview(payload); },
    'rename.apply': async function (payload) {
      var result = await UK.renamer.apply(payload);
      if (!result.stale) {
        var settings = UK.naming.normalize(payload && payload.settings);
        saveFileData(settings);
        try { await saveSettings({ renamer: settings, flatten: payload && payload.flatten }); } catch (e) { /* not fatal */ }
      }
      return result;
    },

    'flatten.summary': function (payload) { return UK.flatten.summary(payload); },
    'flatten.run': function (payload) { return UK.flatten.run(payload); },

    'drive.scan': function () { return UK.drive.scan(); },
    'drive.add': function (payload) { return UK.drive.add(payload); },
    'drive.createPage': function () { return UK.drive.ensurePage(); },
    'drive.open': function (payload) { return UK.drive.open(payload); },
    'drive.goto': function (payload) { return UK.drive.goTo(payload); },

    'update.check': function (payload) { return UK.updates.check(payload); },
    'update.open': function (payload) { return UK.updates.open(payload); },
    'update.install': function () { return UK.updates.install(); },
    'update.restart': function () { return UK.updates.restart(); },
    'update.remove': function () { return UK.updates.remove(); },

    'canvas.show': async function (payload) {
      var ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
      var nodes = [];
      for (var i = 0; i < ids.length; i++) {
        var n = await figma.getNodeByIdAsync(ids[i]);
        if (n && !n.removed) nodes.push(n);
      }
      if (!nodes.length) throw UK.userError('Those layers are no longer on the canvas.');
      figma.viewport.scrollAndZoomIntoView(nodes);
      return { shown: nodes.length };
    },

    'ui.resize': function (payload) {
      var w = Math.round(Math.min(SIZE.maxW, Math.max(SIZE.minW, Number(payload && payload.width) || SIZE.width)));
      var h = Math.round(Math.min(SIZE.maxH, Math.max(SIZE.minH, Number(payload && payload.height) || SIZE.height)));
      figma.ui.resize(w, h);
      return { width: w, height: h };
    },

    'notify': function (payload) {
      UK.notify(UK.collapse(payload && payload.message).slice(0, 140), payload && payload.error === true);
      return { ok: true };
    },

    'close': function () { figma.closePlugin(); return { ok: true }; }
  };

  /** Runs one request and always resolves to a result message. */
  UK.dispatch = async function (msg) {
    var id = msg && msg.id;
    var type = msg && msg.type;
    try {
      if (!type || !Object.prototype.hasOwnProperty.call(handlers, type)) {
        throw new Error('Unknown request: ' + type);
      }
      var data = await handlers[type](msg.payload);
      return { type: 'result', id: id, ok: true, data: data };
    } catch (err) {
      if (!(err && err.userFacing)) {
        try { console.error('[UtilityKit]', type, err); } catch (e) { /* no console */ }
      }
      return {
        type: 'result', id: id, ok: false,
        error: { message: UK.describeError(err), code: err && err.code ? err.code : '', userFacing: !!(err && err.userFacing) }
      };
    }
  };

  UK.handlers = handlers;
  UK.selectionInfo = selectionInfo;

  var pushSelection = function () { UK.emit('selection', selectionInfo()); };
  var running = false;

  UK.boot = function () {
    figma.showUI(__html__, { width: SIZE.width, height: SIZE.height, themeColors: true, title: 'UtilityKit' });
    running = true;
    UK._post = function (message) { if (running) figma.ui.postMessage(message); };
    figma.ui.onmessage = function (msg) {
      UK.dispatch(msg).then(function (response) { if (running) figma.ui.postMessage(response); });
    };
    figma.on('selectionchange', pushSelection);
    figma.on('currentpagechange', pushSelection);
  };

  /** Detaches this copy from Figma so another copy can take over (used when an update restarts the plugin). */
  UK.shutdown = function () {
    running = false;
    try { figma.off('selectionchange', pushSelection); } catch (e) { /* not listening */ }
    try { figma.off('currentpagechange', pushSelection); } catch (e2) { /* not listening */ }
    UK._post = null;
  };

  // Start-up.
  if (typeof __UK_DOWNLOADED__ !== 'undefined' && __UK_DOWNLOADED__ === true) {
    UK.boot();                                 // this is a saved update, started by the loader
  } else if (typeof __UK_HEADLESS__ === 'undefined') {
    // Let the loader choose: a newer saved update if there is one, otherwise this copy.
    // (Tests define __UK_HEADLESS__ and drive UK.dispatch and UKLoader themselves.)
    UKLoader.start(function () { UK.boot(); }).catch(function () { UK.boot(); });
  }
})();
