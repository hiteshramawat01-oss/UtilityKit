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
  var RESIZABLE = ['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'SECTION'];
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
      versionMode: 'auto',      // 'auto' keep existing + number new | 'next' +1 | 'set' start at versionValue
      versionValue: 1,
      revisionMode: 'keep',     // 'keep' | 'next' +1 | 'none' | 'set' revisionValue
      revisionValue: 1,
      resize: false,
      resizeTarget: 1600,       // 1600 (Desktop) | 320 (Mobile)
      resizeMode: 'scale'       // 'scale' keep aspect ratio | 'width' width only
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
    d.versionMode = oneOf(raw.versionMode, ['auto', 'next', 'set'], d.versionMode);
    d.versionValue = whole(raw.versionValue, 1, 999, d.versionValue);
    d.revisionMode = oneOf(raw.revisionMode, ['keep', 'next', 'none', 'set'], d.revisionMode);
    d.revisionValue = whole(raw.revisionValue, 0, 999, d.revisionValue);
    if (typeof raw.resize === 'boolean') d.resize = raw.resize;
    d.resizeTarget = oneOf(Number(raw.resizeTarget), [1600, 320], d.resizeTarget);
    d.resizeMode = oneOf(raw.resizeMode, ['scale', 'width'], d.resizeMode);
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
    s.versionMode = d.versionMode;
    s.versionValue = d.versionValue;
    s.revisionMode = d.revisionMode;
    s.revisionValue = d.revisionValue;
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

  function versionText(v, r) {
    return 'V' + v + (r > 0 ? 'R' + r : '');
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

  function willResize(settings, item) {
    return settings.mode === 'web' && settings.resize && RESIZABLE.indexOf(item.type) !== -1 && item.width > 0;
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
        var width = willResize(settings, item) ? settings.resizeTarget : item.width;
        device = deviceFor(width);
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

    if (!error) {
      for (var g in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, g)) continue;
        var list = groups[g], used = {}, r, n;

        if (settings.versionMode === 'set') {
          for (n = 0; n < list.length; n++) list[n]._v = settings.versionValue + n;
        } else {
          // First the layers that already carry a version (kept, or moved up by one)…
          for (n = 0; n < list.length; n++) {
            r = list[n];
            if (!r._existing) continue;
            var want = r._existing.v + (settings.versionMode === 'next' ? 1 : 0);
            if (!used[want]) { r._v = want; used[want] = true; }
          }
          // …then everything else takes the next free number, left to right.
          for (n = 0; n < list.length; n++) {
            r = list[n];
            if (r._v) continue;
            r._v = smallestFree(used, 1);
            used[r._v] = true;
          }
        }

        for (n = 0; n < list.length; n++) {
          r = list[n];
          var sameVersion = !!r._existing && r._existing.v === r._v;
          var rev = sameVersion ? r._existing.r : 0;          // a revision belongs to its version
          if (settings.revisionMode === 'set') rev = settings.revisionValue;
          else if (settings.revisionMode === 'none') rev = 0;
          else if (settings.revisionMode === 'next' && sameVersion) rev = rev + 1;
          r.version = versionText(r._v, rev);
          r.proposed = r._before.concat([r.version], r._after).join(SEP);
        }
      }
    }

    var willRename = 0, unchanged = 0;
    for (var k = 0; k < rows.length; k++) {
      var row2 = rows[k];
      if (error) row2.proposed = row2.current;
      row2.changed = row2.proposed !== row2.current;
      if (row2.changed) willRename++; else unchanged++;
      delete row2._before; delete row2._after; delete row2._existing; delete row2._v;
    }

    return {
      error: error,
      settings: settings,
      mode: settings.mode,
      pageName: pageName,
      pageType: pageType,
      autoPageType: autoPageType,
      summary: summary,
      rows: rows,
      counts: { selected: rows.length, willRename: willRename, unchanged: unchanged }
    };
  }

  return {
    PHASES: PHASES,
    DELIVERABLES: DELIVERABLES,
    VARIATIONS: VARIATIONS,
    DEVICES: DEVICES,
    RESIZABLE: RESIZABLE,
    defaults: defaults,
    normalize: normalize,
    persistable: persistable,
    stripLeadingDate: stripLeadingDate,
    compact: compact,
    pageTypeFrom: pageTypeFrom,
    deviceFor: deviceFor,
    sizeFor: sizeFor,
    readVersion: readVersion,
    clientIn: clientIn,
    clientFromNames: clientFromNames,
    validate: validate,
    willResize: willResize,
    plan: plan
  };
})();
