# Fuel Price Monitor

Private operations dashboard for **North Terrace Service Station** and **Fordham Service Station**.

## V1 features

- Default competitor radius: **10 miles** (3/5/10/15 selectable)
- North Terrace fuels: Unleaded, Diesel, Premium
- Fordham fuels: Unleaded, Diesel
- Summary focuses on cheapest nearby price, price gap, and how many stations are cheaper — no local-average card
- Multiple priority competitors per service station
- Priority competitors are starred and pinned above normal stations
- Priority selections are stored per station in browser local storage for V1
- Demo mode uses clearly fictional data until the secure API backend is connected
- GitHub Pages workflow included
- Firebase Functions OAuth adapter included for Fuel Finder
- Firestore snapshot hook included for future price history

## Service-station configuration

`src/config/stations.js`

North Terrace uses postcode-centre coordinates for IP28 7AA and Fordham uses postcode-centre coordinates for CB7 5NG. Once Fuel Finder returns exact forecourt IDs/coordinates, replace these with the canonical API values.

## Local development

```bash
npm install
npm run dev
```

Without `VITE_COMPARISON_URL`, the dashboard opens in Demo mode.

## GitHub Pages

1. Create a GitHub repository and push this project to `main`.
2. In GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. The included `.github/workflows/deploy.yml` builds and deploys the React/Vite site.
4. Until the backend is live, leave the `VITE_COMPARISON_URL` repository secret unset and the deployed site will display demo data.

## Fuel Finder backend

GOV.UK states that Fuel Finder's public API is REST-based and authenticated using OAuth 2.0 client credentials. The detailed developer portal is authenticated, so endpoint/resource names and response mapping are intentionally kept configurable here rather than guessed.

1. Obtain Fuel Finder developer access with GOV.UK One Login.
2. Copy `functions/.env.example` to `functions/.env` for local testing.
3. Set the actual token URL, API base URL, client ID, client secret and any required scope from the developer portal.
4. Update the `forecourts` resource/query fields and `normaliseFuelFinderPayload()` in `functions/index.js` to match the authenticated API specification.
5. Deploy the Firebase function.
6. Add the deployed `comparison` Cloud Function URL as the GitHub repository secret `VITE_COMPARISON_URL`.

**Never put the Fuel Finder client secret in the Vite frontend or GitHub Pages code.**

## Next planned V1.1 changes

- Store priority competitor selections in Firestore instead of browser local storage
- Identify both of your own forecourts by canonical Fuel Finder forecourt ID
- Live competitor filtering using exact distance
- Own-price vs competitor difference per table row
- Price history (7/30 days)
- Optional alert rules for priority competitors
