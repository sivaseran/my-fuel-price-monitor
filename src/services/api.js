import { mockBySite } from '../data/mock';

const comparisonUrl = import.meta.env.VITE_COMPARISON_URL;

export async function getSiteComparison(siteId, radiusMiles = 10) {
  if (!comparisonUrl) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const data = mockBySite[siteId];
    return {
      mode: 'demo',
      ...data,
      competitors: data.competitors.filter((x) => x.distanceMiles <= radiusMiles),
    };
  }

  const url = new URL(comparisonUrl);
  url.searchParams.set('siteId', siteId);
  url.searchParams.set('radiusMiles', String(radiusMiles));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return { mode: 'live', ...(await response.json()) };
}
