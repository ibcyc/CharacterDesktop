// Files in the data folder: JSON read and atomic write, and the error log.
const fs = require('node:fs');
const path = require('node:path');

function createStore(dataRoot) {
  fs.mkdirSync(dataRoot, { recursive: true });
  const file = name => path.join(dataRoot, name);
  return {
    read(name, fallback) {
      try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
    },
    write(name, value) {
      const target = file(name), temp = target + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(value));
      fs.renameSync(temp, target);
    },
    log(error) {
      try { fs.appendFileSync(file('app.log'), new Date().toISOString() + ' ' + String(error?.stack || error) + '\n'); } catch { /* logging must never throw */ }
    }
  };
}

module.exports = { createStore };
