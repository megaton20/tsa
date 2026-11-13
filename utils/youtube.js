// Accepts the ways people copy a YouTube address and returns the 11-character video id (or null).
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'];

function parseYouTubeId(input) {
  const raw = String(input || '').trim();
  if (ID.test(raw)) return raw;
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.includes(host)) return null;
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(?:embed|live|shorts|v)\/([^/?#]+)/);
    id = m ? m[1] : null;
  }
  return id && ID.test(id) ? id : null;
}

const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;

module.exports = { parseYouTubeId, embedUrl };
