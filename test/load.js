/* Loads the built code.js against a mock Figma and returns { UK, env }. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const createMockFigma = require('./mock-figma.js');

module.exports = function load(options) {
  const env = createMockFigma();
  if (options && options.storage) Object.assign(env.storage, options.storage);   // carry plugin storage into a new "launch"
  const sandbox = { figma: env.figma, console, __UK_HEADLESS__: true, __html__: 'BUNDLED-UI' };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
  vm.runInContext(code + '\n;this.UK = UK; this.UKLoader = UKLoader;', sandbox, { filename: 'code.js' });
  const UK = sandbox.UK;
  const events = [];
  UK._post = (m) => events.push(m);
  /** Sends a request exactly the way the interface does. */
  const call = async (type, payload) => {
    const res = await UK.dispatch({ type, id: 1, payload });
    // round-trip through JSON: results must survive postMessage
    return JSON.parse(JSON.stringify(res));
  };
  return { UK, UKLoader: sandbox.UKLoader, env, call, events, sandbox, code };
};
