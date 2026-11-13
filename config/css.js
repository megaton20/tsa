// Serves the compiled Tailwind stylesheet when it exists (npm run build:css, also run by npm install).
// If it has not been built yet, pages fall back to Tailwind's browser build with the same config and
// the same component classes, so nothing looks broken before the first build.
const fs = require('fs');
const path = require('path');

const BUILT = path.join(__dirname, '..', 'public', 'css', 'tailwind.css');
const SOURCE = path.join(__dirname, '..', 'src', 'input.css');
let cache = { at: 0, info: null };

function cssInfo() {
  if (cache.info && Date.now() - cache.at < 5000) return cache.info;
  let built = false;
  let version = 0;
  try {
    const st = fs.statSync(BUILT);
    built = st.size > 1000;
    version = Math.round(st.mtimeMs);
  } catch (e) {
    /* not built yet */
  }
  const info = { built, version };
  if (!built) {
    info.inline = fs.readFileSync(SOURCE, 'utf8').replace(/^@tailwind .*$/gm, '');
    info.configJson = JSON.stringify({ theme: require('../tailwind.config.js').theme });
  }
  cache = { at: Date.now(), info };
  return info;
}

module.exports = { cssInfo };
