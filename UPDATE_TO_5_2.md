# Derby Hurricanes Wallet Cards 5.2

This release upgrades both the hosted card and the native Google Wallet pass.

## Included

- Actual Derby Hurricanes logo on the hosted and Google Wallet cards
- Branded Google Wallet logo and hero banner
- Teal/black premium card design
- Larger QR check-in area
- Member name, membership type, member ID, season, status and expiry
- Training, venue, email and Instagram details in Google Wallet
- Improved iPhone Home Screen card

## Deploy

Copy these files into the existing GitHub wallet-service repository, excluding `.git` and `node_modules`, then run:

```bash
npm install
git add .
git commit -m "Upgrade membership cards to 5.2"
git pull --rebase origin main
git push origin main
```

Wait for Render to redeploy. `/health` should report version `5.2.0`.

Existing Google Wallet cards may need to be removed and re-added once during testing to display the new object design immediately.
