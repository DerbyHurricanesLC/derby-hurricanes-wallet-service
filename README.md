# Derby Hurricanes Wallet Service 6.1

This release adds:

- automatic membership-season calculation from the expiry date;
- automatic Active, Due Soon and Expired status calculation;
- one permanent Google Wallet object per member;
- Google Wallet REST updates, so the same installed pass can change after renewal;
- background pass refresh whenever the hosted card is opened;
- manual **Refresh wallet pass** button;
- exact Derby Hurricanes logo placed unchanged on a dark background.

## Important first-time note

Version 6.1 uses a permanent object ID ending in `-membership-v61`. Members who already installed an older versioned pass must remove it and add the 6.1 pass once. Future seasons then update the same 6.1 pass instead of issuing another card.

## Render environment variables

- `APPS_SCRIPT_URL`
- `GOOGLE_WALLET_ISSUER_ID`
- `GOOGLE_WALLET_CLASS_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

Optional:

- `WALLET_ORIGIN`

## Deploy

```bash
npm install
npm run check
git add .
git commit -m "Add automatic season rollover and permanent wallet updates"
git pull --rebase origin main
git push origin main
```

Verify `/health` reports version `6.1.0` and `automaticSeasonRollover: true`.
