const { SiteSetting } = require('../models');

const KEYS = ['whatsappChannelUrl', 'whatsappGroupUrl', 'telegramUrl', 'supportEmail'];
let cache = null;
let cachedAt = 0;

async function getSettings() {
  if (cache && Date.now() - cachedAt < 60 * 1000) return cache;
  const rows = await SiteSetting.findAll();
  const out = {};
  KEYS.forEach((k) => (out[k] = ''));
  rows.forEach((r) => {
    if (KEYS.includes(r.key)) out[r.key] = r.value || '';
  });
  cache = out;
  cachedAt = Date.now();
  return out;
}

async function saveSettings(values) {
  for (const key of KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      await SiteSetting.upsert({ key, value: values[key] });
    }
  }
  cache = null;
}

module.exports = { KEYS, getSettings, saveSettings };
