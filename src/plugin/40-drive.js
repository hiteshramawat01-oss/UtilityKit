/*
 * Google Drive Links — finds the project's Google Drive link on the "For Designers" page.
 *
 * One link per file is all the interface shows: the text link named
 * "GDrive link to folder" (what the plugin writes), or, in a file where nobody
 * has added one that way, the first Drive / Docs link on the page.
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
  var LINK_TEXT = 'GDrive link to folder';     // what every link added from the plugin says on the page
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

  /** The one link to show: the text link named "GDrive link to folder", otherwise the first on the page. */
  function pick(links) {
    var wanted = LINK_TEXT.toLowerCase();
    for (var i = 0; i < links.length; i++) {
      if (UK.collapse(links[i].label).toLowerCase() === wanted) return links[i];
    }
    return links.length ? links[0] : null;
  }

  async function scan() {
    var page = findPage();
    if (!page) return { pageFound: false, pageName: PAGE_NAME, link: null, links: [] };
    var links = await collect(page);
    return {
      pageFound: true,
      pageName: page.name,
      pageId: page.id,
      isCurrentPage: figma.currentPage.id === page.id,
      link: pick(links),
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

  /** payload: { url, createPage }. The link is written on the page as the text "GDrive link to folder". */
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
        throw UK.userError('That link is already on the “' + page.name + '” page.');
      }
    }

    var label = LINK_TEXT;
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
    LINK_TEXT: LINK_TEXT,
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
