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
