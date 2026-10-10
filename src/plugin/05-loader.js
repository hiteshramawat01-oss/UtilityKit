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
  var BUNDLED = '__UK_VERSION__';          // the version in the plugin folder
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
