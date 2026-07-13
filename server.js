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

const VERSION = '7.0.0';
const OBJECT_VERSION = 'v70';

app.disable('x-powered-by');
app.use(express.static('public', { maxAge: '1h', index: false }));
app.use(express.json({ limit: '100kb' }));

app.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#001f29"><title>DH Card</title><link rel="stylesheet" href="/styles.css?v=70"></head>
<body><main class="page"><section class="error-card"><div class="error-logo-panel"><img class="error-logo" src="/club-logo-full.png?v=70" alt="Derby Hurricanes"></div><h1 id="launch-title">Opening membership card…</h1><p id="launch-message">Please wait.</p></section></main>
<script>try{const saved=localStorage.getItem('derbyHurricanesWalletUrl');if(saved&&saved.includes('/wallet?token=')){location.replace(saved);}else{document.getElementById('launch-title').textContent='Card unavailable';document.getElementById('launch-message').textContent='Open your secure Derby Hurricanes card link, then install the card again.';}}catch(_){document.getElementById('launch-title').textContent='Card unavailable';document.getElementById('launch-message').textContent='Open the secure membership-card link supplied by Derby Hurricanes.';}</script></body></html>`);
});

app.get('/manifest.webmanifest', (req, res) => {
  const token = String(req.query.token || '').trim();
  const startUrl = token ? `/wallet?token=${encodeURIComponent(token)}` : '/';
  res.set('Cache-Control', 'no-store').type('application/manifest+json').send({
    id: startUrl,
    name: 'Derby Hurricanes Membership Card',
    short_name: 'DH Card',
    description: 'Derby Hurricanes digital membership card',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#00141d',
    theme_color: '#001f29',
    icons: [
      { src: '/wallet-logo-192.png?v=70', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/wallet-logo-512.png?v=70', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Derby Hurricanes Wallet Service',
    version: VERSION,
    appleConfigured: false,
    googleConfigured,
    iphoneHomeScreen: true,
    androidHomeScreen: true,
    homeScreenTokenFix: true,
    brandedWalletCards: true,
    automaticSeasonRollover: true,
    permanentGoogleWalletObject: true,
    googleWalletObjectVersion: OBJECT_VERSION,
  });
});

app.get('/wallet', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send(renderError('Missing wallet token.'));

  try {
    const rawMember = await loadMember(token);
    const member = normaliseMembership(rawMember);

    if (googleConfigured) {
      upsertGoogleObject(member, token).catch((error) => {
        console.error('Background Google Wallet sync failed:', error.message);
      });
    }

    const qrData = String(member.qrData || member.localMemberID || '');
    const qrImage = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 1000,
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
    const rawMember = await loadMember(token);
    const member = normaliseMembership(rawMember);
    const walletObject = await upsertGoogleObject(member, token);
    return res.redirect(createGoogleSaveUrl(walletObject));
  } catch (error) {
    console.error('Google Wallet add failed:', error);
    return res.status(400).send(renderError(
      error instanceof Error ? error.message : String(error),
    ));
  }
});

app.post('/wallet/sync', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Missing wallet token.' });
  if (!googleConfigured) {
    return res.status(503).json({ ok: false, error: 'Google Wallet is not configured.' });
  }

  try {
    const rawMember = await loadMember(token);
    const member = normaliseMembership(rawMember);
    const walletObject = await upsertGoogleObject(member, token);
    return res.json({
      ok: true,
      objectId: walletObject.id,
      season: member.membershipSeason,
      status: member.membershipStatus,
      expiryDate: member.expiryDate,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
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

function normaliseMembership(member) {
  const expiry = parseUkDate(member.expiryDate);
  const now = new Date();
  const normalised = { ...member };

  if (expiry) {
    normalised.membershipSeason = seasonFromExpiry(expiry);
    normalised.expiryDate = formatUkDate(expiry);

    const expiryEnd = new Date(expiry);
    expiryEnd.setUTCHours(23, 59, 59, 999);

    if (now.getTime() > expiryEnd.getTime()) {
      normalised.membershipStatus = 'Expired';
    } else {
      const daysLeft = Math.ceil((expiryEnd.getTime() - now.getTime()) / 86400000);
      normalised.membershipStatus = daysLeft <= 30 ? 'Due Soon' : 'Active';
    }
  } else {
    normalised.membershipSeason = String(
      member.membershipSeason || currentMembershipSeason(now),
    );
    normalised.membershipStatus = String(member.membershipStatus || 'Unknown');
  }

  return normalised;
}

function currentMembershipSeason(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 10 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function seasonFromExpiry(expiry) {
  const endYear = expiry.getUTCFullYear();
  return `${endYear - 1}/${String(endYear % 100).padStart(2, '0')}`;
}

function buildGoogleObject(member, token) {
  const localMemberId = String(member.localMemberID || 'member');
  const membershipSeason = String(member.membershipSeason || 'season');
  const membershipType = String(member.membershipType || 'Membership');
  const memberName = String(member.name || 'Member');
  const status = String(member.membershipStatus || 'Unknown');
  const expiryText = String(member.expiryDate || 'Not set');
  const qrValue = String(member.qrData || member.localMemberID || '');

  const localId = cleanId(localMemberId);
  const objectId = `${googleIssuerId}.${localId}-membership-${OBJECT_VERSION}`;
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
      defaultValue: {
        language: 'en-GB',
        value: `${membershipType} · ${membershipSeason}`,
      },
    },
    hexBackgroundColor: statusColour(status),
    logo: {
      sourceUri: { uri: `${publicBaseUrl}/wallet-logo.png?v=70` },
      contentDescription: {
        defaultValue: {
          language: 'en-GB',
          value: 'Derby Hurricanes Lacrosse Club logo',
        },
      },
    },
    heroImage: {
      sourceUri: { uri: `${publicBaseUrl}/wallet-hero.jpg?v=70` },
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

  return genericObject;
}

async function upsertGoogleObject(member, token) {
  const walletObject = buildGoogleObject(member, token);
  const accessToken = await getGoogleAccessToken();
  const encodedId = encodeURIComponent(walletObject.id);
  const objectUrl = `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodedId}`;

  const existingResponse = await fetch(objectUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  let response;
  if (existingResponse.status === 404) {
    response = await fetch(
      'https://walletobjects.googleapis.com/walletobjects/v1/genericObject',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(walletObject),
      },
    );
  } else if (existingResponse.ok) {
    response = await fetch(objectUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(walletObject),
    });
  } else {
    const text = await existingResponse.text();
    throw new Error(`Google Wallet lookup failed (${existingResponse.status}): ${text}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Wallet update failed (${response.status}): ${text}`);
  }

  return walletObject;
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: googleServiceAccountEmail,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    googlePrivateKey,
    { algorithm: 'RS256' },
  );

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Could not authenticate with Google Wallet.');
  }

  return data.access_token;
}

function createGoogleSaveUrl(walletObject) {
  const claims = {
    iss: googleServiceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [publicBaseUrl],
    payload: { genericObjects: [walletObject] },
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

function formatUkDate(date) {
  return [
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    date.getUTCFullYear(),
  ].join('/');
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
  <meta name="theme-color" content="#001f29">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="DH Card">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=70">
  <link rel="manifest" href="/manifest.webmanifest?token=${encodeURIComponent(token)}&v=70">
  <title>${memberName} — Derby Hurricanes</title>
  <link rel="stylesheet" href="/styles.css?v=70">
</head>
<body>
  <main class="page">
    <section class="member-card ${statusClass}">
      <div class="card-watermark" aria-hidden="true"></div>
      <div class="card-sheen" aria-hidden="true"></div>

      <header class="card-header">
        <div class="logo-panel">
          <img class="club-logo" src="/club-logo-full.png?v=70" alt="Derby Hurricanes Lacrosse Club">
        </div>
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
      <button id="home-screen-install" class="wallet-button apple" onclick="installHomeScreen()">Install DH Card</button>
      <button class="wallet-button secondary" onclick="shareCard()">Share membership card</button>
      <button class="wallet-button secondary" onclick="syncWallet()">Refresh wallet pass</button>
      <button class="wallet-button secondary" onclick="window.print()">Print or save as PDF</button>
      <p id="sync-message">Membership season, expiry and status are recalculated automatically from the club record.</p>
    </section>
  </main>

  <div id="iphone-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="iphone-title">
    <div class="modal-card">
      <button class="modal-close" onclick="closeIphoneHelp()" aria-label="Close">×</button>
      <h2 id="iphone-title">Install your DH Card</h2>
      <ol>
        <li><strong>Android:</strong> open the Chrome menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
        <li><strong>iPhone:</strong> open this page in Safari.</li>
        <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
        <li>Keep the name <strong>DH Card</strong>, then tap <strong>Add</strong>.</li>
      </ol>
      <button class="wallet-button secondary" onclick="closeIphoneHelp()">Done</button>
    </div>
  </div>

  <script>
    const walletToken = ${JSON.stringify(token)};
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    let deferredInstallPrompt = null;
    try { localStorage.setItem('derbyHurricanesWalletUrl', window.location.href); } catch (_) {}
    window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstallPrompt = event; });
    window.addEventListener('appinstalled', () => { const button = document.getElementById('home-screen-install'); if (button) { button.textContent = 'DH Card Installed'; button.disabled = true; } });
    function showIphoneHelp() { document.getElementById('iphone-modal').classList.add('open'); }
    function closeIphoneHelp() { document.getElementById('iphone-modal').classList.remove('open'); }
    async function installHomeScreen() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
      }
      showIphoneHelp();
    }
    async function shareCard() {
      const data = { title: 'Derby Hurricanes Membership Card', text: '${memberName} membership card', url: window.location.href };
      if (navigator.share) { try { await navigator.share(data); } catch (_) {} return; }
      try { await navigator.clipboard.writeText(window.location.href); alert('Membership card link copied.'); }
      catch (_) { alert('Copy the membership-card address from your browser.'); }
    }
    async function syncWallet() {
      const message = document.getElementById('sync-message');
      message.textContent = 'Refreshing wallet pass…';
      try {
        const response = await fetch('/wallet/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: walletToken }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Refresh failed.');
        message.textContent = 'Wallet pass refreshed: ' + data.season + ', ' + data.status + ', valid until ' + data.expiryDate + '.';
      } catch (error) {
        message.textContent = error.message || 'Wallet refresh failed.';
      }
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js?v=70').catch(() => {});
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
  <link rel="stylesheet" href="/styles.css?v=70">
  <title>Derby Hurricanes Membership Card</title>
</head>
<body>
  <main class="page">
    <section class="error-card">
      <div class="error-logo-panel">
        <img class="error-logo" src="/club-logo-full.png?v=70" alt="Derby Hurricanes">
      </div>
      <h1>Card unavailable</h1>
      <p>${escapeHtml(message)}</p>
    </section>
  </main>
</body>
</html>`;
}

app.listen(port, () => {
  console.log(`Wallet service ${VERSION} listening on ${port}`);
});
