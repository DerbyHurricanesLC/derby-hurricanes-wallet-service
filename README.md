# Derby Hurricanes Wallet Service 7.0

Complete member-card and portal release.

## Includes
- Google Wallet creation and automatic updates
- Automatic season/status rollover
- Member-specific Home Screen installation fix
- Offline fallback for previously loaded cards
- Exact club logo on dark background
- Larger hosted QR code
- Member portal tabs for overview, attendance, payments and club information
- Optional announcements, fixtures, payment history and attendance history when returned by Apps Script

## Deploy
```bash
npm install
npm run check
git add .
git commit -m "Upgrade wallet service to version 7"
git pull --rebase origin main
git push origin main
```

After deployment, delete old Home Screen shortcuts and install again from each member's secure card URL.
