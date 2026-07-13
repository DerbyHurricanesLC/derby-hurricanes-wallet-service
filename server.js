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
const publicBaseUrl = (
  process.env.WALLET_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://derby-hurricanes-wallet-service.onrender.com'
).replace(/\/$/, '');

const googleConfigured = Boolean(
  googleIssuerId &&
  googleClassId &&
  googleServiceAccountEmail &&
  googlePrivateKey,
);

app.disable('x-powered-by');
app.use(express.static('public', { maxAge: '1h' }));
app.use(express.json({ limit: '100kb' }));

app.get('/', (_req, res) => {
  res.type('html').send(renderError(
    'Open the secure membership-card link supplied by Derby Hurricanes.',
  ));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Derby Hurricanes Wallet Service',
    version: '6.0.0',
    appleConfigured: false,
    googleConfigured,
    iphoneHomeScreen: true,
    brandedWalletCards: true,
    googleWalletObjectVersion: 'v60',
  });
});

app.get('/wallet', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send(renderError('Missing wallet token.'));

  try {
    const member = await loadMember(token);
    const qrData = String(member.qrData || member.localMemberID || '');
    const qrImage = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 900,
      color: { dark: '#001f29', light: '#ffffff' },
    });
    return res.send(renderWallet(member, token, qrImage));
  } catch (error) {
    return res.status(400).send(renderError(
      error instanceof Error ? error.message : String(error),
    ));
  }
});

app.get('/wallet/google', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send(renderError('Missing wallet token.'));
  if (!googleConfigured) {
    return res.status(503).send(renderError(
      'Google Wallet has not been configured by the club yet.',
    ));
  }

  try {
    const member = await loadMember(token);
    return res.redirect(createGoogleSaveUrl(member, token));
  } catch (error) {
    return res.status(400).send(renderError(
      error instanceof Error ? error.message : String(error),
    ));
  }
});

async function loadMember(token) {
  if (!appsScriptUrl) {
    throw new Error('Wallet service is not connected to Apps Script.');
  }

  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'walletMember', token }),
    redirect: 'follow',
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The membership database returned an invalid response.');
  }

  if (!response.ok || data.ok === false || !data.member) {
    throw new Error(data.error || 'Member card could not be loaded.');
  }

  return data.member;
}

function createGoogleSaveUrl(member, token) {
  const localMemberId = String(member.localMemberID || 'member');
  const membershipSeason = String(member.membershipSeason || 'season');
  const membershipType = String(member.membershipType || 'Membership');
  const memberName = String(member.name || 'Member');
  const status = String(member.membershipStatus || 'Unknown');
  const expiryText = String(member.expiryDate || 'Not set');
  const qrValue = String(member.qrData || member.localMemberID || '');

  const localId = cleanId(localMemberId);
  const season = cleanId(membershipSeason);
  const objectId = `${googleIssuerId}.${localId}-${season}-v60`;
  const classId = googleClassId.includes('.')
    ? googleClassId
    : `${googleIssuerId}.${googleClassId}`;
  const expiry = parseUkDate(member.expiryDate);
  const fullCardUrl = `${publicBaseUrl}/wallet?token=${encodeURIComponent(token)}`;

  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle: {
      defaultValue: { language: 'en-GB', value: 'DERBY HURRICANES' },
    },
    header: {
      defaultValue: { language: 'en-GB', value: memberName },
    },
    subheader: {
      defaultValue: { language: 'en-GB', value: `${membershipType} · ${membershipSeason}` },
    },
    hexBackgroundColor: statusColour(status),
    logo: {
      sourceUri: { uri: `${publicBaseUrl}/wallet-logo.png?v=60` },
      contentDescription: {
        defaultValue: {
          language: 'en-GB',
          value: 'Derby Hurricanes Lacrosse Club logo',
        },
      },
    },
    heroImage: {
      sourceUri: { uri: `${publicBaseUrl}/wallet-hero.jpg?v=60` },
      contentDescription: {
        defaultValue: {
          language: 'en-GB',
          value: 'Derby Hurricanes membership banner',
        },
      },
    },
    barcode: {
      type: 'QR_CODE',
      value: qrValue,
      alternateText: localMemberId,
    },
    textModulesData: [
      { id: 'membership_status', header: 'STATUS', body: status.toUpperCase() },
      { id: 'member_id', header: 'MEMBER ID', body: localMemberId },
      { id: 'membership_type', header: 'MEMBERSHIP TYPE', body: membershipType },
      { id: 'membership_season', header: 'SEASON', body: membershipSeason },
      { id: 'valid_until', header: 'VALID UNTIL', body: expiryText },
      { id: 'training', header: 'TRAINING', body: 'Thursdays, 18:30' },
      { id: 'venue', header: 'VENUE', body: 'Sturgess Field, Kedleston Road, Derby' },
      { id: 'contact', header: 'CLUB EMAIL', body: 'derbyhurricanes@gmail.com' },
    ],
    linksModuleData: {
      uris: [
        {
          id: 'full_membership_card',
          uri: fullCardUrl,
          description: 'Open full membership card',
        },
        {
          id: 'club_email',
          uri: 'mailto:derbyhurricanes@gmail.com',
          description: 'Email Derby Hurricanes',
        },
        {
          id: 'club_instagram',
          uri: 'https://www.instagram.com/derbyhurricanes/',
          description: 'Derby Hurricanes on Instagram',
        },
      ],
    },
  };

  if (expiry) {
    genericObject.validTimeInterval = { end: { date: expiry.toISOString() } };
  }

  const claims = {
    iss: googleServiceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [publicBaseUrl],
    payload: { genericObjects: [genericObject] },
  };

  const signedJwt = jwt.sign(claims, googlePrivateKey, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${signedJwt}`;
}

function statusColour(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('expired')) return '#5d1820';
  if (value.includes('due')) return '#5a4100';
  return '#003f49';
}

function parseUkDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    23,
    59,
    59,
  ));
}

function cleanId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderWallet(member, token, qrImage) {
  const status = escapeHtml(member.membershipStatus || 'Unknown');
  const statusClass = status.toLowerCase().replaceAll(' ', '-');
  const memberName = escapeHtml(member.name || 'Member');
  const localMemberId = escapeHtml(member.localMemberID || '');
  const membershipType = escapeHtml(member.membershipType || 'Membership');
  const membershipSeason = escapeHtml(member.membershipSeason || '');
  const expiryDate = escapeHtml(member.expiryDate || 'Not set');

  const googleButton = googleConfigured
    ? `<a class="wallet-button google" href="/wallet/google?token=${encodeURIComponent(token)}"><span class="google-mark">G</span><span>Add to Google Wallet</span></a>`
    : '<button class="wallet-button google" disabled>Google Wallet setup pending</button>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#003f49">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="DH Card">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>${memberName} — Derby Hurricanes</title>
  <link rel="stylesheet" href="/styles.css?v=60">
</head>
<body>
  <main class="page">
    <section class="member-card ${statusClass}">
      <div class="card-watermark" aria-hidden="true"></div>
      <div class="card-sheen" aria-hidden="true"></div>

      <header class="card-header">
        <img class="club-logo" src="/club-logo-full.png?v=60" alt="Derby Hurricanes Lacrosse Club">
        <div class="season-block">
          <span>MEMBERSHIP</span>
          <strong>${membershipSeason}</strong>
        </div>
      </header>

      <div class="card-content">
        <div class="identity">
          <p class="field-label">MEMBERSHIP TYPE</p>
          <p class="membership-type">${membershipType}</p>
          <p class="field-label name-label">MEMBER NAME</p>
          <h1>${memberName}</h1>
          <div class="identity-meta">
            <div><span>MEMBER ID</span><strong>${localMemberId}</strong></div>
            <div><span>VALID UNTIL</span><strong>${expiryDate}</strong></div>
          </div>
        </div>

        <div class="qr-wrap">
          <img class="qr-image" src="${qrImage}" alt="Membership QR code">
          <strong>${localMemberId}</strong>
          <span>SCAN TO CHECK IN</span>
        </div>
      </div>

      <footer class="card-footer">
        <div class="status-badge ${statusClass}"><i></i>${status}</div>
      </footer>
    </section>

    <section class="details-card">
      <h2>Membership details</h2>
      <div class="details-grid">
        <div><span>Member</span><strong>${memberName}</strong></div>
        <div><span>Membership</span><strong>${membershipType}</strong></div>
        <div><span>Season</span><strong>${membershipSeason}</strong></div>
        <div><span>Status</span><strong>${status}</strong></div>
        <div><span>Training</span><strong>Thursdays, 18:30</strong></div>
        <div><span>Venue</span><strong>Sturgess Field</strong></div>
      </div>
    </section>

    <section class="actions">
      <div id="android-actions">${googleButton}</div>
      <button id="iphone-install" class="wallet-button apple" onclick="showIphoneHelp()">Add to iPhone Home Screen</button>
      <button class="wallet-button secondary" onclick="shareCard()">Share membership card</button>
      <button class="wallet-button secondary" onclick="window.print()">Print or save as PDF</button>
      <p>Google Wallet uses Google’s own layout. This hosted card is the full premium Derby Hurricanes design.</p>
    </section>
  </main>

  <div id="iphone-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="iphone-title">
    <div class="modal-card">
      <button class="modal-close" onclick="closeIphoneHelp()" aria-label="Close">×</button>
      <h2 id="iphone-title">Add this card to your iPhone</h2>
      <ol>
        <li>Open this page in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Keep the name <strong>DH Card</strong>, then tap <strong>Add</strong>.</li>
      </ol>
      <button class="wallet-button secondary" onclick="closeIphoneHelp()">Done</button>
    </div>
  </div>

  <script>
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) document.getElementById('android-actions').hidden = true;
    if (/Android/i.test(ua)) document.getElementById('iphone-install').hidden = true;
    function showIphoneHelp() { document.getElementById('iphone-modal').classList.add('open'); }
    function closeIphoneHelp() { document.getElementById('iphone-modal').classList.remove('open'); }
    async function shareCard() {
      const data = { title: 'Derby Hurricanes Membership Card', text: '${memberName} membership card', url: window.location.href };
      if (navigator.share) { try { await navigator.share(data); } catch (_) {} return; }
      try { await navigator.clipboard.writeText(window.location.href); alert('Membership card link copied.'); }
      catch (_) { alert('Copy the membership-card address from your browser.'); }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  </script>
</body>
</html>`;
}

function renderError(message) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/styles.css?v=60">
  <title>Derby Hurricanes Membership Card</title>
</head>
<body>
  <main class="page">
    <section class="error-card">
      <img class="error-logo" src="/club-logo-full.png?v=60" alt="Derby Hurricanes">
      <h1>Card unavailable</h1>
      <p>${escapeHtml(message)}</p>
    </section>
  </main>
</body>
</html>`;
}

app.listen(port, () => {
  console.log(`Wallet service listening on ${port}`);
});
