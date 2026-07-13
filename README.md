# Derby Hurricanes Wallet Service 8.0

This release uses permanent member URLs in the form `/card/:token`.
This fixes iPhone Home Screen launch failures caused by Safari and installed web apps not reliably sharing local storage.

## Deployment

1. Copy these files into the existing Git-connected wallet service folder.
2. Run `npm install` and `node --check server.js`.
3. Commit and push to GitHub.
4. Wait for Render to redeploy.
5. Remove old iPhone Home Screen icons and reinstall from the new `/card/:token` page.
