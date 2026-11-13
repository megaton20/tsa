#!/usr/bin/env node
/*
 * Keeps a Render free web service from spinning down by calling its cold /ping endpoint
 * (no database, no session) a little more often than every 15 minutes.
 *
 *   node scripts/keepalive.js https://your-app.onrender.com          ping every 14 minutes, forever
 *   node scripts/keepalive.js https://your-app.onrender.com 10       ping every 10 minutes
 *   node scripts/keepalive.js https://your-app.onrender.com --once   ping once and exit (for cron / CI)
 *
 * or set KEEPALIVE_URL and KEEPALIVE_MINUTES instead of arguments.
 * Run it on any machine that stays on. It must not run on the Render service itself: a sleeping
 * service cannot wake itself up.
 */
const args = process.argv.slice(2);
const once = args.includes('--once');
const rest = args.filter((a) => !a.startsWith('--'));
const base = String(rest[0] || process.env.KEEPALIVE_URL || '').replace(/\/+$/, '');
const minutes = Number(rest[1] || process.env.KEEPALIVE_MINUTES || 14);

if (!/^https?:\/\/[^/]+/i.test(base)) {
  console.error('Usage: node scripts/keepalive.js https://your-app.onrender.com [minutes] [--once]');
  process.exit(2);
}
if (!(minutes >= 1)) {
  console.error('Minutes must be 1 or more.');
  process.exit(2);
}
if (minutes >= 15) console.warn('Warning: Render spins a free service down after 15 minutes without traffic. Use 14 or less.');

const stamp = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A sleeping service can take a minute or more to wake, so allow a long timeout and retry once.
async function ping(attempt = 1) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(`${base}/ping`, { signal: ctrl.signal, headers: { 'user-agent': 'tsa-keepalive/1.0' }, cache: 'no-store' });
    const ms = Date.now() - started;
    console.log(`${stamp()}  ${res.status}  ${ms} ms${ms > 5000 ? '  (it was asleep and has woken up)' : ''}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return true;
  } catch (err) {
    console.error(`${stamp()}  failed (attempt ${attempt}): ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    if (attempt < 2) {
      await sleep(30000);
      return ping(attempt + 1);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const ok = await ping();
  if (once) process.exit(ok ? 0 : 1);
  console.log(`Pinging ${base}/ping every ${minutes} minute${minutes === 1 ? '' : 's'}. Press Ctrl+C to stop.`);
  setInterval(ping, minutes * 60 * 1000);
}

process.on('SIGINT', () => {
  console.log('\nStopped.');
  process.exit(0);
});
main();
