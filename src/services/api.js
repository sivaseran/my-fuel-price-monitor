const DEFAULT_COMPARISON_URL =
  'https://fuel-price-monitor-api.5sivas01.workers.dev/comparison';

const comparisonUrl =
  import.meta.env.VITE_COMPARISON_URL || DEFAULT_COMPARISON_URL;

function latestTimestamp(priceObjects = []) {
  const times = priceObjects
    .map((item) => item?.lastUpdated)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function normaliseLivePayload(payload) {
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Fuel Finder returned an unsuccessful response.');
  }

  const ownPrices = {};
  const ownPriceDetails = {};
  const ownPriceObjects = Object.values(payload?.site?.prices || {});

  for (const [fuelType, item] of Object.entries(payload?.site?.prices || {})) {
    const price = Number(item?.price);
    if (!Number.isFinite(price)) continue;
    ownPrices[fuelType] = price;
    ownPriceDetails[fuelType] = item;
  }

  const competitors = (payload?.competitors || []).map((station) => {
    const prices = {};
    const priceDetails = {};
    const priceObjects = Object.values(station?.prices || {});

    for (const [fuelType, item] of Object.entries(station?.prices || {})) {
      const price = Number(item?.price);
      if (!Number.isFinite(price)) continue;
      prices[fuelType] = price;
      priceDetails[fuelType] = item;
    }

    return {
      id: station.nodeId,
      name: station.tradingName || 'Unnamed forecourt',
      brand: station.brandName || '',
      distanceMiles: Number(station.distanceMiles),
      postcode: station?.location?.postcode || '',
      updatedAt: latestTimestamp(priceObjects),
      prices,
      priceDetails,
      isSupermarket: Boolean(station.isSupermarket),
      isMotorway: Boolean(station.isMotorway),
      location: station.location || null,
    };
  });

  return {
    mode: 'live',
    ownPrices,
    ownPriceDetails,
    ownUpdatedAt: latestTimestamp(ownPriceObjects),
    competitors,
    competitorCount: payload.competitorCount ?? competitors.length,
    generatedAt: payload.generatedAt || null,
    cache: payload.cache || null,
    sourceSite: payload.site || null,
  };
}

export async function getSiteComparison(siteId, radiusMiles = 10) {
  const url = new URL(comparisonUrl);
  url.searchParams.set('siteId', siteId);
  url.searchParams.set('radiusMiles', String(radiusMiles));

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // handled below
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || `Fuel price API request failed (${response.status}).`
    );
  }

  return normaliseLivePayload(payload);
}

const DEFAULT_API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';
const apiBase = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;

export async function getSystemHealth() {
  const response = await fetch(`${apiBase}/health`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Health request failed (${response.status}).`);
  }
  return payload;
}

export async function runAdminAction(pin, action) {
  const response = await fetch(`${apiBase}/admin/pin/action`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({ pin, action }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `Admin action failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
