import express from 'express';
import QRCode from 'qrcode';

const app = express();
const port = Number(process.env.PORT || 8080);
const appsScriptUrl = process.env.APPS_SCRIPT_URL || '';
const applePassBaseUrl = process.env.APPLE_PASS_BASE_URL || '';
const googleSaveBaseUrl = process.env.GOOGLE_SAVE_BASE_URL || '';

app.use(express.static('public'));
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Derby Hurricanes Wallet Service',
    version: '5.0.1',
    appleConfigured: Boolean(applePassBaseUrl),
    googleConfigured: Boolean(googleSaveBaseUrl),
  });
});

app.get('/wallet', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).send(renderError('Missing wallet token.'));
  if (!appsScriptUrl) {
    return res.status(503).send(renderError('Wallet service is not connected to Apps Script.'));
  }

  try {
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
    const qrData = String(data.member.qrData || data.member.localMemberID || '');
    const qrImage = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 420,
      color: { dark: '#001f29', light: '#ffffff' },
    });
    res.send(renderWallet(data.member, token, qrImage));
  } catch (error) {
    res.status(400).send(renderError(error instanceof Error ? error.message : String(error)));
  }
});

app.get('/wallet/apple', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!applePassBaseUrl) {
    return res.status(503).send(renderError('Apple Wallet pass generation is not configured yet.'));
  }
  res.redirect(`${applePassBaseUrl}${applePassBaseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
});

app.get('/wallet/google', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!googleSaveBaseUrl) {
    return res.status(503).send(renderError('Google Wallet pass generation is not configured yet.'));
  }
  res.redirect(`${googleSaveBaseUrl}${googleSaveBaseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
});

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
  const appleButton = applePassBaseUrl
    ? `<a class="wallet-button apple" href="/wallet/apple?token=${encodeURIComponent(token)}">Add to Apple Wallet</a>`
    : `<button class="wallet-button apple" disabled>Apple Wallet setup pending</button>`;
  const googleButton = googleSaveBaseUrl
    ? `<a class="wallet-button google" href="/wallet/google?token=${encodeURIComponent(token)}">Add to Google Wallet</a>`
    : `<button class="wallet-button google" disabled>Google Wallet setup pending</button>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#004957">
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
        <div>
          <span>Scan at training and club events</span>
          <strong>${escapeHtml(member.localMemberID)}</strong>
        </div>
      </div>
      <p class="issued">Issued by Derby Hurricanes Lacrosse Club</p>
    </section>
    <section class="actions">
      ${appleButton}
      ${googleButton}
      <button class="wallet-button secondary" onclick="shareCard()">Share membership card</button>
      <button class="wallet-button secondary" onclick="window.print()">Print or save as PDF</button>
      <p>This secure link expires after 30 days. Membership status is managed by Derby Hurricanes club administrators.</p>
    </section>
  </main>
  <script>
    async function shareCard() {
      const shareData = { title: 'Derby Hurricanes Membership Card', text: '${escapeHtml(member.name)} membership card', url: window.location.href };
      if (navigator.share) {
        try { await navigator.share(shareData); } catch (_) {}
      } else {
        await navigator.clipboard.writeText(window.location.href);
        alert('Membership card link copied.');
      }
    }
  </script>
</body>
</html>`;
}

function renderError(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Wallet Card Error</title></head><body><main class="page"><section class="card error"><h1>Card unavailable</h1><p>${escapeHtml(message)}</p></section></main></body></html>`;
}

app.listen(port, () => console.log(`Wallet service listening on ${port}`));
