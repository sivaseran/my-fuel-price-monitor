import { fuelLabels } from '../config/stations';

function findCheapest(competitors, fuel) {
  return competitors
    .filter((x) => Number.isFinite(x.prices?.[fuel]))
    .sort((a, b) => a.prices[fuel] - b.prices[fuel])[0];
}

export default function SummaryCards({ fuels, ownPrices, competitors }) {
  return (
    <div className="summary-grid">
      {fuels.map((fuel) => {
        const own = ownPrices?.[fuel];
        const cheapest = findCheapest(competitors, fuel);
        const gap = cheapest && Number.isFinite(own) ? own - cheapest.prices[fuel] : null;
        const cheaperCount = Number.isFinite(own)
          ? competitors.filter((c) => Number.isFinite(c.prices?.[fuel]) && c.prices[fuel] < own).length
          : 0;
        return (
          <article className="summary-card" key={fuel}>
            <div className="summary-heading">{fuelLabels[fuel]}</div>
            <div className="summary-own">{Number.isFinite(own) ? `${own.toFixed(1)}p` : '—'}</div>
            <div className="summary-label">Our price</div>
            <div className="summary-detail">
              <span>Cheapest nearby</span>
              <strong>{cheapest ? `${cheapest.prices[fuel].toFixed(1)}p` : '—'}</strong>
            </div>
            <div className="summary-detail">
              <span>Gap</span>
              <strong className={gap > 0 ? 'negative' : gap < 0 ? 'positive' : ''}>
                {gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap.toFixed(1)}p`}
              </strong>
            </div>
            <div className="summary-detail">
              <span>Cheaper than us</span>
              <strong>{cheaperCount}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
}
