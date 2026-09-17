import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_RADIUS_MILES, stations } from './config/stations';
import { getSiteComparison } from './services/api';
import StationTabs from './components/StationTabs';
import SummaryCards from './components/SummaryCards';
import CompetitorTable from './components/CompetitorTable';
import './styles.css';

function priorityKey(siteId) {
  return `fuel-monitor:priority:${siteId}`;
}

export default function App() {
  const [siteId, setSiteId] = useState(stations[0].id);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MILES);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('distance');
  const [priorityIds, setPriorityIds] = useState([]);

  const site = useMemo(() => stations.find((s) => s.id === siteId), [siteId]);

  useEffect(() => {
    try {
      setPriorityIds(JSON.parse(localStorage.getItem(priorityKey(siteId)) || '[]'));
    } catch {
      setPriorityIds([]);
    }
  }, [siteId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getSiteComparison(siteId, radius)
      .then((value) => alive && setData(value))
      .catch((err) => alive && setError(err.message || 'Could not load fuel prices.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [siteId, radius]);

  const togglePriority = (competitorId) => {
    setPriorityIds((current) => {
      const next = current.includes(competitorId)
        ? current.filter((id) => id !== competitorId)
        : [...current, competitorId];
      localStorage.setItem(priorityKey(siteId), JSON.stringify(next));
      return next;
    });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Operations dashboard</div>
          <h1>Fuel Price Monitor</h1>
          <p>North Terrace & Fordham competitor pricing</p>
        </div>
        <div className="live-pill"><span></span>{data?.mode === 'live' ? 'Live API' : 'Demo data'}</div>
      </header>

      <StationTabs stations={stations} selectedId={siteId} onSelect={setSiteId} />

      <section className="site-bar">
        <div>
          <strong>{site.name}</strong>
          <div className="muted">{site.address}</div>
        </div>
        <label>
          Competitor radius
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            <option value={3}>3 miles</option>
            <option value={5}>5 miles</option>
            <option value={10}>10 miles</option>
            <option value={15}>15 miles</option>
          </select>
        </label>
      </section>

      {data?.mode === 'demo' && (
        <div className="notice"><strong>Demo mode:</strong> prices below are fictional. Configure <code>VITE_COMPARISON_URL</code> to use your secure backend.</div>
      )}
      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading comparison…</div>}

      {!loading && data && (
        <>
          <SummaryCards fuels={site.fuels} ownPrices={data.ownPrices} competitors={data.competitors} />
          <CompetitorTable
            competitors={data.competitors}
            fuels={site.fuels}
            priorityIds={priorityIds}
            togglePriority={togglePriority}
            sort={sort}
            setSort={setSort}
          />
        </>
      )}
    </main>
  );
}
