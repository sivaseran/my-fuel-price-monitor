import { fuelLabels } from '../config/stations';

const formatAge = (value) => {
  if (!value) return 'Update time unavailable';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Update time unavailable';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 2) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
};

const priceOrInfinity = (row, fuel) =>
  Number.isFinite(row.prices?.[fuel]) ? row.prices[fuel] : Number.POSITIVE_INFINITY;

function differenceLabel(price, ownPrice) {
  if (!Number.isFinite(price) || !Number.isFinite(ownPrice)) return null;
  const diff = price - ownPrice;
  if (Math.abs(diff) < 0.05) return { text: 'Same as us', className: 'same' };
  if (diff < 0) {
    return {
      text: `${Math.abs(diff).toFixed(1)}p cheaper`,
      className: 'cheaper',
    };
  }
  return {
    text: `${diff.toFixed(1)}p dearer`,
    className: 'dearer',
  };
}

export default function CompetitorTable({
  competitors,
  ownPrices,
  ownUpdatedAt,
  site,
  priorityIds,
  togglePriority,
  fuelView,
  sortMode,
  keyOnly,
}) {
  const ownRow = {
    id: `our:${site.id}`,
    name: site.name,
    brand: site.brand,
    postcode: site.postcode,
    distanceMiles: 0,
    prices: ownPrices || {},
    updatedAt: ownUpdatedAt,
    isOwn: true,
  };

  let rows = competitors.map((station) => ({ ...station, isOwn: false }));

  if (keyOnly) {
    rows = rows.filter((station) => priorityIds.includes(station.id));
  }

  if (fuelView !== 'all') {
    rows = rows.filter((station) => Number.isFinite(station.prices?.[fuelView]));
    rows.push(ownRow);

    rows.sort((a, b) => {
      if (sortMode === 'distance') return a.distanceMiles - b.distanceMiles;
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      return priceOrInfinity(a, fuelView) - priceOrInfinity(b, fuelView);
    });
  } else {
    rows.sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode !== 'distance') {
        const ap = priceOrInfinity(a, sortMode);
        const bp = priceOrInfinity(b, sortMode);
        if (ap !== bp) return ap - bp;
      }
      return a.distanceMiles - b.distanceMiles;
    });
    rows.unshift(ownRow);
  }

  const ownRank = fuelView !== 'all'
    ? rows.findIndex((row) => row.isOwn) + 1
    : null;

  const rankedCount = fuelView !== 'all'
    ? rows.filter((row) => Number.isFinite(row.prices?.[fuelView])).length
    : null;

  return (
    <section className="price-list-panel">
      <div className="list-heading">
        <div>
          <h2>{fuelView === 'all' ? 'Nearby stations' : `${fuelLabels[fuelView]} price order`}</h2>
          <p>
            {fuelView === 'all'
              ? 'Your store is shown first for quick reference.'
              : 'Your store stays in its true price position.'}
          </p>
        </div>

        {ownRank ? (
          <div className="position-chip">
            Our position <strong>{ownRank} of {rankedCount}</strong>
          </div>
        ) : null}
      </div>

      <div className="station-list">
        {rows.map((station, index) => {
          const priority = !station.isOwn && priorityIds.includes(station.id);
          const focusPrice = fuelView !== 'all' ? station.prices?.[fuelView] : null;
          const diff = fuelView !== 'all'
            ? differenceLabel(focusPrice, ownPrices?.[fuelView])
            : null;

          return (
            <article
              key={station.id}
              className={`station-row ${station.isOwn ? 'our-store-row' : ''} ${priority ? 'priority-row' : ''}`}
            >
              <div className="station-row-main">
                <div className="station-rank">
                  {fuelView !== 'all' ? index + 1 : station.isOwn ? 'YOU' : ''}
                </div>

                <button
                  className={`star-button ${priority ? 'active' : ''} ${station.isOwn ? 'hidden-star' : ''}`}
                  onClick={() => !station.isOwn && togglePriority(station.id)}
                  aria-label={priority ? 'Remove priority competitor' : 'Mark priority competitor'}
                  disabled={station.isOwn}
                >
                  {station.isOwn ? '◆' : priority ? '★' : '☆'}
                </button>

                <div className="station-identity">
                  <div className="station-name-line">
                    <strong>{station.name}</strong>
                    {station.isOwn && <span className="our-badge">OUR STORE</span>}
                    {priority && <span className="priority-badge">Priority</span>}
                  </div>
                  <div className="station-meta">
                    {station.brand || 'Independent'}
                    {station.postcode ? ` • ${station.postcode}` : ''}
                    {!station.isOwn ? ` • ${station.distanceMiles.toFixed(1)} mi` : ''}
                  </div>
                </div>

                {fuelView !== 'all' && (
                  <div className="focus-price">
                    <strong>{Number.isFinite(focusPrice) ? `${focusPrice.toFixed(1)}p` : '—'}</strong>
                    <span className={diff?.className || ''}>
                      {station.isOwn ? 'Our price' : diff?.text || 'No comparison'}
                    </span>
                  </div>
                )}
              </div>

              {fuelView === 'all' && (
                <div className="all-fuels-grid">
                  {site.fuels.map((fuel) => {
                    const price = station.prices?.[fuel];
                    const difference = station.isOwn
                      ? null
                      : differenceLabel(price, ownPrices?.[fuel]);
                    return (
                      <div className="fuel-cell" key={fuel}>
                        <span>{fuelLabels[fuel]}</span>
                        <strong>{Number.isFinite(price) ? `${price.toFixed(1)}p` : '—'}</strong>
                        <small className={difference?.className || ''}>
                          {station.isOwn ? 'Our price' : difference?.text || '—'}
                        </small>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="station-update">{formatAge(station.updatedAt)}</div>
            </article>
          );
        })}

        {!rows.length && (
          <div className="empty-state">No stations match this filter.</div>
        )}
      </div>
    </section>
  );
}
