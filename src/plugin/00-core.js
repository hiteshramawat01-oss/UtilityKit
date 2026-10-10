/*
 * UtilityKit by CT Designers — plugin logic (Figma sandbox).
 *
 * This file is built from src/plugin/*.js by build.js. The sandbox never
 * touches the DOM; it talks to the interface (ui.html) only through messages.
 *
 * Syntax is kept conservative on purpose (no optional chaining, no object
 * spread) because Figma's sandbox is stricter than a browser.
 */
var UK = { VERSION: '__UK_VERSION__' };   // filled in from version.json by build.js

/** An error whose message is safe and useful to show to the designer. */
UK.userError = function (message, code) {
  var e = new Error(message);
  e.userFacing = true;
  if (code) e.code = code;
  return e;
};

UK.collapse = function (value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
};

UK.plural = function (n, one, many) {
  return n + ' ' + (n === 1 ? one : (many || one + 's'));
};

/** Turns anything thrown by Figma into one readable sentence. */
UK.describeError = function (err) {
  if (!err) return 'Something went wrong.';
  var msg = typeof err === 'string' ? err : (err.message || String(err));
  msg = UK.collapse(msg).replace(/^in \w+:\s*/i, '');
  return msg || 'Something went wrong.';
};

/** Pushes an event to the interface. Wired up in boot(); a no-op in tests. */
UK.emit = function (type, data) {
  if (typeof UK._post === 'function') UK._post({ type: type, data: data });
};

/** A short signature of a selection, used to notice when it has changed. */
UK.selectionKey = function (nodes) {
  var ids = [];
  for (var i = 0; i < nodes.length && i < 40; i++) ids.push(nodes[i].id);
  return nodes.length + ':' + ids.join(',');
};

UK.notify = function (message, isError) {
  try {
    figma.notify(message, isError ? { error: true, timeout: 5000 } : { timeout: 3000 });
  } catch (e) { /* notify is a nicety, never a reason to fail */ }
};
