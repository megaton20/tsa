const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year

// <input type="datetime-local"> value (Lagos time) -> Date
function fromLagosInput(value) {
  if (!value) return null;
  const d = new Date(`${value}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date -> value for <input type="datetime-local"> in Lagos time
function toLagosInput(date) {
  if (!date) return '';
  return new Date(new Date(date).getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 16);
}

function fmtDateTime(date, tz = 'Africa/Lagos') {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(date));
}

function isSafeUrl(value) {
  if (!value) return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value || '');
}

function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function safeReturn(url, fallback = '/dashboard') {
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  return fallback;
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = { fromLagosInput, toLagosInput, fmtDateTime, isSafeUrl, isHttps, isEmail, slugify, safeReturn, getCookie };

// ----- Phase 2 helpers -----
function naira(kobo) {
  const v = (Number(kobo) || 0) / 100;
  return '\u20A6' + new Intl.NumberFormat('en-NG', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
}

function fmtDate(date, tz = 'Africa/Lagos') {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: tz }).format(new Date(date));
}

// "12.5" or "12,500" typed in naira -> kobo integer (null when invalid)
function nairaToKobo(value) {
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

module.exports.naira = naira;
module.exports.fmtDate = fmtDate;
module.exports.nairaToKobo = nairaToKobo;

// ----- Phase 3 helpers -----
function fmtWhen(date, tz = 'Africa/Lagos') {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' }).format(new Date(date));
}

// Only Google Meet or Zoom links may be pasted, so a student is never sent somewhere unexpected.
function isMeetingLink(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'meet.google.com' || h === 'zoom.us' || h.endsWith('.zoom.us');
  } catch (e) {
    return false;
  }
}

// CSV cell that cannot be run as a spreadsheet formula
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports.fmtWhen = fmtWhen;
module.exports.isMeetingLink = isMeetingLink;
module.exports.csvCell = csvCell;
