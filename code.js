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
var UK = { VERSION: '1.7.0' };   // filled in from version.json by build.js

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
  var BUNDLED = '1.7.0';          // the version in the plugin folder
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
 * Implements the team's file naming guideline:
 *
 *   Web:        PageType_Device_DesignPhase_ClientName_V1R1
 *   Marketing:  Size_DeliverableType_SpecificTask_ClientName_V1R1_Variation
 *
 * Parts that don't apply are left out. Every part is written without spaces,
 * dashes or symbols ("All-fit Automotive & Parts" -> "AllfitAutomotiveAndParts").
 * The preview and Apply both use plan(), so they can never disagree.
 */
UK.naming = (function () {
  var PHASES = ['Wireframes', 'Mockups'];
  var DELIVERABLES = ['MetaAds', 'GoogleAds', 'MetaVideoAds', 'EmailBanner', 'EmailTemplate', 'IGCarousel', 'IGReel', 'Infographic'];
  var VARIATIONS = ['A', 'B', 'CMYK', 'RGB', 'Logo', 'Image', 'Alt', 'Transparent'];
  // Frame width decides the device tag (Web only).
  var DEVICES = [{ width: 1600, tag: 'Desktop' }, { width: 320, tag: 'Mobile' }];
  // Short size codes the guideline allows for video deliverables.
  var VIDEO_SIZES = { '1080x1920': 'V', '1920x1080': 'H', '1080x1350': 'P', '1080x1080': 'S' };
  var SEP = '_';

  function defaults() {
    return {
      mode: 'web',              // 'web' | 'marketing'
      pageType: '',             // '' = read it from the Figma page name
      phase: '',                // '' | 'Wireframes' | 'Mockups'
      client: '',
      deliverable: '',
      task: '',
      variation: '',
      includeSize: true,
      versions: ''              // '' = automatic; otherwise what the designer typed: "2", "1r1", "r2", "1, 2, 3"
    };
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }
  function whole(value, min, max, fallback) {
    var n = Math.round(Number(value));
    return isFinite(n) && n >= min && n <= max ? n : fallback;
  }
  function text(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : '';
  }

  /** Accepts anything (older saved data, partial objects) and returns valid settings. */
  function normalize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    d.mode = oneOf(raw.mode, ['web', 'marketing'], d.mode);
    d.pageType = text(raw.pageType);
    d.phase = oneOf(raw.phase, PHASES, '');
    d.client = text(raw.client);
    d.deliverable = text(raw.deliverable);
    d.task = text(raw.task);
    d.variation = text(raw.variation);
    if (typeof raw.includeSize === 'boolean') d.includeSize = raw.includeSize;
    d.versions = text(raw.versions);
    return d;
  }

  /**
   * The settings worth remembering between sessions. One-off choices (version,
   * revision, page override) are not, and neither is the client: a client
   * belongs to a file, so it must never follow the designer into another one.
   */
  function persistable(raw) {
    var s = normalize(raw), d = defaults();
    s.client = d.client;
    s.pageType = d.pageType;
    s.variation = d.variation;
    s.versions = d.versions;
    return s;
  }

  // Leading "YYYY-MM" (optionally "-DD"), plus whatever separator follows it.
  var LEADING_DATE = /^\s*(?:19|20)\d{2}[-_.\/](?:0[1-9]|1[0-2])(?:[-_.\/](?:0[1-9]|[12]\d|3[01]))?(?!\d)\s*(?:[-–—_:|\/,]+\s*)*/;
  function stripLeadingDate(value) {
    return String(value).replace(LEADING_DATE, '');
  }

  var QUOTES = /['"`‘’“”ʼ]/g;
  var INNER_DASH = /([A-Za-z0-9À-῿])[-‐‑]+(?=[A-Za-z0-9À-῿])/g;
  var SYMBOLS = /[\s!-\/:-@\[-`{-~ -¿ -⯿　-〿︀-️\uD800-\uDFFF]/g;
  var ARTICLE = /^(a|an|the)$/i;

  /**
   * Writes text the way the guideline wants a name part: no spaces, dashes or
   * symbols, each word starting with a capital.
   *   "All-fit Automotive & Parts" -> "AllfitAutomotiveAndParts"
   *   "5 tips for sales"           -> "5TipsForSales"
   * Words that already contain capitals (iOS, UCA, eBay) are left as typed.
   */
  function compact(value, dropArticles) {
    var s = String(value === null || value === undefined ? '' : value);
    s = s.replace(/&/g, ' And ').replace(QUOTES, '').replace(INNER_DASH, '$1').replace(SYMBOLS, ' ');
    var words = s.split(' '), out = [];
    for (var i = 0; i < words.length; i++) {
      if (words[i]) out.push(words[i]);
    }
    if (dropArticles && out.length > 1) {
      var kept = [];
      for (var k = 0; k < out.length; k++) { if (!ARTICLE.test(out[k])) kept.push(out[k]); }
      if (kept.length) out = kept;
    }
    for (var j = 0; j < out.length; j++) {
      var w = out[j];
      if (w === w.toLowerCase()) out[j] = w.charAt(0).toUpperCase() + w.slice(1);
    }
    return out.join('');
  }

  /** PageType from a Figma page name: "2026-05 - Home page" -> "HomePage". */
  function pageTypeFrom(pageName) {
    return compact(stripLeadingDate(pageName === null || pageName === undefined ? '' : pageName));
  }

  /** 'Desktop', 'Mobile' or '' for any other width. */
  function deviceFor(width) {
    var w = Math.round(Number(width));
    for (var i = 0; i < DEVICES.length; i++) {
      if (DEVICES[i].width === w) return DEVICES[i].tag;
    }
    return '';
  }

  /** "1080x1080", or the letter code for a video deliverable in a standard video size. */
  function sizeFor(width, height, deliverable) {
    var w = Math.round(Number(width)), h = Math.round(Number(height));
    if (!(w > 0) || !(h > 0)) return '';
    var size = w + 'x' + h;
    if (/video|reel/i.test(deliverable || '') && VIDEO_SIZES[size]) return VIDEO_SIZES[size];
    return size;
  }

  /** Reads "V2R1" out of an existing name: { v: 2, r: 1 }. null when the name has no version. */
  function readVersion(name) {
    var parts = String(name === null || name === undefined ? '' : name).split(SEP);
    for (var i = parts.length - 1; i >= 0; i--) {
      var m = /^V(\d{1,3})(?:R(\d{1,3}))?$/i.exec(parts[i].trim());
      if (m) return { v: Number(m[1]), r: m[2] ? Number(m[2]) : 0 };
    }
    return null;
  }

  /**
   * The client written in a name that already follows the guideline: the part
   * just before the version. "Homepage_Mockups_EstateGuys_V1R2" -> "EstateGuys".
   */
  function clientIn(name) {
    var parts = String(name === null || name === undefined ? '' : name).split(SEP);
    for (var i = parts.length - 1; i >= 2; i--) {
      if (/^V\d{1,3}(?:R\d{1,3})?$/i.test(parts[i].trim())) {
        var candidate = parts[i - 1].trim();
        var isOther = PHASES.indexOf(candidate) !== -1 || candidate === 'Desktop' || candidate === 'Mobile';
        return candidate && !isOther && compact(candidate) === candidate ? candidate : '';
      }
    }
    return '';
  }

  /** The client most of these names agree on, or ''. */
  function clientFromNames(names) {
    var counts = {}, best = '', bestCount = 0;
    for (var i = 0; i < names.length; i++) {
      var c = clientIn(names[i]);
      if (!c) continue;
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > bestCount) { best = c; bestCount = counts[c]; }
    }
    return best;
  }

  /** "V1, V1, V1" -> "V1"; otherwise the list as typed-able text. */
  function collapseVersions(list) {
    if (!list.length) return '';
    for (var i = 1; i < list.length; i++) {
      if (list[i] !== list[0]) return list.join(', ');
    }
    return list[0];
  }

  function versionText(v, r) {
    return 'V' + v + (r > 0 ? 'R' + r : '');
  }

  /**
   * Reads what the designer typed in the Version box.
   *   "2" / "v2"      -> version 2
   *   "1r2" / "V1R2"  -> version 1, revision 2
   *   "r2"            -> keep the frame's version, revision 2
   *   "1, 2, 3"       -> one per frame, left to right
   * Returns { entries: [{ v, r }] } (v or r is null when not given) or { error }.
   */
  function parseVersions(input) {
    var raw = String(input === null || input === undefined ? '' : input).trim();
    if (!raw) return { entries: [] };
    var parts = raw.split(/[,;]/), entries = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].replace(/\s+/g, '');
      if (!part) {
        if (i === parts.length - 1) continue;             // a trailing comma while typing
        return { error: 'There is an empty version in the list. Use for example 1, 2, 3.' };
      }
      var m = /^(?:v?(\d{1,3}))?(?:r(\d{1,3}))?$/i.exec(part);
      if (!m || (m[1] === undefined && m[2] === undefined)) {
        return { error: '\u201c' + parts[i].trim().slice(0, 20) + '\u201d isn\u2019t a version. Use for example 1, 1r2 or r2.' };
      }
      var v = m[1] === undefined ? null : Number(m[1]);
      var r = m[2] === undefined ? null : Number(m[2]);
      if (v === 0) return { error: 'Versions start at 1.' };
      entries.push({ v: v, r: r });
    }
    return { entries: entries };
  }

  /** '' when the settings can produce a name, otherwise what is missing. */
  function validate(settings, pageType) {
    if (settings.mode === 'marketing') {
      if (!compact(settings.deliverable)) return 'Add the deliverable type, for example MetaAds.';
      if (!compact(settings.task, true)) return 'Add the specific task, for example BlackFriday.';
    } else if (!pageType) {
      return 'This page’s name can’t be used as a page type. Type one in.';
    }
    if (!compact(settings.client)) return 'Add the client name.';
    return '';
  }

  function smallestFree(used, from) {
    var n = from;
    while (used[n]) n++;
    return n;
  }

  /**
   * Works out the new name for every layer.
   *   items:   [{ id, name, type, width, height, x, y }]
   *   context: { pageName }  — the Figma page the layers are on
   *
   * Versions: layers that would otherwise get the same name are numbered left
   * to right on the canvas. In 'auto' mode a layer that already has a version
   * keeps it, so re-running (or re-ordering frames) never shuffles versions;
   * layers without one take the next free number.
   */
  function plan(rawSettings, items, context) {
    var settings = normalize(rawSettings);
    var pageName = context && context.pageName ? context.pageName : '';
    var autoPageType = pageTypeFrom(pageName);
    var pageType = compact(settings.pageType) || autoPageType;
    var error = validate(settings, pageType);
    var marketing = settings.mode === 'marketing';
    var client = compact(settings.client);
    var summary = { desktop: 0, mobile: 0, otherWidth: 0 };

    // Left to right, then top to bottom: the order versions are handed out in, and the order shown.
    var order = [];
    for (var i = 0; i < items.length; i++) order.push({ item: items[i], index: i });
    order.sort(function (a, b) {
      var ax = Number(a.item.x) || 0, bx = Number(b.item.x) || 0;
      if (Math.abs(ax - bx) > 0.5) return ax - bx;
      var ay = Number(a.item.y) || 0, by = Number(b.item.y) || 0;
      if (Math.abs(ay - by) > 0.5) return ay - by;
      return a.index - b.index;
    });

    var rows = [], groups = {};
    for (var o = 0; o < order.length; o++) {
      var item = order[o].item;
      var before = [], after = [], note = '';
      var device = '', size = '';
      if (marketing) {
        size = settings.includeSize ? sizeFor(item.width, item.height, compact(settings.deliverable)) : '';
        if (size) before.push(size);
        before.push(compact(settings.deliverable), compact(settings.task, true), client);
        var variation = compact(settings.variation);
        if (variation) after.push(variation);
      } else {
        device = deviceFor(item.width);
        if (device === 'Desktop') summary.desktop++;
        else if (device === 'Mobile') summary.mobile++;
        else {
          summary.otherWidth++;
          note = Math.round(Number(item.width) || 0) + ' px wide — no Desktop / Mobile tag';
        }
        before.push(pageType);
        if (device) before.push(device);
        if (settings.phase) before.push(settings.phase);
        before.push(client);
      }
      var row = {
        id: item.id, current: item.name, proposed: item.name, changed: false, note: note,
        device: device, size: size, version: '',
        _before: before, _after: after, _existing: readVersion(item.name)
      };
      rows.push(row);
      var key = before.join(SEP) + '|' + after.join(SEP);
      (groups[key] = groups[key] || []).push(row);
    }

    // 1. What each layer would get on its own: a layer that already has a version keeps
    //    it (and its revision); the others take the next free number, left to right.
    for (var g in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, g)) continue;
      var list = groups[g], used = {}, r, n;
      for (n = 0; n < list.length; n++) {
        r = list[n];
        if (r._existing && !used[r._existing.v]) { r._v = r._existing.v; r._r = r._existing.r; used[r._v] = true; }
      }
      for (n = 0; n < list.length; n++) {
        r = list[n];
        if (r._v) continue;
        r._v = smallestFree(used, 1);
        r._r = 0;
        used[r._v] = true;
      }
    }
    var autoList = [];
    for (var a = 0; a < rows.length; a++) autoList.push(versionText(rows[a]._v, rows[a]._r));

    // 2. What the designer typed in the Version box replaces that: one value for
    //    every layer, or one value per layer in the same left-to-right order.
    var typed = parseVersions(settings.versions);
    var versionError = typed.error || '';
    if (!versionError && typed.entries.length > 1 && rows.length && typed.entries.length !== rows.length) {
      versionError = rows.length + (rows.length === 1 ? ' frame' : ' frames') + ' selected, ' + typed.entries.length + ' versions typed. Type one version, or one for each frame.';
    }
    if (!versionError && typed.entries.length) {
      for (var t = 0; t < rows.length; t++) {
        var entry = typed.entries.length === 1 ? typed.entries[0] : typed.entries[t];
        if (entry.v !== null) { rows[t]._v = entry.v; rows[t]._r = entry.r === null ? 0 : entry.r; }
        else rows[t]._r = entry.r;                        // "r2": keep the version, set the revision
      }
    }
    if (!error && versionError) error = versionError;

    var versionList = [];
    for (var q = 0; q < rows.length; q++) {
      var row3 = rows[q];
      row3.version = versionText(row3._v, row3._r);
      versionList.push(row3.version);
      if (!error) row3.proposed = row3._before.concat([row3.version], row3._after).join(SEP);
    }

    var willRename = 0, unchanged = 0;
    for (var k = 0; k < rows.length; k++) {
      var row2 = rows[k];
      if (error) row2.proposed = row2.current;
      row2.changed = row2.proposed !== row2.current;
      if (row2.changed) willRename++; else unchanged++;
      delete row2._before; delete row2._after; delete row2._existing; delete row2._v; delete row2._r;
    }

    return {
      error: error,
      settings: settings,
      mode: settings.mode,
      pageName: pageName,
      pageType: pageType,
      autoPageType: autoPageType,
      summary: summary,
      versionsAuto: collapseVersions(autoList),     // what the Version box shows until the designer types
      versionList: versionList,
      rows: rows,
      counts: { selected: rows.length, willRename: willRename, unchanged: unchanged }
    };
  }

  return {
    PHASES: PHASES,
    DELIVERABLES: DELIVERABLES,
    VARIATIONS: VARIATIONS,
    DEVICES: DEVICES,
    defaults: defaults,
    normalize: normalize,
    persistable: persistable,
    stripLeadingDate: stripLeadingDate,
    compact: compact,
    pageTypeFrom: pageTypeFrom,
    deviceFor: deviceFor,
    sizeFor: sizeFor,
    readVersion: readVersion,
    parseVersions: parseVersions,
    clientIn: clientIn,
    clientFromNames: clientFromNames,
    validate: validate,
    plan: plan
  };
})();

// ---- 20-renamer.js ----
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

// ---- 30-flatten.js ----
/*
 * Flatten & Merge — turns the selected layers into one image named "[Print]",
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
  var RESULT_NAME = '[Print]';
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

  /** Merges the selected layers into one image named "[Print]" that takes their place. */
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
  var FILE_KEY = 'utilitykit.file.v1';          // per file: client and the other project-level naming choices
  var FILE_FIELDS = ['client', 'phase', 'mode', 'deliverable', 'task'];
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
    // A file remembers its own client and project choices; they win over "last used".
    for (var i = 0; i < FILE_FIELDS.length; i++) {
      if (typeof file[FILE_FIELDS[i]] === 'string') merged[FILE_FIELDS[i]] = file[FILE_FIELDS[i]];
    }
    // The client only ever comes from this file: saved in it, or read off frames already named in it.
    var clientSource = '';
    if (typeof file.client === 'string' && UK.naming.compact(file.client)) {
      clientSource = 'file';
    } else {
      merged.client = UK.renamer.detectClient();
      if (merged.client) clientSource = 'frames';
    }
    return {
      clientSource: clientSource,
      renamer: UK.naming.normalize(merged),
      fileHasOwn: Object.keys(file).length > 0
    };
  }

  async function saveSettings(payload) {
    payload = payload || {};
    var data = { renamer: UK.naming.persistable(payload.renamer) };
    await figma.clientStorage.setAsync(STORAGE_KEY, data);
    return { saved: true };
  }

  /** Remembers the client and project-level naming choices inside the file, only when they changed. */
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
        naming: { phases: UK.naming.PHASES, deliverables: UK.naming.DELIVERABLES, variations: UK.naming.VARIATIONS, devices: UK.naming.DEVICES }
      };
    },
    'settings.save': saveSettings,
    /** Puts this designer's saved choices back to the defaults. Files keep their own client and project choices. */
    'settings.reset': async function () {
      var fresh = { renamer: UK.naming.defaults() };
      await figma.clientStorage.setAsync(STORAGE_KEY, fresh);
      return fresh;
    },
    'selection.get': function () { return selectionInfo(); },

    'rename.preview': function (payload) { return UK.renamer.preview(payload); },
    /** One click: rename the selection, then remember the project choices in the file. */
    'rename.run': async function (payload) {
      var result = await UK.renamer.run(payload);
      if (!result.stale) {
        var settings = UK.naming.normalize(payload && payload.settings);
        saveFileData(settings);
        try { await saveSettings({ renamer: settings }); } catch (e) { /* not fatal */ }
      }
      return result;
    },

    /** The client for this file, if the file can tell us. */
    'client.detect': function () {
      var file = readFileData();
      if (typeof file.client === 'string' && UK.naming.compact(file.client)) return { client: file.client, source: 'file' };
      var found = UK.renamer.detectClient();
      return { client: found, source: found ? 'frames' : '' };
    },
    'client.example': function (payload) { return UK.renamer.clientExample(payload); },
    /** Saves the client in the file so nobody working on it is asked again. */
    'client.set': function (payload) {
      var client = UK.collapse(payload && payload.client).slice(0, 120);
      if (!UK.naming.compact(client)) throw UK.userError('Type the client\u2019s name.');
      var saved = false;
      try {
        var data = readFileData();
        data.client = client;
        figma.root.setPluginData(FILE_KEY, JSON.stringify(data));
        saved = true;
      } catch (e) { saved = false; }   // view-only files: use it for this session anyway
      return { client: client, saved: saved };
    },
    'rename.apply': async function (payload) {
      var result = await UK.renamer.apply(payload);
      if (!result.stale) {
        var settings = UK.naming.normalize(payload && payload.settings);
        saveFileData(settings);
        try { await saveSettings({ renamer: settings }); } catch (e) { /* not fatal */ }
      }
      return result;
    },

    'flatten.summary': function () { return UK.flatten.summary(); },
    'flatten.run': function () { return UK.flatten.run(); },

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
