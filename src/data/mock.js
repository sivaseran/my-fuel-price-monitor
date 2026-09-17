// Demo data only. Replace automatically when VITE_COMPARISON_URL is configured.
// Prices are intentionally fictional so the UI cannot be mistaken for live market data.
export const mockBySite = {
  'north-terrace': {
    ownPrices: { unleaded: 139.9, diesel: 147.9, premium: 154.9 },
    competitors: [
      { id: 'demo-nt-1', name: 'Demo Supermarket Fuel', brand: 'Demo', distanceMiles: 2.3, updatedAt: new Date().toISOString(), prices: { unleaded: 137.9, diesel: 145.9, premium: null } },
      { id: 'demo-nt-2', name: 'Demo Roadside Station', brand: 'Demo', distanceMiles: 4.8, updatedAt: new Date().toISOString(), prices: { unleaded: 140.9, diesel: 148.9, premium: 155.9 } },
      { id: 'demo-nt-3', name: 'Demo Town Forecourt', brand: 'Demo', distanceMiles: 7.4, updatedAt: new Date().toISOString(), prices: { unleaded: 138.7, diesel: 146.5, premium: 153.9 } }
    ]
  },
  fordham: {
    ownPrices: { unleaded: 139.9, diesel: 147.9 },
    competitors: [
      { id: 'demo-fd-1', name: 'Demo Village Fuel', brand: 'Demo', distanceMiles: 2.0, updatedAt: new Date().toISOString(), prices: { unleaded: 138.9, diesel: 146.9 } },
      { id: 'demo-fd-2', name: 'Demo Supermarket PFS', brand: 'Demo', distanceMiles: 6.2, updatedAt: new Date().toISOString(), prices: { unleaded: 136.9, diesel: 145.9 } },
      { id: 'demo-fd-3', name: 'Demo A-Road Station', brand: 'Demo', distanceMiles: 9.1, updatedAt: new Date().toISOString(), prices: { unleaded: 141.9, diesel: 149.9 } }
    ]
  }
};
