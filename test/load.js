/* Loads the built code.js against a mock Figma and returns { UK, env }. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const createMockFigma = require('./mock-figma.js');

module.exports = function load() {
  const env = createMockFigma();
  const sandbox = { figma: env.figma, console, __UK_HEADLESS__: true, __html__: '' };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'code.js'), 'utf8');
  vm.runInContext(code + '\n;this.UK = UK;', sandbox, { filename: 'code.js' });
  const UK = sandbox.UK;
  const events = [];
  UK._post = (m) => events.push(m);
  /** Sends a request exactly the way the interface does. */
  const call = async (type, payload) => {
    const res = await UK.dispatch({ type, id: 1, payload });
    // round-trip through JSON: results must survive postMessage
    return JSON.parse(JSON.stringify(res));
  };
  return { UK, env, call, events, sandbox };
};
