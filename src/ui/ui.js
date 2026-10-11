/*
 * UtilityKit interface. Runs in the plugin iframe: draws the screens and asks
 * the plugin logic (code.js) to do the work. It never changes the document itself.
 */
(function () {
  'use strict';

  var ICONS = {
    back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
    chevron: '<path d="M6 3.5 10.5 8 6 12.5"/>',
    up: '<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>',
    down: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
    arrow: '<path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5"/>',
    check: '<path d="m3.5 8.5 3 3 6-6.5"/>',
    rename: '<path d="m10.6 2.9 2.5 2.5-7.4 7.4-3.1.6.6-3.1 7.4-7.4ZM9.2 4.3l2.5 2.5"/>',
    layers: '<path d="m8 2.5 5.5 2.8L8 8.1 2.5 5.3 8 2.5ZM2.5 8 8 10.8 13.5 8M2.5 10.7 8 13.5l5.5-2.8"/>',
    link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>',
    grid: '<rect x="2.75" y="2.75" width="4" height="4" rx="1"/><rect x="9.25" y="2.75" width="4" height="4" rx="1"/><rect x="2.75" y="9.25" width="4" height="4" rx="1"/><rect x="9.25" y="9.25" width="4" height="4" rx="1"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
    open: '<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    locate: '<circle cx="8" cy="8" r="4"/><path d="M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5"/>',
    info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.3v3.4M8 5.2v.1"/>',
    warn: '<path d="M8 2.6 14 13H2L8 2.6ZM8 6.6v3M8 11.3v.1"/>',
    success: '<circle cx="8" cy="8" r="5.5"/><path d="m5.6 8.2 1.7 1.7 3.1-3.4"/>',
    settings: '<g transform="scale(.6667)" stroke-width="2.25"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 16 16" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function paintIcons(root) {
    var nodes = (root || document).querySelectorAll('i[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].firstChild) nodes[i].innerHTML = svg(nodes[i].getAttribute('data-icon'));
    }
  }

  var $ = function (id) { return document.getElementById(id); };

  /** h('div', { class: 'x', onclick: fn }, child, 'text', ...) */
  function h(tag, attrs) {
    var node = document.createElement(tag);
    var key;
    for (key in (attrs || {})) {
      var v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') node.className = v;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), v);
      else if (key === 'icon') { node.setAttribute('data-icon', v); node.innerHTML = svg(v); }
      else if (key === 'checked' || key === 'disabled' || key === 'value' || key === 'hidden') node[key] = v;
      else node.setAttribute(key, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid === null || kid === undefined || kid === false) continue;
      if (Array.isArray(kid)) { for (var j = 0; j < kid.length; j++) if (kid[j]) node.appendChild(kid[j]); }
      else node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }

  // ── bridge to the plugin logic ──────────────────────────────────────────

  var pending = {};
  var seq = 0;

  function call(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ pluginMessage: { type: type, id: id, payload: payload } }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data && event.data.pluginMessage;
    if (!msg) return;
    if (msg.type === 'result') {
      var p = pending[msg.id];
      if (!p) return;
      delete pending[msg.id];
      if (msg.ok) p.resolve(msg.data);
      else {
        var err = new Error((msg.error && msg.error.message) || 'Something went wrong.');
        err.code = msg.error && msg.error.code;
        p.reject(err);
      }
    } else if (msg.type === 'selection') {
      onSelection(msg.data);
    }
  });

  // ── state ───────────────────────────────────────────────────────────────

  var state = {
    screen: 'home',
    selection: { count: 0, names: [] },
    settings: null,          // renamer settings (shape defined by the plugin logic)
    flatten: { summary: null, result: null, busy: false },
    askingClient: false,
    drive: null,
    driveBusy: false,
    version: '',
    autoPageType: '',        // the page type read from the current Figma page
    versionsAuto: '',        // what the selected frames would get without typing anything
    versionsEdited: false,
    install: null,           // which copy is running: the plugin folder's, or a downloaded update
    installing: false
  };

  var TITLES = { renamer: 'Layer Renamer', flatten: 'Flatten & Merge', drive: 'Google Drive Links', settings: 'Settings' };
  var PARENT = { renamer: 'home', flatten: 'home', drive: 'home' };

  // ── toast / notes ───────────────────────────────────────────────────────

  var toastTimer = null;
  function toast(message, isError) {
    var t = $('toast');
    t.textContent = message;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 4500 : 2200);
  }
  function fail(err) { toast(err && err.message ? err.message : 'Something went wrong.', true); }

  function note(kind, title, lines, extra) {
    var icon = kind === 'success' ? 'success' : kind === 'info' ? 'info' : 'warn';
    var body = h('div', { class: 'note-body' }, title ? h('b', null, title) : null);
    if (lines && lines.length) {
      if (lines.length === 1) body.appendChild(h('span', null, lines[0]));
      else body.appendChild(h('ul', null, lines.map(function (l) { return h('li', null, l); })));
    }
    if (extra) body.appendChild(extra);
    return h('div', { class: 'note ' + kind }, h('i', { icon: icon }), body);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.classList.add('busy');
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.classList.remove('busy');
      if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
    }
  }

  // ── navigation ──────────────────────────────────────────────────────────

  function go(screen) {
    // Settings can be opened from anywhere; remember where to go back to.
    if (screen === 'settings' && state.screen !== 'settings') state.settingsFrom = state.screen;
    state.screen = screen;
    $('app').setAttribute('data-screen', screen);
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].hidden = screens[i].getAttribute('data-screen') !== screen;
    var home = screen === 'home';
    $('back').hidden = home;
    $('brand').hidden = !home;
    $('title').hidden = home;
    $('title').textContent = TITLES[screen] || '';
    $('openSettings').hidden = !home;                       // Settings is reached from Home only
    $('selPill').hidden = home || screen === 'settings';     // the selection only matters inside a utility
    $('toast').hidden = true;
    if (screen === 'settings') { $('stResetConfirm').hidden = true; $('stReset').hidden = false; renderUpdate(); }
    if (screen === 'renamer') enterRenamer();
    if (screen === 'flatten') { state.flatten.result = null; refreshSummary(); }
    if (screen === 'drive') scanDrive();
    var first = document.querySelector('.screen:not([hidden]) .scroll');
    if (first) first.scrollTop = 0;
  }

  function goBack() {
    if (state.screen === 'renamer' && state.askingClient && state.settings.client) { showClientAsk(false); return; }
    if (state.screen === 'settings') { go(state.settingsFrom || 'home'); return; }
    go(PARENT[state.screen] || 'home');
  }

  function renderSelection() {
    var n = state.selection.count;
    $('selText').textContent = n + ' selected';
    $('selPill').classList.toggle('on', n > 0);
  }

  function onSelection(sel) {
    state.selection = sel || { count: 0, names: [] };
    renderSelection();
    if (state.screen === 'renamer') {
      // A typed version belongs to the frames it was typed for.
      state.settings.versions = '';
      state.versionsEdited = false;
      refreshExample();
    } else if (state.screen === 'flatten') {
      var f = state.flatten;
      // keep the "done" message only while its result is still what is selected
      if (f.result && f.result.selectionKey !== state.selection.key) f.result = null;
      refreshSummary();
    }
  }

  // ── Layer Renamer ───────────────────────────────────────────────────────

  var saveTimer = null, exampleTimer = null, exampleSeq = 0;

  function saveSettingsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      call('settings.save', { renamer: state.settings }).catch(function () { /* saving is best-effort */ });
    }, 500);
  }

  function settingsChanged() {
    $('rnResult').hidden = true;
    clearTimeout(exampleTimer);
    exampleTimer = setTimeout(refreshExample, 120);
    saveSettingsSoon();
  }

  function setSeg(container, value) {
    var buttons = container.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-value') === String(value);
      buttons[i].setAttribute('role', 'radio');
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function fillList(id, values) {
    var list = $(id);
    if (!list) { list = h('datalist', { id: id }); document.body.appendChild(list); }
    clear(list);
    (values || []).forEach(function (v) { list.appendChild(h('option', { value: v })); });
  }

  /** Puts the saved choices into the Layer Renamer controls. */
  function renderRenamerOptions() {
    var s = state.settings;
    var marketing = s.mode === 'marketing';
    var modeRadios = document.getElementsByName('rnMode');
    for (var mr = 0; mr < modeRadios.length; mr++) modeRadios[mr].checked = modeRadios[mr].value === s.mode;
    $('rnClientName').textContent = s.client;
    $('rnWeb').hidden = marketing;
    $('rnMarketing').hidden = !marketing;

    $('rnPageType').value = s.pageType || state.autoPageType || '';
    setSeg($('rnPhase'), s.phase);
    $('rnIncludeSize').checked = s.includeSize;
    $('rnDeliverable').value = s.deliverable;
    $('rnTask').value = s.task;
    $('rnVariation').value = s.variation;

    $('rnVersions').value = state.versionsEdited ? s.versions : (state.versionsAuto || '');
  }

  function devicesText(summary, selected) {
    if (!selected) return 'Desktop at 1600 px wide, Mobile at 320 px';
    var bits = [];
    if (summary.desktop) bits.push(summary.desktop + ' Desktop');
    if (summary.mobile) bits.push(summary.mobile + ' Mobile');
    if (summary.otherWidth) bits.push(summary.otherWidth + ' other width (no tag)');
    return bits.join(' · ');
  }

  function refreshExample() {
    if (!state.settings) return;
    var mine = ++exampleSeq;
    call('rename.preview', { settings: state.settings, limit: 1 }).then(function (p) {
      if (mine !== exampleSeq) return;          // a newer request is on its way
      var box = $('rnExample'), name = $('rnExampleName'), from = $('rnExampleFrom');
      var btn = $('rnRenameBtn');
      if (btn.classList.contains('busy')) return;

      // what was read from the page and the selection
      state.autoPageType = p.autoPageType || '';
      var pageInput = $('rnPageType');
      pageInput.placeholder = p.autoPageType || 'Type a page type';
      // Show the page's own name in the box unless the designer typed something else.
      if (!state.settings.pageType && document.activeElement !== pageInput) pageInput.value = state.autoPageType;
      $('rnPageHint').textContent = p.autoPageType
        ? 'Read from this page, “' + p.pageName + '”. Type here to change it.'
        : 'The page “' + p.pageName + '” has no usable name. Type a page type.';
      $('rnDevices').textContent = devicesText(p.summary, p.counts.selected);
      // The Version box shows what the frames would get until the designer types something else.
      state.versionsAuto = p.versionsAuto || '';
      var versionInput = $('rnVersions');
      if (!state.versionsEdited && document.activeElement !== versionInput) versionInput.value = state.versionsAuto;
      var versionsLine = $('rnExampleVersions');
      versionsLine.hidden = !(p.counts.selected > 1 && !p.error);
      if (!versionsLine.hidden) {
        versionsLine.textContent = 'Versions, left to right: ' + p.versionList.join(' \u00b7 ') + (p.versionCount > p.versionList.length ? ' \u2026' : '');
      }

      if (!p.counts.selected) {
        box.classList.add('is-empty');
        name.textContent = 'Select frames on the canvas';
        from.textContent = 'The new name will show here.';
        btn.disabled = true;
        btn.textContent = 'Select frames to rename';
        return;
      }
      if (p.error) {
        box.classList.add('is-empty');
        name.textContent = p.error;
        from.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Rename';
        return;
      }
      var row = p.rows[0];
      var more = p.counts.selected > 1 ? ' · and ' + (p.counts.selected - 1) + ' more' : '';
      box.classList.remove('is-empty');
      name.textContent = row.proposed;
      from.textContent = (row.changed ? 'from “' + row.current + '”' : 'Already named this way') + more;
      var todo = p.counts.willRename;
      btn.disabled = todo === 0;
      btn.textContent = todo === 0 ? 'Already named' : 'Rename ' + plural(p.counts.selected, 'frame');
    }).catch(fail);
  }

  // ---- the client: read from the file, or asked once ----

  var askTimer = null, askSeq = 0;

  /** Opening the Layer Renamer: make sure we know the client before showing anything else. */
  function enterRenamer() {
    $('rnResult').hidden = true;
    if (state.settings.client) { showClientAsk(false); refreshExample(); return; }
    call('client.detect').then(function (res) {
      if (res.client) {
        state.settings.client = res.client;
        showClientAsk(false);
        renderRenamerOptions();
        refreshExample();
      } else {
        showClientAsk(true);
      }
    }).catch(function () { showClientAsk(true); });
  }

  function showClientAsk(show) {
    var changing = show && !!state.settings.client;
    state.askingClient = show;
    $('rnAsk').hidden = !show;
    $('rnForm').hidden = show;
    $('rnActions').hidden = show;
    if (!show) return;
    $('rnAskTitle').textContent = changing ? 'Change the client' : 'Who is this file for?';
    $('rnAskGo').textContent = changing ? 'Save' : 'Continue';
    $('rnAskCancel').hidden = !changing;
    var input = $('rnAskInput');
    input.value = state.settings.client || '';
    updateClientExample();
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  function updateClientExample() {
    var value = $('rnAskInput').value;
    var mine = ++askSeq;
    call('client.example', { client: value }).then(function (res) {
      if (mine !== askSeq) return;
      $('rnAskGo').disabled = !res.compact;
      $('rnAskExample').hidden = !res.compact;
      if (res.compact) {
        // show the client's part of the name in bold
        var at = res.example.indexOf(res.compact);
        var name = clear($('rnAskExampleName'));
        name.appendChild(document.createTextNode(res.example.slice(0, at)));
        name.appendChild(h('b', null, res.compact));
        name.appendChild(document.createTextNode(res.example.slice(at + res.compact.length)));
      }
    }).catch(function () { /* the button simply stays as it was */ });
  }

  function saveClient() {
    var btn = $('rnAskGo');
    if (btn.disabled) return;
    btn.disabled = true;
    call('client.set', { client: $('rnAskInput').value }).then(function (res) {
      state.settings.client = res.client;
      showClientAsk(false);
      renderRenamerOptions();
      refreshExample();
    }).catch(function (err) { btn.disabled = false; fail(err); });
  }

  // ---- renaming ----

  /** One click: rename the selected frames. Undo is ⌘Z / Ctrl+Z. */
  function runRename() {
    var btn = $('rnRenameBtn');
    if (btn.disabled) return;
    setBusy(btn, true, 'Renaming…');
    call('rename.run', { settings: state.settings }).then(function (res) {
      setBusy(btn, false);
      // A typed version is a one-off; go back to showing what the frames have.
      state.settings.versions = '';
      state.versionsEdited = false;
      renderRenamerOptions();
      renderRenameResult(res);
      refreshExample();
    }).catch(function (err) { setBusy(btn, false); refreshExample(); fail(err); });
  }

  function renderRenameResult(res) {
    var box = clear($('rnResult'));
    var message = res.renamed ? 'Renamed ' + plural(res.renamed, 'frame') + '. Undo with ⌘Z / Ctrl+Z.' : 'Nothing needed changing.';
    if (!res.failedCount) toast(message);
    box.hidden = !res.failedCount;
    if (res.failedCount) {
      box.appendChild(note('error', plural(res.failedCount, 'frame') + ' could not be renamed',
        res.failed.map(function (f) { return f.name + ' — ' + f.reason; })));
    }
    if (!box.hidden) box.scrollIntoView({ block: 'nearest' });
  }

  // ── Flatten & Merge ─────────────────────────────────────────────────────

  var summarySeq = 0;

  function refreshSummary() {
    var mine = ++summarySeq;
    call('flatten.summary').then(function (s) {
      if (mine !== summarySeq) return;
      state.flatten.summary = s;
      renderFlatten();
    }).catch(fail);
  }

  function skippedLines(s) {
    var lines = s.skipped.map(function (k) { return k.name + ' — ' + k.reason; });
    if (s.skippedCount > s.skipped.length) lines.push('and ' + (s.skippedCount - s.skipped.length) + ' more');
    return lines;
  }

  function renderFlatten() {
    var f = state.flatten, s = f.summary;
    var card = clear($('flSummary'));
    var merge = $('flMerge');
    var name = s ? s.resultName : '[Print]';
    var r = f.result;
    // Right after a merge the new image is what is selected: show the result, not a second merge.
    var justMade = !!r && r.selectionKey === state.selection.key;
    card.hidden = justMade;

    if (justMade) {
      // nothing to describe until other layers are selected
    } else if (!s || !s.count) {
      card.appendChild(h('div', { class: 'empty' }, h('b', null, 'Nothing selected'),
        h('span', null, 'Select the layers to merge into one image.')));
    } else if (!s.usable) {
      card.appendChild(h('div', { class: 'card-head' }, h('h2', null, 'Selection')));
      card.appendChild(note('warn', 'Nothing here can be merged', skippedLines(s)));
    } else {
      card.appendChild(h('div', { class: 'card-head' }, h('h2', null, 'Selection')));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, 'Layers'), h('span', { class: 'big' }, num(s.usable))));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, 'Image size'), h('span', null, num(s.width) + ' × ' + num(s.height) + ' px')));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, 'Layer name'), h('span', null, name)));
      card.appendChild(h('p', { class: 'card-text' }, 'The image is placed beside your layers. Your layers stay as they are.'));
      if (s.tooLarge) {
        card.appendChild(note('warn', 'Too large to merge', ['Select fewer layers, or a smaller area.']));
      } else if (s.tiles > 1) {
        card.appendChild(note('info', '', ['Figma can’t hold one image larger than ' + num(s.maxImage) + ' px on a side, so this becomes ' +
          s.tiles + ' pieces that fit together exactly, in one group named ' + name + '.']));
      }
      if (s.skippedCount) {
        card.appendChild(note('warn', plural(s.skippedCount, 'layer') + ' will be left out', skippedLines(s)));
      }
    }

    var banner = clear($('flBanner'));
    if (r) {
      var lines = ['It is beside your layers and selected. Your layers were not changed.'];
      if (r.tiled) lines.push('It is in ' + r.tiles + ' pieces that fit together exactly, in one group.');
      if (r.skippedCount) lines.push(plural(r.skippedCount, 'layer') + ' left out.');
      lines.push('Undo with ⌘Z / Ctrl+Z.');
      banner.appendChild(note('success', (r.sourceCount > 1 ? 'Merged ' + plural(r.sourceCount, 'layer') + ' into ' : 'Made ') + r.name, [lines.join(' ')],
        h('button', { class: 'btn small', type: 'button', onclick: function () { call('canvas.show', { ids: r.created }).catch(fail); } }, 'Show on canvas')));
    }

    if (!f.busy) {
      setBusy(merge, false);
      var usable = s && !justMade ? s.usable : 0;
      merge.textContent = usable ? 'Merge into one' : (justMade ? 'Select other layers to merge again' : 'Select layers to merge');
      merge.disabled = !usable || !!s.tooLarge;
    }
  }

  /** One click: merge the selection into one image. Originals are never changed. */
  function runFlatten() {
    var f = state.flatten;
    var btn = $('flMerge');
    if (f.busy || btn.disabled) return;
    f.busy = true;
    f.result = null;
    renderFlatten();
    setBusy(btn, true, 'Merging…');
    call('flatten.run').then(function (res) {
      f.busy = false;
      f.result = res;
      setBusy(btn, false);
      // The new image is selected now; make sure the screen knows before it draws.
      call('selection.get').then(function (sel) {
        state.selection = sel;
        renderSelection();
        refreshSummary();
      }).catch(refreshSummary);
    }).catch(function (err) {
      f.busy = false;
      setBusy(btn, false);
      renderFlatten();
      clear($('flBanner')).appendChild(note('error', 'Couldn’t merge', [err.message]));
    });
  }

  // ── Google Drive Links ──────────────────────────────────────────────────

  function copyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyLink(link) {
    if (copyText(link.url)) toast('Link copied');
    else toast('Couldn’t copy automatically — select the link text and copy it.', true);
  }

  function openLink(link) {
    call('drive.open', { url: link.url }).then(function (res) {
      if (!res.opened) window.open(res.url, '_blank', 'noopener');
    }).catch(fail);
  }

  function scanDrive(announce) {
    state.driveBusy = true;
    renderDrive();
    return call('drive.scan').then(function (d) {
      state.drive = d;
      state.driveBusy = false;
      renderDrive();
      if (announce) toast(d.pageFound ? plural(d.links.length, 'link') + ' found' : 'No “For Designers” page');
    }).catch(function (err) { state.driveBusy = false; renderDrive(); fail(err); });
  }

  function renderDrive() {
    var d = state.drive;
    var status = clear($('drStatus'));
    var list = clear($('drLinks'));
    list.hidden = true;

    if (!d) {
      status.appendChild(h('div', { class: 'empty' }, h('span', null, 'Looking for links…')));
      return;
    }
    var rescan = h('button', { class: 'icon-btn', type: 'button', icon: 'refresh', title: 'Rescan', 'aria-label': 'Rescan the page', disabled: state.driveBusy,
      onclick: function () { scanDrive(true); } });

    if (!d.pageFound) {
      status.appendChild(h('div', { class: 'status' },
        h('div', { class: 'status-text' }, h('b', null, 'No “For Designers” page'), h('small', null, 'This file doesn’t have one yet.')), rescan));
      status.appendChild(h('button', { class: 'btn block', type: 'button', onclick: function (e) {
        setBusy(e.currentTarget, true, 'Creating…');
        call('drive.createPage').then(function (res) { state.drive = res; renderDrive(); toast('Page created'); }).catch(function (err) { renderDrive(); fail(err); });
      } }, 'Create “For Designers” page'));
      $('drAddText').textContent = 'Create page & add link';
      return;
    }

    $('drAddText').textContent = 'Add link';
    var count = d.links.length;
    status.appendChild(h('div', { class: 'status' },
      h('div', { class: 'status-text' },
        h('b', null, count ? plural(count, 'link') + ' found' : 'No Drive links yet'),
        h('small', null, 'On the “' + d.pageName + '” page')),
      d.isCurrentPage ? null : h('button', { class: 'icon-btn', type: 'button', icon: 'locate', title: 'Go to the page', 'aria-label': 'Go to the page',
        onclick: function () { call('drive.goto', {}).then(function () { scanDrive(); }).catch(fail); } }),
      rescan));

    if (!count) {
      status.appendChild(note('info', '', ['No Google Drive or Google Docs hyperlinks were found on this page. Add one below.']));
      return;
    }

    status.appendChild(h('div', { class: 'quick' },
      h('button', { class: 'btn small', type: 'button', onclick: function () { copyLink(d.links[0]); } }, h('i', { icon: 'copy' }), 'Copy first'),
      h('button', { class: 'btn small', type: 'button', onclick: function () { openLink(d.links[0]); } }, h('i', { icon: 'open' }), 'Open first')));

    list.hidden = false;
    d.links.forEach(function (link) {
      list.appendChild(h('div', { class: 'row link-row' },
        h('div', { class: 'link-main' },
          h('div', { class: 'link-top' },
            h('span', { class: 'tag accent' }, link.kind),
            h('span', { class: 'link-label', title: link.label }, link.label),
            link.source === 'text' ? h('span', { class: 'tag', title: 'Found as plain text, not a clickable hyperlink' }, 'Plain text') : null,
            link.count > 1 ? h('span', { class: 'tag', title: 'Appears ' + link.count + ' times on the page' }, '×' + link.count) : null),
          h('div', { class: 'link-url', title: link.url }, link.url.replace(/^https:\/\//, ''))),
        h('div', { class: 'link-btns' },
          h('button', { class: 'icon-btn', type: 'button', icon: 'locate', title: 'Show on canvas', 'aria-label': 'Show ' + link.label + ' on canvas',
            onclick: function () { call('drive.goto', { nodeId: link.nodeId }).then(function () { if (state.drive) { state.drive.isCurrentPage = true; renderDrive(); } }).catch(fail); } }),
          h('button', { class: 'icon-btn', type: 'button', icon: 'copy', title: 'Copy link', 'aria-label': 'Copy ' + link.label, onclick: function () { copyLink(link); } }),
          h('button', { class: 'icon-btn', type: 'button', icon: 'open', title: 'Open in browser', 'aria-label': 'Open ' + link.label, onclick: function () { openLink(link); } }))));
    });
  }

  function addLink() {
    var url = $('drUrl').value, label = $('drLabel').value;
    var errBox = $('drError'), btn = $('drAdd');
    errBox.hidden = true;
    $('drUrl').classList.remove('invalid');
    btn.disabled = true;
    call('drive.add', { url: url, label: label, createPage: !!(state.drive && !state.drive.pageFound) }).then(function (res) {
      btn.disabled = false;
      state.drive = res;
      $('drUrl').value = '';
      $('drLabel').value = '';
      renderDrive();
      toast('Link added');
    }).catch(function (err) {
      btn.disabled = false;
      clear(errBox);
      errBox.appendChild(h('i', { icon: 'warn' }));
      errBox.appendChild(h('div', { class: 'note-body' }, err.message));
      errBox.hidden = false;
      $('drUrl').classList.add('invalid');
    });
  }

  // ── Check for updates ───────────────────────────────────────────────────

  function fetchVersionFile(url) {
    // Only used when the plugin side has no fetch of its own.
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) throw new Error('No version information was found. The repository may be private, or version.json is missing from it.');
      if (!r.ok) throw new Error('GitHub answered with an error (' + r.status + '). Try again in a few minutes.');
      return r.text();
    }, function () {
      throw new Error('Couldn\u2019t reach GitHub to check for updates. Check your internet connection and try again.');
    });
  }

  function checkUpdates(buttonId) {
    var btn = $(buttonId);
    if (state.updateBusy) return;
    state.updateBusy = true;
    btn.disabled = true;
    btn.textContent = 'Checking\u2026';
    var finish = function () { state.updateBusy = false; btn.disabled = false; btn.textContent = 'Check for updates'; };
    call('update.check').then(function (res) {
      if (res && res.fetchInUi) {
        return fetchVersionFile(res.url).then(function (text) { return call('update.check', { text: text }); });
      }
      return res;
    }).then(function (res) {
      finish();
      state.update = res;
      state.updateDismissed = false;
      renderUpdate();
      if (res.updateAvailable) { $('toast').hidden = true; $(state.screen === 'settings' ? 'stUpdBox' : 'updBox').scrollIntoView({ block: 'nearest' }); }
      else if (res.ahead) toast('You\u2019re on v' + res.current + ', newer than the published v' + res.latest + '.');
      else toast('You\u2019re up to date (v' + res.current + ').');
    }).catch(function (err) { finish(); fail(err); });
  }

  function openUpdate(which, url) {
    call('update.open', { which: which, url: url }).then(function (res) {
      if (!res.opened) window.open(res.url, '_blank', 'noopener');
    }).catch(fail);
  }

  function renderUpdate() {
    renderUpdateInto($('updBox'));
    renderUpdateInto($('stUpdBox'));
  }

  function renderUpdateInto(box) {
    clear(box);
    var u = state.update;
    if (!u || !u.updateAvailable || state.updateDismissed) { box.hidden = true; return; }
    var later = h('button', { class: 'btn small', type: 'button', disabled: state.installing, onclick: function () { state.updateDismissed = true; renderUpdate(); } }, 'Later');
    var extra;
    if (u.canSelfUpdate) {
      // This Figma can switch to the new version in place.
      extra = h('div', { class: 'note-body' },
        h('p', null, 'You have v' + u.current + '.' + (u.released ? ' Released ' + u.released + '.' : '')),
        u.notes.length ? h('ul', null, u.notes.map(function (n) { return h('li', null, n); })) : null,
        h('p', null, 'Installs here in a few seconds. Your files and saved settings are not touched.'),
        h('div', { class: 'note-btns' },
          h('button', { class: 'btn small primary' + (state.installing ? ' busy' : ''), type: 'button', disabled: state.installing, 'data-act': 'install', onclick: installUpdate },
            state.installing ? 'Updating…' : 'Update now'),
          later),
        h('button', { class: 'linkish', type: 'button', 'data-act': 'download', onclick: function () { openUpdate('download', u.downloadUrl); } }, 'Get the files instead'));
    } else {
      extra = h('div', { class: 'note-body' },
        h('p', null, 'You have v' + u.current + '.' + (u.released ? ' Released ' + u.released + '.' : '')),
        u.notes.length ? h('ul', null, u.notes.map(function (n) { return h('li', null, n); })) : null,
        h('p', null, 'It can’t be installed from inside Figma here. Run the update script in the plugin folder (or pull the repository), then run UtilityKit again.'),
        h('div', { class: 'note-btns' },
          h('button', { class: 'btn small primary', type: 'button', 'data-act': 'download', onclick: function () { openUpdate('download', u.downloadUrl); } }, 'Download update'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { openUpdate('page', u.pageUrl); } }, 'View on GitHub'),
          later));
    }
    box.appendChild(note('info', 'Version ' + u.latest + ' is available', [], extra));
    box.hidden = false;
  }

  /** Downloads the new version into Figma's plugin storage, then restarts into it. */
  function installUpdate() {
    if (state.installing) return;
    state.installing = true;
    renderUpdate();
    call('update.install').then(function (res) {
      if (!res.installed) {
        state.installing = false;
        state.update = null;
        renderUpdate();
        toast('You’re already up to date (v' + res.current + ').');
        return;
      }
      toast('Updated to v' + res.version + ' — restarting…');
      // The plugin now replaces this whole interface with the new version's.
      call('update.restart').catch(function (err) { state.installing = false; renderUpdate(); fail(err); });
    }).catch(function (err) {
      state.installing = false;
      if (err.code === 'UNSUPPORTED' && state.update) state.update.canSelfUpdate = false;
      renderUpdate();
      fail(err);
    });
  }

  /** Drops the downloaded update and goes back to the copy in the plugin folder. */
  function removeUpdate() {
    var btn = $('stRemove');
    btn.disabled = true;
    call('update.remove').then(function () {
      toast('Going back to v' + state.install.bundledVersion + '…');
      return call('update.restart');
    }).catch(function (err) { btn.disabled = false; fail(err); });
  }

  function renderInstall() {
    var inst = state.install || { source: 'bundled' };
    var downloaded = inst.source === 'downloaded';
    $('stVersion').textContent = 'Installed: v' + state.version;
    $('stSource').hidden = !downloaded;
    $('stRemove').hidden = !downloaded;
    if (downloaded) {
      $('stSource').textContent = 'This version was installed with Update now. The plugin folder still holds v' + inst.bundledVersion + '.';
      $('stRemove').textContent = 'Go back to v' + inst.bundledVersion;
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────

  function resetSettings() {
    var btn = $('stResetYes');
    btn.disabled = true;
    call('settings.reset').then(function (fresh) {
      btn.disabled = false;
      var client = state.settings.client;        // the client belongs to the file, not to these settings
      state.settings = fresh.renamer;
      state.settings.client = client;
      renderRenamerOptions();
      $('stResetConfirm').hidden = true;
      $('stReset').hidden = false;
      toast('Settings reset to defaults');
    }).catch(function (err) { btn.disabled = false; fail(err); });
  }

  // ── wiring ──────────────────────────────────────────────────────────────

  function bind() {
    $('back').addEventListener('click', goBack);
    $('openSettings').addEventListener('click', function () { go('settings'); });
    $('stCheck').addEventListener('click', function () { checkUpdates('stCheck'); });
    $('stRepo').addEventListener('click', function () { openUpdate('page'); });
    $('stReset').addEventListener('click', function () { $('stReset').hidden = true; $('stResetConfirm').hidden = false; });
    $('stResetCancel').addEventListener('click', function () { $('stResetConfirm').hidden = true; $('stReset').hidden = false; });
    $('stResetYes').addEventListener('click', resetSettings);
    $('stRemove').addEventListener('click', removeUpdate);
    var tools = document.querySelectorAll('[data-go]');
    for (var i = 0; i < tools.length; i++) {
      tools[i].addEventListener('click', function (e) { go(e.currentTarget.getAttribute('data-go')); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.screen !== 'home') { e.preventDefault(); goBack(); }
    });

    // renamer
    var seg = function (id, key, cast) {
      $(id).addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        state.settings[key] = cast ? cast(b.getAttribute('data-value')) : b.getAttribute('data-value');
        renderRenamerOptions();
        settingsChanged();
      });
    };
    var modeInputs = document.getElementsByName('rnMode');
    for (var mi = 0; mi < modeInputs.length; mi++) {
      modeInputs[mi].addEventListener('change', function (e) { state.settings.mode = e.target.value; renderRenamerOptions(); settingsChanged(); });
    }
    seg('rnPhase', 'phase');

    // Page type: typing the page's own name (or nothing) means "read it from the page".
    $('rnPageType').addEventListener('input', function (e) {
      var v = e.target.value;
      state.settings.pageType = v.trim() === '' || v === state.autoPageType ? '' : v;
      settingsChanged();
    });
    $('rnPageType').addEventListener('blur', function (e) {
      if (!state.settings.pageType) e.target.value = state.autoPageType || '';
    });
    var typed = { rnDeliverable: 'deliverable', rnTask: 'task', rnVariation: 'variation' };
    Object.keys(typed).forEach(function (id) {
      $(id).addEventListener('input', function (e) { state.settings[typed[id]] = e.target.value; settingsChanged(); });
    });
    var ticks = { rnIncludeSize: 'includeSize' };
    Object.keys(ticks).forEach(function (id) {
      $(id).addEventListener('change', function (e) { state.settings[ticks[id]] = e.target.checked; renderRenamerOptions(); settingsChanged(); });
    });
    // Version: the box shows what the frames would get; typing replaces it.
    $('rnVersions').addEventListener('input', function (e) {
      var v = e.target.value;
      state.versionsEdited = v.trim() !== '' && v !== state.versionsAuto;
      state.settings.versions = state.versionsEdited ? v : '';
      settingsChanged();
    });
    $('rnVersions').addEventListener('blur', function (e) {
      if (!state.versionsEdited) e.target.value = state.versionsAuto || '';
    });
    $('rnRenameBtn').addEventListener('click', runRename);
    $('rnClientChange').addEventListener('click', function () { showClientAsk(true); });
    $('rnAskGo').addEventListener('click', saveClient);
    $('rnAskCancel').addEventListener('click', function () { showClientAsk(false); });
    $('rnAskInput').addEventListener('input', function () { clearTimeout(askTimer); askTimer = setTimeout(updateClientExample, 80); });
    $('rnAskInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveClient(); } });

    // flatten & merge
    $('flMerge').addEventListener('click', runFlatten);

    // drive
    $('drAdd').addEventListener('click', addLink);
    var onEnter = function (e) { if (e.key === 'Enter') { e.preventDefault(); addLink(); } };
    $('drUrl').addEventListener('keydown', onEnter);
    $('drLabel').addEventListener('keydown', onEnter);
    $('drUrl').addEventListener('input', function () { $('drUrl').classList.remove('invalid'); $('drError').hidden = true; });

    // resize grip
    var grip = $('grip'), drag = null, raf = 0;
    grip.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, w: window.innerWidth, h: window.innerHeight };
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var w = drag.w + (e.clientX - drag.x), ht = drag.h + (e.clientY - drag.y);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { call('ui.resize', { width: w, height: ht }).catch(function () {}); });
    });
    var end = function () { drag = null; };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  function start() {
    paintIcons();
    bind();
    renderSelection();
    call('init').then(function (data) {
      state.settings = data.settings.renamer;
      fillList('rnDeliverables', data.naming && data.naming.deliverables);
      fillList('rnVariations', data.naming && data.naming.variations);
      state.selection = data.selection;
      $('version').textContent = 'v' + data.version;
      state.version = data.version;
      state.install = data.install || null;
      renderInstall();
      renderSelection();
      renderRenamerOptions();
      if (state.install && state.install.note) toast(state.install.note, true);
    }).catch(fail);
  }

  start();
})();
