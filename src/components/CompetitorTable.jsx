import { fuelLabels } from '../config/stations';

const formatTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export default function CompetitorTable({
  competitors,
  fuels,
  priorityIds,
  togglePriority,
  sort,
  setSort,
}) {
  const rows = [...competitors].sort((a, b) => {
    const ap = priorityIds.includes(a.id) ? 1 : 0;
    const bp = priorityIds.includes(b.id) ? 1 : 0;

    if (ap !== bp) return bp - ap;
    if (sort === 'distance') return a.distanceMiles - b.distanceMiles;

    const aPrice = a.prices?.[sort];
    const bPrice = b.prices?.[sort];
    return (Number.isFinite(aPrice) ? aPrice : 9999) -
      (Number.isFinite(bPrice) ? bPrice : 9999);
  });

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Nearby competitors</h2>
          <p>
            Star as many priority competitors as you want. Priority stations stay pinned at the top.
          </p>
        </div>
        <label className="sort-control">
          Sort normal stations
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="distance">Nearest</option>
            <option value="E10">Cheapest unleaded</option>
            <option value="B7_STANDARD">Cheapest diesel</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="Priority competitor">★</th>
              <th>Station</th>
              {fuels.map((fuel) => (
                <th key={fuel}>{fuelLabels[fuel]}</th>
              ))}
              <th>Distance</th>
              <th>Updated</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((station) => {
              const priority = priorityIds.includes(station.id);

              return (
                <tr key={station.id} className={priority ? 'priority-row' : ''}>
                  <td>
                    <button
                      className={priority ? 'star-button active' : 'star-button'}
                      onClick={() => togglePriority(station.id)}
                      title={
                        priority
                          ? 'Remove priority competitor'
                          : 'Mark priority competitor'
                      }
                    >
                      {priority ? '★' : '☆'}
                    </button>
                  </td>

                  <td>
                    <strong>{station.name}</strong>
                    <div className="muted">
                      {station.brand || '—'}
                      {station.postcode ? ` • ${station.postcode}` : ''}
                      {priority && <span className="priority-badge">Priority</span>}
                    </div>
                  </td>

                  {fuels.map((fuel) => (
                    <td key={fuel} className="price-cell">
                      {Number.isFinite(station.prices?.[fuel])
                        ? `${station.prices[fuel].toFixed(1)}p`
                        : '—'}
                    </td>
                  ))}

                  <td>{station.distanceMiles.toFixed(1)} mi</td>
                  <td className="muted small">{formatTime(station.updatedAt)}</td>
                </tr>
              );
            })}

            {!rows.length && (
              <tr>
                <td colSpan={fuels.length + 4}>No competitors found in this radius.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
