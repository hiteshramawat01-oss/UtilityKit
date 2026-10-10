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
