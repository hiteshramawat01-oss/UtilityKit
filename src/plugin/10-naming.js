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
