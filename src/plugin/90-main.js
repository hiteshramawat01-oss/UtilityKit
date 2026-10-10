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
      return {
        version: UK.VERSION,
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

  UK.boot = function () {
    figma.showUI(__html__, { width: SIZE.width, height: SIZE.height, themeColors: true, title: 'UtilityKit' });
    UK._post = function (message) { figma.ui.postMessage(message); };
    figma.ui.onmessage = function (msg) {
      UK.dispatch(msg).then(function (response) { figma.ui.postMessage(response); });
    };
    var push = function () { UK.emit('selection', selectionInfo()); };
    figma.on('selectionchange', push);
    figma.on('currentpagechange', push);
  };

  // Tests load this file with __UK_HEADLESS__ defined and call UK.dispatch directly.
  if (typeof __UK_HEADLESS__ === 'undefined') UK.boot();
})();
