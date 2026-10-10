/*
 * A small stand-in for the Figma Plugin API, enough to exercise UtilityKit's
 * logic outside Figma. Works in Node (tests) and in a browser (UI harness).
 * It models: pages, frames/groups/rectangles/text, selection, plugin data,
 * clone/remove, export, image fills, hyperlinks, client storage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createMockFigma = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return function createMockFigma() {
    var seq = 100;
    var byId = {};
    var log = { notifications: [], opened: [], exports: [], undo: 0, uiSize: null, closed: false };
    var storage = {};
    var listeners = {};

    function absOrigin(node) {
      // A layer inside a group is positioned relative to the nearest non-group container.
      var x = node.x || 0, y = node.y || 0, n = node.parent;
      while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') {
        if (n.type !== 'GROUP') { x += n.x || 0; y += n.y || 0; }
        n = n.parent;
      }
      return { x: x, y: y };
    }

    function make(type, props) {
      props = props || {};
      var name = props.name !== undefined ? props.name : type;
      var node = {
        id: (seq++) + ':1',
        type: type,
        visible: props.visible !== false,
        removed: false,
        parent: null,
        x: props.x || 0,
        y: props.y || 0,
        width: props.width !== undefined ? props.width : 100,
        height: props.height !== undefined ? props.height : 100,
        fills: [],
        _pd: {},
        _flags: props.flags || {}
      };
      byId[node.id] = node;

      Object.defineProperty(node, 'name', {
        enumerable: true,
        get: function () { return name; },
        set: function (v) {
          if (node._flags.failRename) throw new Error('in set_name: Cannot rename this layer');
          name = String(v);
        }
      });
      node.getPluginData = function (k) { return node._pd[k] || ''; };
      node.setPluginData = function (k, v) { node._pd[k] = String(v); };

      Object.defineProperty(node, 'absoluteTransform', { get: function () { var o = absOrigin(node); return [[1, 0, o.x], [0, 1, o.y]]; } });
      Object.defineProperty(node, 'absoluteBoundingBox', {
        configurable: true,
        get: function () {
          if (node.type === 'PAGE') return null;
          var o = absOrigin(node);
          return { x: o.x, y: o.y, width: node.width, height: node.height };
        }
      });
      Object.defineProperty(node, 'absoluteRenderBounds', {
        configurable: true,
        get: function () {
          if (!node.visible || node._flags.noBounds) return null;
          var o = absOrigin(node);
          var pad = node._flags.shadow || 0;
          return { x: o.x - pad, y: o.y - pad, width: node.width + pad * 2, height: node.height + pad * 2 };
        }
      });
      Object.defineProperty(node, 'relativeTransform', {
        get: function () { return [[1, 0, node.x], [0, 1, node.y]]; },
        set: function (t) { node.x = t[0][2]; node.y = t[1][2]; }
      });

      if (type !== 'PAGE' && type !== 'SLICE_NOEXPORT') {
        node.exportAsync = function (settings) {
          if (node._flags.failExport) return Promise.reject(new Error('in exportAsync: Failed to export node'));
          var scale = settings && settings.constraint ? settings.constraint.value : 1;
          var b = node.absoluteRenderBounds || node.absoluteBoundingBox;
          var record = {
            nodeId: node.id, name: node.name, scale: scale,
            pxWidth: Math.ceil(b.width * scale), pxHeight: Math.ceil(b.height * scale),
            contents: describe(node)
          };
          log.exports.push(record);
          var bytes = new Uint8Array([1, 2, 3]);
          bytes._record = record;
          return Promise.resolve(bytes);
        };
      }
      if (!node._flags.noResize && type !== 'PAGE') {
        node.resize = function (w, h) {
          if (node._flags.failResize) throw new Error('in resize: Cannot resize a layer inside an instance');
          node.width = w; node.height = h;
        };
        node.rescale = function (f) {
          if (node._flags.failResize) throw new Error('in rescale: Cannot resize a layer inside an instance');
          node.width = node.width * f; node.height = node.height * f; node._rescaled = f;
        };
      }
      node.remove = function () {
        if (node._flags.failRemove) throw new Error('in remove: Removing this node is not allowed');
        if (node.parent) {
          var i = node.parent.children.indexOf(node);
          if (i !== -1) node.parent.children.splice(i, 1);
        }
        node.parent = null;
        node.removed = true;
        if (figma.currentPage) figma.currentPage.selection = figma.currentPage.selection.filter(function (n) { return n !== node; });
      };
      node.clone = function () {
        if (node._flags.failClone) throw new Error('in clone: Cannot copy this layer');
        var copy = cloneTree(node);
        figma.currentPage.appendChild(copy);
        return copy;
      };

      if (type === 'PAGE' || type === 'FRAME' || type === 'GROUP' || type === 'COMPONENT' || type === 'INSTANCE' || type === 'SECTION') {
        node.children = [];
        node.clipsContent = type === 'FRAME';
        node.insertChild = function (index, child) {
          if (node._flags.failInsert) throw new Error('in insertChild: Cannot move node. New parent is an instance');
          var abs = null;
          if (child.parent) {
            var j = child.parent.children.indexOf(child);
            if (j !== -1) child.parent.children.splice(j, 1);
            if (child.parent === node && j < index) index--;
          }
          child.parent = node;
          node.children.splice(Math.max(0, Math.min(index, node.children.length)), 0, child);
          return abs;
        };
        node.appendChild = function (child) { node.insertChild(node.children.length, child); };
        node.findAllWithCriteria = function (criteria) {
          var out = [];
          (function walk(n) {
            (n.children || []).forEach(function (c) {
              if (criteria.types.indexOf(c.type) !== -1) out.push(c);
              walk(c);
            });
          })(node);
          return out;
        };
      }
      if (type === 'COMPONENT') {
        node.createInstance = function () {
          var inst = cloneTree(node);
          inst.type = 'INSTANCE';
          figma.currentPage.appendChild(inst);
          return inst;
        };
      }
      if (type === 'PAGE') {
        node.selection = [];
        node._loaded = props.loaded !== false;
        node.loadAsync = function () { node._loaded = true; return Promise.resolve(); };
        var realFind = node.findAllWithCriteria;
        node.findAllWithCriteria = function (c) {
          if (!node._loaded) throw new Error('Page is not loaded. Call loadAsync() first.');
          return realFind(c);
        };
      }
      if (type === 'TEXT') {
        var chars = props.characters || '';
        var links = (props.links || []).slice();   // [{ start, end, url }]
        Object.defineProperty(node, 'characters', {
          enumerable: true,
          get: function () { return chars; },
          set: function (v) {
            if (!node.fontName) throw new Error('in set_characters: font not loaded');
            chars = String(v);
          }
        });
        node.fontName = props.fontName || null;
        node.setRangeHyperlink = function (start, end, link) { links.push({ start: start, end: end, url: link.value }); };
        node.getStyledTextSegments = function () {
          var segs = [], pos = 0;
          links.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (l) {
            if (l.start > pos) segs.push({ characters: chars.slice(pos, l.start), start: pos, end: l.start, hyperlink: null });
            segs.push({ characters: chars.slice(l.start, l.end), start: l.start, end: l.end, hyperlink: { type: 'URL', value: l.url } });
            pos = l.end;
          });
          if (pos < chars.length) segs.push({ characters: chars.slice(pos), start: pos, end: chars.length, hyperlink: null });
          return segs;
        };
        node._links = links;
      }
      return node;
    }

    function describe(node) {
      var d = { name: node.name, type: node.type, x: node.x, y: node.y };
      if (node.children) d.children = node.children.map(describe);
      return d;
    }

    function cloneTree(node) {
      var copy = make(node.type, {
        name: node.name, x: node.x, y: node.y, width: node.width, height: node.height, visible: node.visible,
        characters: node.type === 'TEXT' ? node.characters : undefined,
        links: node._links, fontName: node.fontName
      });
      copy._pd = JSON.parse(JSON.stringify(node._pd));
      copy._cloneOf = node.id;
      (node.children || []).forEach(function (c) { var cc = cloneTree(c); copy.appendChild(cc); });
      return copy;
    }

    var doc = make('DOCUMENT', { name: 'Document' });
    doc.children = [];
    var imageSeq = 0;

    var figma = {
      root: doc,
      currentPage: null,
      mixed: {},
      viewport: { scrollAndZoomIntoView: function (nodes) { log.zoomed = nodes.map(function (n) { return n.id; }); } },
      ui: {
        postMessage: function (m) { if (figma.ui._sink) figma.ui._sink(m); },
        resize: function (w, h) { log.uiSize = { width: w, height: h }; },
        onmessage: null
      },
      clientStorage: {
        getAsync: function (k) { return Promise.resolve(storage[k] === undefined ? undefined : JSON.parse(storage[k])); },
        setAsync: function (k, v) { storage[k] = JSON.stringify(v); return Promise.resolve(); }
      },
      showUI: function () {},
      on: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
      notify: function (message, opts) { log.notifications.push({ message: message, error: !!(opts && opts.error) }); },
      commitUndo: function () { log.undo++; },
      closePlugin: function () { log.closed = true; },
      openExternal: function (url) { log.opened.push(url); },
      getNodeByIdAsync: function (id) { var n = byId[id]; return Promise.resolve(n && !n.removed ? n : null); },
      setCurrentPageAsync: function (page) { figma.currentPage = page; return Promise.resolve(); },
      loadFontAsync: function (font) {
        if (figma._missingFonts && figma._missingFonts.indexOf(font.family) !== -1) return Promise.reject(new Error('Font not available'));
        return Promise.resolve();
      },
      listAvailableFontsAsync: function () { return Promise.resolve([{ fontName: { family: 'Helvetica', style: 'Regular' } }]); },
      createPage: function () { var p = make('PAGE', { name: 'Page' }); p.parent = doc; doc.children.push(p); return p; },
      createFrame: function () { var f = make('FRAME', { name: 'Frame' }); figma.currentPage.appendChild(f); return f; },
      createRectangle: function () { var r = make('RECTANGLE', { name: 'Rectangle' }); figma.currentPage.appendChild(r); return r; },
      createText: function () { var t = make('TEXT', { name: 'Text', width: 10, height: 10 }); figma.currentPage.appendChild(t); return t; },
      createImage: function (bytes) {
        var rec = bytes && bytes._record;
        if (rec && (rec.pxWidth > 4096 || rec.pxHeight > 4096)) throw new Error('in createImage: Image is too large');
        return { hash: 'img' + (++imageSeq), _record: rec };
      },
      group: function (nodes, parent) {
        var g = make('GROUP', { name: 'Group' });
        parent.appendChild(g);
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(function (n) {
          var b = n.absoluteBoundingBox;
          minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
        });
        nodes.forEach(function (n) { g.appendChild(n); });
        // a group reports the union of its children; moving it moves them
        Object.defineProperty(g, 'x', {
          get: function () { return Math.min.apply(null, g.children.map(function (c) { return c.x; })); },
          set: function (v) { var d = v - g.x; g.children.forEach(function (c) { c.x += d; }); }
        });
        Object.defineProperty(g, 'y', {
          get: function () { return Math.min.apply(null, g.children.map(function (c) { return c.y; })); },
          set: function (v) { var d = v - g.y; g.children.forEach(function (c) { c.y += d; }); }
        });
        Object.defineProperty(g, 'width', { get: function () { return Math.max.apply(null, g.children.map(function (c) { return c.x + c.width; })) - g.x; }, set: function () {} });
        Object.defineProperty(g, 'height', { get: function () { return Math.max.apply(null, g.children.map(function (c) { return c.y + c.height; })) - g.y; }, set: function () {} });
        Object.defineProperty(g, 'absoluteBoundingBox', { get: function () { return { x: g.x, y: g.y, width: g.width, height: g.height }; } });
        Object.defineProperty(g, 'absoluteRenderBounds', { get: function () { return { x: g.x, y: g.y, width: g.width, height: g.height }; } });
        return g;
      }
    };

    figma.currentPage = figma.createPage();
    figma.currentPage.name = 'Page 1';

    return {
      figma: figma,
      log: log,
      storage: storage,
      make: make,
      byId: byId,
      /** Adds a node to a parent (default: current page). */
      add: function (type, props, parent) {
        var n = make(type, props);
        (parent || figma.currentPage).appendChild(n);
        return n;
      },
      select: function (nodes) {
        figma.currentPage.selection = nodes.slice();
        (listeners.selectionchange || []).forEach(function (fn) { fn(); });
      },
      /** Every node currently on a page, depth-first. */
      all: function (page) {
        var out = [];
        (function walk(n) { (n.children || []).forEach(function (c) { out.push(c); walk(c); }); })(page || figma.currentPage);
        return out;
      }
    };
  };
});
