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
      pageUrl: repoUrl(data.page, REPO_URL)
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
    open: open
  };
})();
