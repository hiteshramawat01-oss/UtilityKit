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
    success: '<circle cx="8" cy="8" r="5.5"/><path d="m5.6 8.2 1.7 1.7 3.1-3.4"/>'
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
    } else if (msg.type === 'progress') {
      onProgress(msg.data);
    }
  });

  // ── state ───────────────────────────────────────────────────────────────

  var state = {
    screen: 'home',
    selection: { count: 0, names: [] },
    settings: null,          // renamer settings (shape defined by the plugin logic)
    fields: { page: 'Page', phase: 'Design Phase', client: 'Client', version: 'Version' },
    flatten: { scale: 2, replace: false, summary: null, result: null, pendingMode: null, busy: false },
    preview: null,
    applied: null,
    previewNotice: '',
    drive: null,
    driveBusy: false
  };

  var TITLES = { renamer: 'Layer Renamer', preview: 'Rename Preview', flatten: 'Flatten & Merge', drive: 'Google Drive Links' };
  var PARENT = { renamer: 'home', flatten: 'home', drive: 'home', preview: 'renamer' };
  var PLACEHOLDERS = { page: 'e.g. Home', phase: 'e.g. Design', client: 'Client name', version: 'e.g. 1' };

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
    state.screen = screen;
    $('app').setAttribute('data-screen', screen);
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].hidden = screens[i].getAttribute('data-screen') !== screen;
    var home = screen === 'home';
    $('back').hidden = home;
    $('brand').hidden = !home;
    $('title').hidden = home;
    $('title').textContent = TITLES[screen] || '';
    $('toast').hidden = true;
    if (screen === 'renamer') refreshExample();
    if (screen === 'flatten') { state.flatten.result = null; state.flatten.pendingMode = null; refreshSummary(); }
    if (screen === 'drive') scanDrive();
    var first = document.querySelector('.screen:not([hidden]) .scroll');
    if (first) first.scrollTop = 0;
  }

  function goBack() {
    if (state.screen === 'flatten' && state.flatten.pendingMode) { state.flatten.pendingMode = null; renderFlatten(); return; }
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
    if (state.screen === 'renamer') refreshExample();
    else if (state.screen === 'preview' && !state.applied) loadPreview(true);
    else if (state.screen === 'flatten') {
      var f = state.flatten;
      f.pendingMode = null;
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
      call('settings.save', { renamer: state.settings, flatten: { scale: state.flatten.scale } }).catch(function () { /* saving is best-effort */ });
    }, 500);
  }

  function settingsChanged() {
    $('rnError').hidden = true;
    clearTimeout(exampleTimer);
    exampleTimer = setTimeout(refreshExample, 120);
    saveSettingsSoon();
  }

  function renderFields() {
    var s = state.settings;
    var wrap = clear($('rnFields'));
    s.order.forEach(function (key, index) {
      var on = !!s.enabled[key];
      var input;
      var extra = null;

      if (key === 'page') {
        input = h('select', { class: 'select', 'aria-label': 'Page name source', disabled: !on, onchange: function (e) {
          s.pageSource = e.target.value; renderFields(); settingsChanged();
        } },
          h('option', { value: 'layer' }, 'Layer name'),
          h('option', { value: 'custom' }, 'Custom text'));
        input.value = s.pageSource;
        if (s.pageSource === 'custom') {
          extra = h('input', { class: 'input field-extra', type: 'text', value: s.page, placeholder: PLACEHOLDERS.page, 'aria-label': 'Page name', maxlength: 120, disabled: !on,
            oninput: function (e) { s.page = e.target.value; settingsChanged(); } });
        }
      } else {
        input = h('input', { class: 'input', type: 'text', value: s[key], placeholder: PLACEHOLDERS[key], 'aria-label': state.fields[key], maxlength: 120, disabled: !on,
          list: key === 'phase' ? 'rnPhases' : null,
          oninput: function (e) { s[key] = e.target.value; settingsChanged(); } });
      }

      var toggle = h('label', { class: 'switch', title: on ? 'Included in the name' : 'Left out of the name' },
        h('input', { type: 'checkbox', checked: on, 'aria-label': 'Include ' + state.fields[key], onchange: function (e) {
          s.enabled[key] = e.target.checked; renderFields(); settingsChanged();
        } }), h('span'));

      var move = h('span', { class: 'move' },
        h('button', { class: 'icon-btn', type: 'button', icon: 'up', title: 'Move earlier', 'aria-label': 'Move ' + state.fields[key] + ' earlier', disabled: index === 0,
          onclick: function () { swap(index, index - 1); } }),
        h('button', { class: 'icon-btn', type: 'button', icon: 'down', title: 'Move later', 'aria-label': 'Move ' + state.fields[key] + ' later', disabled: index === s.order.length - 1,
          onclick: function () { swap(index, index + 1); } }));

      wrap.appendChild(h('div', { class: 'field' + (on ? '' : ' off'), 'data-key': key },
        toggle, h('span', { class: 'field-label' }, state.fields[key]), input, move, extra));
    });
    if (!$('rnPhases')) {
      document.body.appendChild(h('datalist', { id: 'rnPhases' },
        ['Wireframe', 'Design', 'Revision', 'Final'].map(function (v) { return h('option', { value: v }); })));
    }
  }

  function swap(a, b) {
    var order = state.settings.order;
    var t = order[a]; order[a] = order[b]; order[b] = t;
    renderFields();
    settingsChanged();
  }

  function setSeg(container, value) {
    var buttons = container.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-value') === String(value);
      buttons[i].setAttribute('role', 'radio');
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function renderRenamerOptions() {
    var s = state.settings;
    $('rnCapitalize').checked = s.capitalize;
    $('rnStripDate').checked = s.stripDate;
    $('rnVersionPrefix').checked = s.versionPrefix;
    $('rnNumber').checked = s.numberDuplicates;
    $('rnResize').checked = s.resize;
    $('rnResizeModes').hidden = !s.resize;
    setSeg($('rnSeparator'), s.separator);
    var radios = document.getElementsByName('rnResizeMode');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.resizeMode;
    if (s.resize) $('rnAdvanced').open = true;
  }

  function refreshExample() {
    if (!state.settings) return;
    var mine = ++exampleSeq;
    call('rename.preview', { settings: state.settings, limit: 1 }).then(function (p) {
      if (mine !== exampleSeq) return;          // a newer request is on its way
      var box = $('rnExample'), name = $('rnExampleName'), from = $('rnExampleFrom');
      var btn = $('rnPreviewBtn');
      if (p.error) {
        box.classList.add('is-empty');
        name.textContent = 'Add at least one field';
        from.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Preview changes';
        return;
      }
      if (!p.counts.selected) {
        box.classList.add('is-empty');
        name.textContent = 'Select layers on the canvas';
        from.textContent = 'The new name will show here as you type.';
        btn.disabled = true;
        btn.textContent = 'Select layers to rename';
        return;
      }
      var row = p.rows[0];
      box.classList.remove('is-empty');
      name.textContent = row.proposed;
      from.textContent = row.changed ? 'from “' + row.current + '”' : 'Already named this way';
      btn.disabled = false;
      btn.textContent = 'Preview ' + plural(p.counts.selected, 'layer');
    }).catch(fail);
  }

  function loadPreview(silent) {
    return call('rename.preview', { settings: state.settings }).then(function (p) {
      if (p.error) { showRenamerError(p.error); if (state.screen === 'preview') go('renamer'); return; }
      if (!p.counts.selected) {
        if (state.screen === 'preview') { go('renamer'); toast('Selection cleared — select layers to rename.'); }
        else showRenamerError('Select at least one layer on the canvas to rename.');
        return;
      }
      state.preview = p;
      state.applied = null;
      state.previewNotice = silent ? 'Selection changed — the preview was updated.' : '';
      if (state.screen !== 'preview') go('preview');
      renderPreview();
    }).catch(fail);
  }

  function showRenamerError(message) {
    var box = clear($('rnError'));
    box.appendChild(h('i', { icon: 'warn' }));
    box.appendChild(h('div', { class: 'note-body' }, message));
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  function renderPreview() {
    var p = state.preview, done = state.applied;
    if (!p) return;
    $('pvSelected').textContent = num(p.counts.selected);
    $('pvRename').textContent = num(done ? done.renamed : p.counts.willRename);
    $('pvRenameLabel').textContent = done ? 'Renamed' : 'Will rename';
    $('pvUnchanged').textContent = num(done ? done.unchanged + done.failedCount : p.counts.unchanged);

    var banner = clear($('pvBanner'));
    if (done) {
      var bits = [];
      if (done.renamed) bits.push('Renamed ' + plural(done.renamed, 'layer') + '.');
      else bits.push('No names needed changing.');
      if (done.resizeRequested) bits.push('Resized ' + plural(done.resized, 'layer') + ' to 1600 px wide.');
      bits.push('Undo with ⌘Z / Ctrl+Z.');
      banner.appendChild(note('success', 'Done', [bits.join(' ')]));
      if (done.failedCount) {
        banner.appendChild(note('error', plural(done.failedCount, 'layer') + ' could not be renamed',
          done.failed.map(function (f) { return f.name + ' — ' + f.reason; })));
      }
      if (done.resizeSkippedCount) {
        banner.appendChild(note('warn', plural(done.resizeSkippedCount, 'layer') + ' kept their size',
          done.resizeSkipped.map(function (f) { return f.name + ' — ' + f.reason; })));
      }
    } else {
      if (state.previewNotice) banner.appendChild(note('info', '', [state.previewNotice]));
      if (p.resize) {
        banner.appendChild(note(p.counts.resizeSkipped ? 'warn' : 'info', '',
          [plural(p.counts.willResize, 'layer') + ' will be resized to 1600 px wide' +
            (p.counts.resizeSkipped ? '; ' + p.counts.resizeSkipped + ' can’t be resized.' : '.')]));
      }
      if (!p.counts.willRename && !(p.resize && p.counts.willResize)) {
        banner.appendChild(note('info', 'Nothing to change', ['Every selected layer already has this name.']));
      }
    }
    banner.style.display = banner.firstChild ? 'flex' : 'none';
    banner.style.flexDirection = 'column';
    banner.style.gap = '8px';

    var failedNames = {};
    if (done) done.failed.forEach(function (f) { failedNames[f.name] = true; });

    var list = clear($('pvRows'));
    p.rows.forEach(function (row) {
      var meta = [];
      if (!row.changed) meta.push(h('span', { class: 'tag' }, 'No change'));
      if (!row.changed && row.note && row.note !== 'Already named this way') meta.push(h('span', null, row.note));
      if (row.resize) meta.push(h('span', null, row.resize));
      if (row.resizeNote && p.resize) meta.push(h('span', null, 'Size kept: ' + row.resizeNote));
      var failed = done && row.changed && failedNames[row.current];
      if (failed) meta.push(h('span', { class: 'tag' }, 'Not renamed'));

      if (row.changed) {
        list.appendChild(h('div', { class: 'row changed' + (done && !failed ? ' done' : '') },
          h('div', { class: 'row-old' }, row.current),
          h('div', { class: 'row-new' }, h('i', { icon: done && !failed ? 'check' : 'arrow' }), h('span', null, row.proposed)),
          meta.length ? h('div', { class: 'row-meta' }, meta) : null));
      } else {
        list.appendChild(h('div', { class: 'row same' },
          h('div', { class: 'row-new' }, h('span', null, row.current)),
          h('div', { class: 'row-meta' }, meta)));
      }
    });
    if (p.hiddenRows) list.appendChild(h('div', { class: 'more' }, 'and ' + num(p.hiddenRows) + ' more layers'));

    var apply = $('pvApply'), edit = $('pvEdit');
    setBusy(apply, false);
    if (done) {
      edit.textContent = 'Rename more';
      apply.textContent = 'Done';
      apply.disabled = false;
    } else {
      edit.textContent = 'Edit';
      var nothing = !p.counts.willRename && !(p.resize && p.counts.willResize);
      apply.textContent = p.counts.willRename ? 'Apply to ' + plural(p.counts.willRename, 'layer') : (nothing ? 'Nothing to apply' : 'Apply resize');
      apply.disabled = nothing;
    }
  }

  function applyRename() {
    if (state.applied) { go('home'); return; }
    var p = state.preview;
    if (!p) return;
    var btn = $('pvApply');
    setBusy(btn, true, 'Applying…');
    call('rename.apply', { settings: state.settings, expected: p.expected, flatten: { scale: state.flatten.scale } }).then(function (res) {
      if (res.stale) {
        state.preview = res.preview;
        state.previewNotice = 'Some layers changed after this preview was made, so nothing was renamed. Check the updated names and apply again.';
        renderPreview();
        return;
      }
      state.applied = res;
      state.previewNotice = '';
      renderPreview();
      document.querySelector('[data-screen="preview"] .scroll').scrollTop = 0;
    }).catch(function (err) { setBusy(btn, false); renderPreview(); fail(err); });
  }

  // ── Flatten & Merge ─────────────────────────────────────────────────────

  var summarySeq = 0;

  function refreshSummary() {
    var mine = ++summarySeq;
    call('flatten.summary', { scale: state.flatten.scale }).then(function (s) {
      if (mine !== summarySeq) return;
      state.flatten.summary = s;
      renderFlatten();
    }).catch(fail);
  }

  function renderFlatten() {
    var f = state.flatten, s = f.summary;
    setSeg($('flScale'), f.scale);
    var radios = document.getElementsByName('flOriginals');
    for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === 'replace') === f.replace;

    var card = clear($('flSummary'));
    var each = $('flEach'), merge = $('flMerge');
    if (!f.busy) { setBusy(each, false); setBusy(merge, false); }

    if (!s || !s.count) {
      card.appendChild(h('div', { class: 'empty' }, h('b', null, 'Nothing selected'), h('span', null, 'Select one or more layers on the canvas to flatten.')));
    } else if (!s.usable) {
      card.appendChild(h('div', { class: 'card-head' }, h('h2', null, 'Selection')));
      card.appendChild(note('warn', 'Nothing here can be flattened', s.skipped.map(function (k) { return k.name + ' — ' + k.reason; })));
    } else {
      var m = s.merged;
      card.appendChild(h('div', { class: 'card-head' }, h('h2', null, 'Selection'), h('span', { class: 'hint' }, 'Rendered as PNG')));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, 'Layers'), h('span', { class: 'big' }, num(s.usable))));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, s.usable > 1 ? 'Combined size' : 'Size'), h('span', null, num(m.width) + ' × ' + num(m.height) + ' px')));
      card.appendChild(h('div', { class: 'kv' }, h('span', null, (s.usable > 1 ? 'Merged output' : 'Output') + ' at ' + s.scale + '×'), h('span', null, num(m.pxWidth) + ' × ' + num(m.pxHeight) + ' px')));
      if (m.tooLarge) {
        card.appendChild(note('warn', 'Too large at ' + s.scale + '×', ['Lower the resolution to flatten this selection as one image.']));
      } else if (m.tiles > 1) {
        card.appendChild(note('info', '', ['Figma caps image fills at ' + num(s.maxImage) + ' px, so ' + (s.usable > 1 ? 'the merged image' : 'this') +
          ' will be ' + m.tiles + ' seamless tiles in one group — full quality, nothing downscaled.']));
      }
      if (s.skippedCount) {
        card.appendChild(note('warn', plural(s.skippedCount, 'layer') + ' will be skipped', s.skipped.map(function (k) { return k.name + ' — ' + k.reason; })));
      }
    }

    var banner = clear($('flBanner'));
    var r = f.result;
    if (r) {
      var title = r.mode === 'merge'
        ? 'Merged ' + plural(r.sourceCount, 'layer') + ' into one image'
        : 'Flattened ' + plural(r.createdCount, 'layer');
      var lines = [];
      lines.push(r.replaced ? plural(r.removed, 'original') + ' replaced.' : 'Originals untouched — the result is beside them and selected.');
      if (r.tiled) lines.push('Large output was split into ' + r.tiles + ' seamless tiles and grouped.');
      if (r.keptOriginals) lines.push(plural(r.keptOriginals, 'original') + ' could not be removed (for example inside an instance) and were kept.');
      lines.push('Undo with ⌘Z / Ctrl+Z.');
      banner.appendChild(note('success', title, [lines.join(' ')],
        h('button', { class: 'btn small', type: 'button', onclick: function () { call('canvas.show', { ids: r.created }).catch(fail); } }, 'Show on canvas')));
      if (r.failedCount) banner.appendChild(note('error', plural(r.failedCount, 'layer') + ' failed', r.failed.map(function (k) { return k.name + ' — ' + k.reason; })));
    }

    var usable = s ? s.usable : 0;
    var confirming = !!f.pendingMode;
    $('flActions').hidden = confirming;
    $('flConfirm').hidden = !confirming;
    if (confirming) {
      $('flConfirmText').textContent = 'Replace ' + plural(usable, 'original layer') + ' with ' +
        (f.pendingMode === 'merge' ? 'one merged image' : (usable === 1 ? 'a flattened image' : usable + ' flattened images')) +
        '? The originals are removed once the image exists. You can undo this.';
      $('flConfirmBtn').textContent = 'Replace ' + plural(usable, 'layer');
    }
    if (!f.busy) {
      if (usable <= 1) {
        each.hidden = false; merge.hidden = true;
        each.className = 'btn primary grow';
        each.textContent = usable ? 'Flatten to image' : 'Select layers to flatten';
        each.disabled = !usable || (s.merged && s.merged.tooLarge);
      } else {
        each.hidden = false; merge.hidden = false;
        each.className = 'btn grow';
        each.textContent = 'Flatten each (' + usable + ')';
        each.disabled = false;
        merge.textContent = 'Merge into one';
        merge.disabled = !!(s.merged && s.merged.tooLarge);
      }
    }
  }

  function startFlatten(mode) {
    var f = state.flatten;
    if (f.busy) return;
    if (f.replace) { f.pendingMode = mode; renderFlatten(); return; }
    runFlatten(mode, false);
  }

  function runFlatten(mode, confirmed) {
    var f = state.flatten;
    var btn = mode === 'merge' ? $('flMerge') : $('flEach');
    f.busy = true;
    f.pendingMode = null;
    f.result = null;
    renderFlatten();
    $('flEach').disabled = true; $('flMerge').disabled = true;
    setBusy(btn, true, mode === 'merge' ? 'Merging…' : 'Flattening…');
    call('flatten.run', { mode: mode, scale: f.scale, replace: f.replace, confirmReplace: confirmed === true }).then(function (res) {
      f.busy = false;
      f.result = res;
      setBusy(btn, false);
      refreshSummary();
    }).catch(function (err) {
      f.busy = false;
      setBusy(btn, false);
      renderFlatten();
      clear($('flBanner')).appendChild(note('error', 'Couldn’t flatten', [err.message]));
    });
  }

  function onProgress(p) {
    if (!state.flatten.busy || !p || p.total < 2 || p.done >= p.total) return;
    var btn = document.querySelector('#flActions .btn.busy');
    if (btn) btn.textContent = 'Flattening ' + (p.done + 1) + ' of ' + p.total + '…';
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

  function checkUpdates() {
    var btn = $('updCheck');
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
      if (res.updateAvailable) { $('toast').hidden = true; $('updBox').scrollIntoView({ block: 'nearest' }); }
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
    var box = clear($('updBox'));
    var u = state.update;
    if (!u || !u.updateAvailable || state.updateDismissed) { box.hidden = true; return; }
    var extra = h('div', { class: 'note-body' },
      h('p', null, 'You have v' + u.current + '.' + (u.released ? ' Released ' + u.released + '.' : '')),
      u.notes.length ? h('ul', null, u.notes.map(function (n) { return h('li', null, n); })) : null,
      h('p', null, 'Figma plugins can\u2019t replace their own files, so install it outside Figma: run the update script in the plugin folder (or pull the repository), then run UtilityKit again.'),
      h('div', { class: 'note-btns' },
        h('button', { class: 'btn small primary', type: 'button', onclick: function () { openUpdate('download', u.downloadUrl); } }, 'Download update'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { openUpdate('page', u.pageUrl); } }, 'View on GitHub'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { state.updateDismissed = true; renderUpdate(); } }, 'Later')));
    box.appendChild(note('info', 'Version ' + u.latest + ' is available', [], extra));
    box.hidden = false;
  }

  // ── wiring ──────────────────────────────────────────────────────────────

  function bind() {
    $('back').addEventListener('click', goBack);
    $('updCheck').addEventListener('click', checkUpdates);
    var tools = document.querySelectorAll('[data-go]');
    for (var i = 0; i < tools.length; i++) {
      tools[i].addEventListener('click', function (e) { go(e.currentTarget.getAttribute('data-go')); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.screen !== 'home') { e.preventDefault(); goBack(); }
    });

    // renamer
    var flags = { rnCapitalize: 'capitalize', rnStripDate: 'stripDate', rnVersionPrefix: 'versionPrefix', rnNumber: 'numberDuplicates', rnResize: 'resize' };
    Object.keys(flags).forEach(function (id) {
      $(id).addEventListener('change', function (e) {
        state.settings[flags[id]] = e.target.checked;
        renderRenamerOptions();
        settingsChanged();
      });
    });
    $('rnSeparator').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.settings.separator = b.getAttribute('data-value');
      renderRenamerOptions();
      settingsChanged();
    });
    var modes = document.getElementsByName('rnResizeMode');
    for (var m = 0; m < modes.length; m++) {
      modes[m].addEventListener('change', function (e) { state.settings.resizeMode = e.target.value; settingsChanged(); });
    }
    $('rnPreviewBtn').addEventListener('click', function () { loadPreview(false); });
    $('pvEdit').addEventListener('click', function () { go('renamer'); });
    $('pvApply').addEventListener('click', applyRename);

    // flatten
    $('flScale').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || state.flatten.busy) return;
      state.flatten.scale = Number(b.getAttribute('data-value'));
      state.flatten.pendingMode = null;
      state.flatten.result = null;
      saveSettingsSoon();
      refreshSummary();
    });
    var originals = document.getElementsByName('flOriginals');
    for (var o = 0; o < originals.length; o++) {
      originals[o].addEventListener('change', function (e) {
        state.flatten.replace = e.target.value === 'replace';
        state.flatten.pendingMode = null;
        renderFlatten();
      });
    }
    $('flEach').addEventListener('click', function () { startFlatten('each'); });
    $('flMerge').addEventListener('click', function () { startFlatten('merge'); });
    $('flCancel').addEventListener('click', function () { state.flatten.pendingMode = null; renderFlatten(); });
    $('flConfirmBtn').addEventListener('click', function () { runFlatten(state.flatten.pendingMode, true); });

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
      state.flatten.scale = data.settings.flatten.scale;
      state.fields = data.fields || state.fields;
      state.selection = data.selection;
      $('version').textContent = 'v' + data.version;
      $('rnResizeW').textContent = data.resizeWidth;
      renderSelection();
      renderFields();
      renderRenamerOptions();
    }).catch(fail);
  }

  start();
})();
