import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_RADIUS_MILES, fuelLabels, stations } from './config/stations';
import { getSiteComparison } from './services/api';
import {
  disablePush,
  enablePush,
  getPushState,
  syncPushPreferences,
} from './services/notifications';
import StationTabs from './components/StationTabs';
import SummaryCards from './components/SummaryCards';
import CompetitorTable from './components/CompetitorTable';
import './styles.css';

function priorityKey(siteId) {
  return `fuel-monitor:priority:${siteId}`;
}

function readPriority(siteId) {
  try {
    return JSON.parse(localStorage.getItem(priorityKey(siteId)) || '[]');
  } catch {
    return [];
  }
}

function readPriorityMap(overrides = {}) {
  return Object.fromEntries(
    stations.map((station) => [
      station.id,
      Object.prototype.hasOwnProperty.call(overrides, station.id)
        ? overrides[station.id]
        : readPriority(station.id),
    ])
  );
}

function formatUpdated(value) {
  if (!value) return 'Update time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Update time unavailable';

  const now = new Date();
  const sameLocalDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return `Updated ${new Intl.DateTimeFormat('en-GB', {
    ...(sameLocalDay ? {} : { day: '2-digit', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`;
}

export default function App() {
  const [siteId, setSiteId] = useState(stations[0].id);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MILES);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fuelView, setFuelView] = useState('all');
  const [sortMode, setSortMode] = useState('distance');
  const [keyOnly, setKeyOnly] = useState(false);
  const [priorityIds, setPriorityIds] = useState([]);
  const [pushState, setPushState] = useState({
    supported: true,
    permission: 'default',
    subscribed: false,
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  const site = useMemo(() => stations.find((s) => s.id === siteId), [siteId]);

  useEffect(() => {
    setPriorityIds(readPriority(siteId));
    setFuelView('all');
    setSortMode('distance');
    setKeyOnly(false);
  }, [siteId]);

  useEffect(() => {
    getPushState().then(setPushState).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;

    const loadComparison = async ({ showLoading = false } = {}) => {
      if (showLoading) setLoading(true);
      setError('');
      try {
        const value = await getSiteComparison(siteId, radius);
        if (alive) setData(value);
      } catch (err) {
        if (alive) setError(err.message || 'Could not load fuel prices.');
      } finally {
        if (alive && showLoading) setLoading(false);
      }
    };

    loadComparison({ showLoading: true });

    const intervalId = window.setInterval(() => {
      loadComparison();
    }, 5 * 60 * 1000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadComparison();
    };

    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [siteId, radius]);

  const selectFuelView = (fuel) => {
    setFuelView(fuel);
    setSortMode(fuel === 'all' ? 'distance' : 'price');
  };

  const togglePriority = (competitorId) => {
    setPriorityIds((current) => {
      const next = current.includes(competitorId)
        ? current.filter((id) => id !== competitorId)
        : [...current, competitorId];

      localStorage.setItem(priorityKey(siteId), JSON.stringify(next));

      if (pushState.subscribed) {
        const priorityMap = readPriorityMap({ [siteId]: next });
        syncPushPreferences(priorityMap).catch(() => {});
      }

      return next;
    });
  };

  const handlePushToggle = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (pushState.subscribed) {
        await disablePush();
        const next = await getPushState();
        setPushState(next);
        setPushMessage('Price-change alerts turned off on this device.');
      } else {
        await enablePush(readPriorityMap());
        const next = await getPushState();
        setPushState(next);
        setPushMessage('Alerts are on. Star competitors to receive price-change notifications.');
      }
    } catch (err) {
      setPushMessage(err.message || 'Could not update notification settings.');
    } finally {
      setPushBusy(false);
    }
  };

  const updatedAt = data?.cache?.pricesFetchedAt || data?.generatedAt;

  return (
    <main className="app-shell">
      <header className="topbar compact-topbar">
        <div>
          <div className="eyebrow">Operations dashboard</div>
          <h1>Fuel Price Monitor</h1>
          <p className="official-source">
            Official Fuel Finder prices <span>•</span> {formatUpdated(updatedAt)}
          </p>
        </div>

        <button
          className={`notification-button ${pushState.subscribed ? 'active' : ''}`}
          onClick={handlePushToggle}
          disabled={pushBusy || pushState.permission === 'denied'}
        >
          {pushBusy
            ? 'Please wait…'
            : pushState.permission === 'denied'
              ? '🔕 Alerts blocked'
              : pushState.subscribed
                ? '🔔 Alerts on'
                : '🔔 Enable alerts'}
        </button>
      </header>

      {pushMessage && <div className="push-message">{pushMessage}</div>}

      <StationTabs stations={stations} selectedId={siteId} onSelect={setSiteId} />

      <section className="site-toolbar">
        <div className="site-location">
          <strong>{site.name}</strong>
          <span>{site.address}</span>
        </div>

        <label className="radius-control">
          <span>Radius</span>
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            <option value={3}>3 miles</option>
            <option value={5}>5 miles</option>
            <option value={10}>10 miles</option>
            <option value={15}>15 miles</option>
          </select>
        </label>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading latest comparison…</div>}

      {!loading && data && (
        <>
          <SummaryCards fuels={site.fuels} ownPrices={data.ownPrices} />

          <section className="filter-panel">
            <div className="fuel-tabs" role="tablist" aria-label="Fuel view">
              <button
                className={fuelView === 'all' ? 'active' : ''}
                onClick={() => selectFuelView('all')}
              >
                All
              </button>
              {site.fuels.map((fuel) => (
                <button
                  key={fuel}
                  className={fuelView === fuel ? 'active' : ''}
                  onClick={() => selectFuelView(fuel)}
                >
                  {fuel === 'E10'
                    ? 'Petrol'
                    : fuel === 'B7_STANDARD'
                      ? 'Diesel'
                      : fuelLabels[fuel]}
                </button>
              ))}
            </div>

            <div className="secondary-filters">
              <label>
                <span>Sort</span>
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  {fuelView !== 'all' && <option value="price">Price ↑</option>}
                  <option value="distance">Distance</option>
                  <option value="name">Name</option>
                  {fuelView === 'all' && site.fuels.map((fuel) => (
                    <option value={fuel} key={fuel}>{fuelLabels[fuel]} ↑</option>
                  ))}
                </select>
              </label>

              <button
                className={`key-filter ${keyOnly ? 'active' : ''}`}
                onClick={() => setKeyOnly((current) => !current)}
              >
                ★ Key competitors
              </button>
            </div>
          </section>

          <CompetitorTable
            competitors={data.competitors}
            ownPrices={data.ownPrices}
            ownUpdatedAt={data.ownUpdatedAt}
            site={site}
            priorityIds={priorityIds}
            togglePriority={togglePriority}
            fuelView={fuelView}
            sortMode={sortMode}
            keyOnly={keyOnly}
          />
        </>
      )}
    </main>
  );
}
