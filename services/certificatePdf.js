// Draws the certificate as a one-page A4 landscape PDF with no third-party library.
// It uses the built-in PDF fonts, so names are folded to plain Latin letters (the web page shows the exact spelling).
const METRICS = require('./pdfFontMetrics');

const W = 841.89;
const H = 595.28;
const FONT_KEYS = { 'Helvetica': 'F1', 'Helvetica-Bold': 'F2', 'Times-Roman': 'F3', 'Times-Bold': 'F4', 'Times-Italic': 'F5' };

const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const GREEN = rgb('#0A3B2A');
const BRAND = rgb('#0F7A4F');
const GOLD = rgb('#D9A62B');
const GOLD_LIGHT = rgb('#F2C14E');
const GREY = rgb('#475569');
const SOFT = rgb('#E4F3EA');

// Latin-only text for the standard fonts: drop accents and dots below letters, straighten quotes
function latin(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const pdfString = (s) => `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;

function textWidth(text, font, size, spacing = 0) {
  const m = METRICS[font];
  let w = 0;
  for (const ch of text) w += m[ch.charCodeAt(0) - 32] || 0;
  return (w / 1000) * size + spacing * text.length;
}

function wrap(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fmtLongDate(date) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }).format(new Date(date));
}

function buildCertificatePdf({ recipientName, programTitle, cohortName, completedOn, issuedAt, attendancePercent, code, verifyUrl }) {
  const ops = [];
  const add = (s) => ops.push(s);
  const text = (str, x, y, font, size, color, { spacing = 0, align = 'center' } = {}) => {
    const t = latin(str);
    const w = textWidth(t, font, size, spacing);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    add(`BT /${FONT_KEYS[font]} ${size} Tf ${spacing} Tc ${color} rg ${left.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(t)} Tj ET`);
  };
  const rect = (x, y, w, h, fill, stroke, lw = 1) => {
    add(`q ${fill ? `${fill} rg ` : ''}${stroke ? `${stroke} RG ${lw} w ` : ''}${x} ${y} ${w} ${h} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  };
  const circle = (cx, cy, r, fill, stroke, lw = 1) => {
    const k = 0.5523 * r;
    add(`q ${fill ? `${fill} rg ` : ''}${stroke ? `${stroke} RG ${lw} w ` : ''}${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c ${fill && stroke ? 'B' : fill ? 'f' : 'S'} Q`);
  };
  const line = (x1, y1, x2, y2, color, lw = 1) => add(`q ${color} RG ${lw} w ${x1} ${y1} m ${x2} ${y2} l S Q`);

  // Frame: gold outer border, green inner border
  rect(18, 18, W - 36, H - 36, null, GOLD, 4);
  rect(30, 30, W - 60, H - 60, null, BRAND, 1);

  // Header band
  rect(30, H - 124, W - 60, 94, GREEN, null);
  rect(30, H - 128, W - 60, 4, GOLD_LIGHT, null);
  text('TRUE SERIES ACADEMY', W / 2, H - 78, 'Helvetica-Bold', 22, GOLD_LIGHT, { spacing: 4 });
  text('CERTIFICATE OF COMPLETION', W / 2, H - 104, 'Helvetica', 11, SOFT, { spacing: 3 });

  // Body
  const maxWide = W - 180;
  const fit = (str, font, start, min, maxLines) => {
    for (let size = start; size >= min; size -= 2) {
      const lines = wrap(str, font, size, maxWide);
      if (lines.length <= maxLines && lines.every((l) => textWidth(l, font, size) <= maxWide)) return { size, lines };
    }
    // Still too long: keep what fits and end with an ellipsis
    let lines = wrap(str, font, min, maxWide).slice(0, maxLines);
    let last = lines[lines.length - 1];
    while (last.length > 1 && textWidth(`${last}...`, font, min) > maxWide) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}...`;
    return { size: min, lines };
  };
  const ellipsize = (str, font, size, max) => {
    let t = str;
    while (t.length > 4 && textWidth(t, font, size) > max) t = t.slice(0, -1);
    return t === str ? t : `${t.trimEnd()}...`;
  };

  text('This certifies that', W / 2, H - 178, 'Times-Italic', 17, GREY);
  const name = latin(recipientName) || 'Student';
  const nm = fit(name, 'Times-Bold', 44, 30, 2);
  let y = H - 232;
  nm.lines.forEach((l) => {
    text(l, W / 2, y, 'Times-Bold', nm.size, GREEN);
    y -= nm.size + 6;
  });
  y += nm.size + 6 - 14;
  const widest = Math.max(...nm.lines.map((l) => textWidth(l, 'Times-Bold', nm.size)));
  const half = Math.min(Math.max(widest / 2 + 20, 150), W / 2 - 80);
  line(W / 2 - half, y, W / 2 + half, y, GOLD, 1.5);
  y -= 32;
  text('has successfully completed', W / 2, y, 'Times-Italic', 17, GREY);
  y -= 40;

  const pt = fit(latin(programTitle), 'Times-Bold', 28, 20, 2);
  pt.lines.forEach((l) => {
    text(l, W / 2, y, 'Times-Bold', pt.size, BRAND);
    y -= pt.size + 6;
  });
  const parts = [`Completed ${fmtLongDate(completedOn)}`, attendancePercent === null || attendancePercent === undefined ? '' : `Attendance ${attendancePercent}%`].filter(Boolean);
  const cohortPart = ellipsize(latin(cohortName), 'Helvetica', 12, W - 200 - textWidth(`   -   ${parts.join('   -   ')}`, 'Helvetica', 12));
  text([cohortPart, ...parts].join('   -   '), W / 2, y - 4, 'Helvetica', 12, GREY);

  // Footer: code and verification on the left, seal on the right
  text('Certificate code', 70, 112, 'Helvetica', 9, GREY, { align: 'left' });
  text(code, 70, 94, 'Helvetica-Bold', 16, GREEN, { align: 'left', spacing: 1 });
  text('Check it is genuine at', 70, 74, 'Helvetica', 9, GREY, { align: 'left' });
  text(verifyUrl, 70, 60, 'Helvetica', 9, BRAND, { align: 'left' });

  text(`Issued ${fmtLongDate(issuedAt)}`, W - 150, 62, 'Helvetica', 10, GREY, { align: 'center' });
  circle(W - 150, 112, 40, GOLD_LIGHT, GOLD, 2);
  circle(W - 150, 112, 32, null, GREEN, 1);
  text('TSA', W - 150, 106, 'Helvetica-Bold', 20, GREEN, { spacing: 1 });

  const content = ops.join('\n');
  const fonts = Object.keys(FONT_KEYS);
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fonts.map((f, i) => `/${FONT_KEYS[f]} ${5 + i} 0 R`).join(' ')} >> >> /Contents 4 0 R >>`;
  objects[4] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  fonts.forEach((f, i) => (objects[5 + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
  const infoId = objects.length;
  const d = new Date();
  const pdfDate = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
  objects[infoId] = `<< /Title ${pdfString(`Certificate ${code}`)} /Author (True Series Academy) /Subject ${pdfString(latin(programTitle))} /CreationDate (${pdfDate}) >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildCertificatePdf, latin, textWidth };
