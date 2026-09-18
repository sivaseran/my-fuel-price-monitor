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
  for (const [fuelType, item] of Object.entries(payload?.site?.prices || {})) {
    const price = Number(item?.price);
    if (Number.isFinite(price)) ownPrices[fuelType] = price;
  }

  const competitors = (payload?.competitors || []).map((station) => {
    const prices = {};
    const priceObjects = Object.values(station?.prices || {});

    for (const [fuelType, item] of Object.entries(station?.prices || {})) {
      const price = Number(item?.price);
      if (Number.isFinite(price)) prices[fuelType] = price;
    }

    return {
      id: station.nodeId,
      name: station.tradingName || 'Unnamed forecourt',
      brand: station.brandName || '',
      distanceMiles: Number(station.distanceMiles),
      postcode: station?.location?.postcode || '',
      updatedAt: latestTimestamp(priceObjects),
      prices,
      isSupermarket: Boolean(station.isSupermarket),
      isMotorway: Boolean(station.isMotorway),
      location: station.location || null,
    };
  });

  return {
    mode: 'live',
    ownPrices,
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
