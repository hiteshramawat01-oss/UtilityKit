/*
 * Message router, saved settings and start-up.
 * The interface sends { type, id, payload }; every request gets exactly one
 * { type: 'result', id, ok, data | error } back.
 */
(function () {
  var STORAGE_KEY = 'utilitykit.settings.v1';   // per designer, across files
  var FILE_KEY = 'utilitykit.file.v1';          // per file: client and the other project-level naming choices
  var FILE_FIELDS = ['client', 'phase', 'mode'];
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
    // Only what is meant to be remembered is read back, whatever an older version stored (a deliverable, for one).
    var renamer = UK.naming.persistable(stored.renamer && typeof stored.renamer === 'object' ? stored.renamer : {});
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
      // Started by an older UtilityKit's loader (see start-up below): tell it this copy runs fine,
      // or it would throw this version away on the next start.
      if (startedByOldLoader && typeof UKLoader !== 'undefined' && UKLoader && typeof UKLoader.confirm === 'function') {
        try { await UKLoader.confirm(); } catch (e) { /* confirmed next time */ }
      }
      return {
        version: UK.VERSION,
        settings: await loadSettings(),
        selection: selectionInfo(),
        naming: { phases: UK.naming.PHASES, devices: UK.naming.DEVICES }
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

  /**
   * Start-up. UtilityKit does not update itself: a new version reaches people only
   * when the files in their plugin folder are replaced.
   *
   * One older case is kept working. UtilityKit v1.3 to v2.0 could install updates
   * into Figma's plugin storage and run them through a small loader. If one of those
   * copies installed this version, its loader starts this code and passes
   * __UK_DOWNLOADED__ = true and itself (UKLoader). This version has no loader and
   * never downloads anything.
   */
  var OLD_UPDATE_KEY = 'utilitykit.update.v1';
  var startedByOldLoader = typeof __UK_DOWNLOADED__ !== 'undefined' && __UK_DOWNLOADED__ === true;

  /** Running from the plugin folder: a copy saved by the old "Update now" is never used again, so remove it. */
  UK.forgetOldUpdate = async function () {
    try { await figma.clientStorage.deleteAsync(OLD_UPDATE_KEY); } catch (e) { /* nothing saved */ }
  };

  if (startedByOldLoader) {
    UK.boot();
  } else if (typeof __UK_HEADLESS__ === 'undefined') {
    // (Tests define __UK_HEADLESS__ and drive UK.dispatch themselves.)
    UK.boot();
    UK.forgetOldUpdate();
  }
})();
