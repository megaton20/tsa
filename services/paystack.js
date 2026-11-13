// Paystack REST API without an SDK. Amounts are in kobo.
const crypto = require('crypto');

const BASE = 'https://api.paystack.co';

const isConfigured = () => Boolean(process.env.PAYSTACK_SECRET_KEY);

async function request(method, path, body) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('Payments are not configured');
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.status) throw new Error(json.message || `Paystack error ${res.status}`);
  return json.data;
}

const initialize = (payload) => request('POST', '/transaction/initialize', payload);
const verify = (reference) => request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

// Paystack signs the raw request body with your secret key (HMAC SHA512).
function verifySignature(rawBody, signature) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', key).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, initialize, verify, verifySignature };
