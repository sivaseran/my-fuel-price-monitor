import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fuelFinderGet } from './fuelFinder.js';

initializeApp();
const db = getFirestore();

const SITES = {
  'north-terrace': { lat: 52.34551, lng: 0.511049, fuels: ['unleaded', 'diesel', 'premium'] },
  fordham: { lat: 52.311774, lng: 0.387794, fuels: ['unleaded', 'diesel'] },
};

function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// IMPORTANT: The exact Fuel Finder resource path and response-field mapping must be
// completed after you have developer-portal access. GOV.UK confirms REST + OAuth 2.0
// client credentials, but the authenticated developer specification is the source of truth.
function normaliseFuelFinderPayload(payload, siteId) {
  if (payload?.ownPrices && Array.isArray(payload?.competitors)) return payload;
  throw new Error(`Fuel Finder mapping not configured for ${siteId}. Update normaliseFuelFinderPayload() using the authenticated API specification.`);
}

export const comparison = onRequest({ region: 'europe-west2' }, async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const siteId = String(req.query.siteId || '');
    const site = SITES[siteId];
    if (!site) return res.status(400).json({ error: 'Unknown siteId' });
    const radiusMiles = Math.min(Math.max(Number(req.query.radiusMiles || 10), 1), 25);

    // Replace "forecourts" and query parameter names if the authenticated spec differs.
    const raw = await fuelFinderGet('forecourts', {
      latitude: site.lat,
      longitude: site.lng,
      radiusMiles,
    });
    const result = normaliseFuelFinderPayload(raw, siteId);

    // Optional snapshot storage for later history charts.
    await db.collection('fuelSnapshots').add({ siteId, radiusMiles, capturedAt: new Date(), result });
    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
});
