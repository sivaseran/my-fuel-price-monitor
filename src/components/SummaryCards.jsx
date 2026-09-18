import { fuelLabels } from '../config/stations';

export default function SummaryCards({ fuels, ownPrices }) {
  return (
    <section className="own-price-strip" aria-label="Our current prices">
      <div className="own-price-title">Our prices</div>

      <div
        className="own-price-values"
        style={{
          gridTemplateColumns: `repeat(${fuels.length}, minmax(0, 1fr))`,
        }}
      >
        {fuels.map((fuel) => (
          <div className="own-price-item" key={fuel}>
            <span>{fuelLabels[fuel]}</span>

            <strong>
              {Number.isFinite(ownPrices?.[fuel])
                ? `${ownPrices[fuel].toFixed(1)}p`
                : '—'}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
