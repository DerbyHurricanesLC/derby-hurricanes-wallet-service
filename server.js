import express from 'express';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';

const app = express();
const port = Number(process.env.PORT || 8080);
const appsScriptUrl = process.env.APPS_SCRIPT_URL || '';
const googleIssuerId = process.env.GOOGLE_WALLET_ISSUER_ID || '';
const googleClassId = process.env.GOOGLE_WALLET_CLASS_ID || '';
const googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const googlePrivateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const walletOrigin = process.env.WALLET_ORIGIN || '';

const googleConfigured = Boolean(
  googleIssuerId && googleClassId && googleServiceAccountEmail && googlePrivateKey,
);

app.use(express.static('public'));
app.use(express.json({ limit: '100kb' }));

app.get('/', (_req, res) => {
  res.type('html').send(renderError('Open the secure membership-card link supplied by Derby Hurricanes.'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Derby Hurricanes Wallet Service',
    version: '5.1.0',
    appleConfigured: false,
    googleConfigured,
    iphoneHomeScreen: true,
  });
});

app.get('/wallet', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send(renderError('Missing wallet token.'));
  try {
    const member = await loadMember(token);
    const qrData = String(member.qrData || member.localMemberID || '');
    const qrImage = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H', margin: 1, width: 420,
      color: { dark: '#001f29', light: '#ffffff' },
    });
    res.send(renderWallet(member, token, qrImage));
  } catch (error) {
    res.status(400).send(renderError(error instanceof Error ? error.message : String(error)));
  }
});

app.get('/wallet/google', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!googleConfigured) {
    return res.status(503).send(renderError('Google Wallet has not been configured by the club yet.'));
  }
  try {
    const member = await loadMember(token);
    const saveUrl = createGoogleSaveUrl(member);
    res.redirect(saveUrl);
  } catch (error) {
    res.status(400).send(renderError(error instanceof Error ? error.message : String(error)));
  }
});

async function loadMember(token) {
  if (!appsScriptUrl) throw new Error('Wallet service is not connected to Apps Script.');
  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'walletMember', token }),
    redirect: 'follow',
  });
  const data = await response.json();
  if (!response.ok || data.ok === false || !data.member) {
    throw new Error(data.error || 'Member card could not be loaded.');
  }
  return data.member;
}

function createGoogleSaveUrl(member) {
  const localId = cleanId(member.localMemberID || 'member');
  const season = cleanId(member.membershipSeason || 'season');
  const objectId = `${googleIssuerId}.${localId}-${season}`;
  const classId = googleClassId.includes('.') ? googleClassId : `${googleIssuerId}.${googleClassId}`;
  const expiry = parseUkDate(member.expiryDate);
  const status = String(member.membershipStatus || 'Unknown');

  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle: { defaultValue: { language: 'en-GB', value: 'Derby Hurricanes' } },
    header: { defaultValue: { language: 'en-GB', value: String(member.name || 'Member') } },
    subheader: { defaultValue: { language: 'en-GB', value: String(member.membershipType || 'Membership') } },
    hexBackgroundColor: '#004957',
    barcode: {
      type: 'QR_CODE',
      value: String(member.qrData || member.localMemberID || ''),
      alternateText: String(member.localMemberID || ''),
    },
    textModulesData: [
      { id: 'member_id', header: 'MEMBER ID', body: String(member.localMemberID || '') },
      { id: 'season', header: 'SEASON', body: String(member.membershipSeason || '') },
      { id: 'status', header: 'STATUS', body: status },
      { id: 'valid_until', header: 'VALID UNTIL', body: String(member.expiryDate || '') },
    ],
  };
  if (expiry) genericObject.validTimeInterval = { end: { date: expiry.toISOString() } };

  const claims = {
    iss: googleServiceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: walletOrigin ? [walletOrigin] : [],
    payload: { genericObjects: [genericObject] },
  };
  const signedJwt = jwt.sign(claims, googlePrivateKey, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${signedJwt}`;
}

function parseUkDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59));
}

function cleanId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function renderWallet(member, token, qrImage) {
  const status = escapeHtml(member.membershipStatus || 'Unknown');
  const statusClass = status.toLowerCase().replaceAll(' ', '-');
  const googleButton = googleConfigured
    ? `<a class="wallet-button google" href="/wallet/google?token=${encodeURIComponent(token)}">Add to Google Wallet</a>`
    : `<button class="wallet-button google" disabled>Google Wallet setup pending</button>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#004957">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="DH Card">
  <link rel="apple-touch-icon" href="/club-logo.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>Derby Hurricanes Membership Card</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="page">
    <section class="card ${statusClass}">
      <div class="season-ribbon">${escapeHtml(member.membershipSeason)}</div>
      <div class="hologram" aria-hidden="true"></div>
      <img class="logo" src="/club-logo.png" alt="Derby Hurricanes">
      <p class="eyebrow">DERBY HURRICANES</p>
      <h1>${escapeHtml(member.name)}</h1>
      <p class="membership">${escapeHtml(member.membershipType)}</p>
      <div class="status-pill ${statusClass}">${status}</div>
      <div class="details">
        <div><span>Member ID</span><strong>${escapeHtml(member.localMemberID)}</strong></div>
        <div><span>Season</span><strong>${escapeHtml(member.membershipSeason)}</strong></div>
        <div><span>Valid until</span><strong>${escapeHtml(member.expiryDate || 'Not set')}</strong></div>
        <div><span>Club</span><strong>Derby Hurricanes</strong></div>
      </div>
      <div class="qr-panel">
        <img class="qr-image" src="${qrImage}" alt="Membership QR code">
        <div><span>Scan at training and club events</span><strong>${escapeHtml(member.localMemberID)}</strong></div>
      </div>
      <p class="issued">Issued by Derby Hurricanes Lacrosse Club</p>
    </section>
    <section class="actions">
      <div id="android-actions">${googleButton}</div>
      <button id="iphone-install" class="wallet-button apple" onclick="showIphoneHelp()">Add to iPhone Home Screen</button>
      <button class="wallet-button secondary" onclick="shareCard()">Share membership card</button>
      <button class="wallet-button secondary" onclick="window.print()">Print or save as PDF</button>
      <p id="device-note">Android members can save the card to Google Wallet. iPhone members can install the secure card on their Home Screen.</p>
    </section>
  </main>
  <div id="iphone-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="iphone-title">
    <div class="modal-card">
      <button class="modal-close" onclick="closeIphoneHelp()" aria-label="Close">×</button>
      <h2 id="iphone-title">Add this card to your iPhone</h2>
      <ol>
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button (square with an upward arrow).</li>
        <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
        <li>Keep the name “DH Card”, then tap <strong>Add</strong>.</li>
      </ol>
      <p>The new icon opens your current Derby Hurricanes membership card and QR code.</p>
      <button class="wallet-button secondary" onclick="closeIphoneHelp()">Done</button>
    </div>
  </div>
  <script>
    const ua = navigator.userAgent || '';
    const isiPhone = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isiPhone) document.getElementById('android-actions').hidden = true;
    if (isAndroid) document.getElementById('iphone-install').hidden = true;
    function showIphoneHelp() { document.getElementById('iphone-modal').classList.add('open'); }
    function closeIphoneHelp() { document.getElementById('iphone-modal').classList.remove('open'); }
    async function shareCard() {
      const shareData = { title: 'Derby Hurricanes Membership Card', text: '${escapeHtml(member.name)} membership card', url: window.location.href };
      if (navigator.share) { try { await navigator.share(shareData); } catch (_) {} }
      else { await navigator.clipboard.writeText(window.location.href); alert('Membership card link copied.'); }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  </script>
</body>
</html>`;
}

function renderError(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Wallet Card</title></head><body><main class="page"><section class="card error"><img class="logo" src="/club-logo.png" alt="Derby Hurricanes"><h1>Card unavailable</h1><p>${escapeHtml(message)}</p></section></main></body></html>`;
}

app.listen(port, () => console.log(`Wallet service listening on ${port}`));
