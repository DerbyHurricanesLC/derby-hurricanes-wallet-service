# Derby Hurricanes Wallet Service 6.0

Complete replacement wallet service for:

- branded hosted membership cards;
- Google Wallet generic passes;
- iPhone Add to Home Screen;
- secure member data fetched through Apps Script.

## Render environment variables

- `APPS_SCRIPT_URL`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_CLASS_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Optional:

- `WALLET_ORIGIN`

## Deploy

Copy these files into the existing GitHub-connected wallet repository, preserving its `.git` folder. Then run:

```bash
npm install
npm run check
git add .
git commit -m "Replace wallet service with version 6.0"
git pull --rebase origin main
git push origin main
```

Render should redeploy automatically.

## Verify

Open:

`https://derby-hurricanes-wallet-service.onrender.com/health`

Expected version: `6.0.0`.

Remove the old test pass and add it again because v6 uses a new Google Wallet object ID ending in `-v60`.

## Google Wallet limitation

Google controls the native pass layout and the white expanded details screen. The hosted card is the full premium design; the Google Wallet pass is the compact native version.
