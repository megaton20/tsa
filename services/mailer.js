// Brevo transactional email through the REST API (no extra dependency, needs Node 18+).
const APP_NAME = 'True Series Academy';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendMail({ to, name, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text || ''}\n`);
    return { skipped: true };
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM_EMAIL, name: process.env.MAIL_FROM_NAME || APP_NAME },
      to: [{ email: to, name }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
  return res.json();
}

function layout({ heading, body, buttonText, buttonUrl, footnote }) {
  return `<!doctype html><html><body style="margin:0;background:#F5F8F4;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#0A3B2A;padding:20px 28px;color:#F2C14E;font-size:18px;font-weight:bold">${APP_NAME}</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;font-size:22px;color:#0A3B2A">${esc(heading)}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${body}</p>
        ${buttonUrl ? `<p style="margin:0 0 20px"><a href="${esc(buttonUrl)}" style="display:inline-block;background:#0F7A4F;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${esc(buttonText)}</a></p>
        <p style="margin:0 0 8px;font-size:12px;color:#64748b">If the button does not work, paste this link into your browser:<br>${esc(buttonUrl)}</p>` : ''}
        ${footnote ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${esc(footnote)}</p>` : ''}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendVerificationEmail(user, link) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject: `Verify your email for ${APP_NAME}`,
    html: layout({
      heading: `Welcome, ${user.name.split(' ')[0]}`,
      body: 'Confirm your email address to finish creating your account. This link works for 24 hours.',
      buttonText: 'Verify email',
      buttonUrl: link,
      footnote: 'If you did not create this account, you can ignore this email.',
    }),
    text: `Verify your email: ${link}`,
  });
}

async function sendPasswordResetEmail(user, link) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject: `Reset your ${APP_NAME} password`,
    html: layout({
      heading: 'Reset your password',
      body: 'Use the button below to choose a new password. This link works for 1 hour.',
      buttonText: 'Choose new password',
      buttonUrl: link,
      footnote: 'If you did not ask for this, you can ignore this email. Your password stays the same.',
    }),
    text: `Reset your password: ${link}`,
  });
}

async function sendGoogleAccountNotice(user, loginUrl) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject: `Sign in to ${APP_NAME} with Google`,
    html: layout({
      heading: 'This account uses Google sign-in',
      body: 'Someone asked to reset the password for this email, but your account was created with Google and has no password. Use Continue with Google on the sign-in page.',
      buttonText: 'Go to sign in',
      buttonUrl: loginUrl,
    }),
    text: `Your account uses Google sign-in. Sign in here: ${loginUrl}`,
  });
}

// Plain notification email: escaped body text plus an optional button.
async function sendNotice({ user, subject, heading, body, buttonText, buttonUrl, footnote }) {
  return sendMail({
    to: user.email,
    name: user.name,
    subject,
    html: layout({ heading, body: esc(body), buttonText, buttonUrl, footnote }),
    text: `${heading}\n\n${body}${buttonUrl ? `\n\n${buttonText}: ${buttonUrl}` : ''}`,
  });
}

module.exports = { sendNotice, sendMail, sendVerificationEmail, sendPasswordResetEmail, sendGoogleAccountNotice };
