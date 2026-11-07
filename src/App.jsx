import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_RADIUS_MILES, fuelLabels, stations } from './config/stations';
import { getSiteComparison, getSystemHealth, runAdminAction } from './services/api';
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

const DEFAULT_SITE_KEY = 'fuel-monitor:default-site:v1';

function readDefaultSite() {
  try {
    const saved = localStorage.getItem(DEFAULT_SITE_KEY);
    return stations.some((station) => station.id === saved) ? saved : stations[0].id;
  } catch {
    return stations[0].id;
  }
}

function readNotificationAlert() {
  try {
    const prefix = '#price-alert=';
    if (!window.location.hash.startsWith(prefix)) return null;
    const parsed = JSON.parse(decodeURIComponent(window.location.hash.slice(prefix.length)));
    if (!stations.some((station) => station.id === parsed?.siteId) || !Array.isArray(parsed?.changes)) return null;
    return {
      siteId: parsed.siteId,
      siteName: String(parsed.siteName || ''),
      createdAt: parsed.createdAt || null,
      changes: parsed.changes.slice(0, 10).filter((change) =>
        change && typeof change.nodeId === 'string' &&
        typeof change.fuelType === 'string' &&
        Number.isFinite(Number(change.oldPrice)) &&
        Number.isFinite(Number(change.newPrice))
      ),
    };
  } catch {
    return null;
  }
}

function priceText(value) {
  return Number(value).toFixed(1) + 'p';
}

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
  const [defaultSiteId, setDefaultSiteId] = useState(readDefaultSite);
  const [notificationAlert, setNotificationAlert] = useState(readNotificationAlert);
  const [siteId, setSiteId] = useState(() => readNotificationAlert()?.siteId || readDefaultSite());
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
    status: 'checking',
  });
  const pushBusyRef = useRef(false);
  const pushCheckSequence = useRef(0);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminResult, setAdminResult] = useState(null);
  const [simulationCompetitor, setSimulationCompetitor] = useState('');
  const [simulationFuel, setSimulationFuel] = useState('E10');
  const [simulationOldPrice, setSimulationOldPrice] = useState('139.9');
  const [simulationNewPrice, setSimulationNewPrice] = useState('137.9');

  const site = useMemo(() => stations.find((s) => s.id === siteId), [siteId]);
  const simulationCandidates = useMemo(() => (data?.competitors || []).filter((item) => priorityIds.includes(item.id)), [data, priorityIds]);
  const simulationValid = simulationCandidates.some((item) => item.id === simulationCompetitor) && Number(simulationOldPrice) > 0 && Number(simulationNewPrice) > 0 && Number(simulationOldPrice) !== Number(simulationNewPrice);

  useEffect(() => {
    const handleAlertLink = () => {
      const incoming = readNotificationAlert();
      if (!incoming) return;
      setNotificationAlert(incoming);
      setSiteId(incoming.siteId);
    };
    window.addEventListener('hashchange', handleAlertLink);
    window.addEventListener('pageshow', handleAlertLink);
    return () => {
      window.removeEventListener('hashchange', handleAlertLink);
      window.removeEventListener('pageshow', handleAlertLink);
    };
  }, []);

  const dismissNotificationAlert = () => {
    setNotificationAlert(null);
    if (window.location.hash.startsWith('#price-alert=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  useEffect(() => {
    setPriorityIds(readPriority(siteId));
    setFuelView('all');
    setSortMode('distance');
    setKeyOnly(false);
  }, [siteId]);

  useEffect(() => {
    let alive = true;

    const refreshPushState = async () => {
      if (pushBusyRef.current) return;
      const sequence = ++pushCheckSequence.current;
      try {
        const state = await getPushState(readPriorityMap());
        if (alive && sequence === pushCheckSequence.current && !pushBusyRef.current) {
          setPushState(state);
        }
      } catch (error) {
        if (alive && sequence === pushCheckSequence.current && !pushBusyRef.current) {
          setPushState((current) => ({
            ...current,
            status: 'error',
            error: error?.message || 'Could not check alert status.',
          }));
        }
      }
    };

    refreshPushState();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshPushState();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      alive = false;
      ++pushCheckSequence.current;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
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

  const makeCurrentSiteDefault = () => {
    try {
      localStorage.setItem(DEFAULT_SITE_KEY, siteId);
      setDefaultSiteId(siteId);
    } catch {
      setError('Could not save your default station on this device. Check browser storage settings.');
    }
  };

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
    if (pushBusyRef.current || pushState.status === 'checking') return;
    pushBusyRef.current = true;
    ++pushCheckSequence.current;
    setPushBusy(true);
    setPushMessage('');
    try {
      if (pushState.subscribed) {
        await disablePush();
        setPushState(await getPushState());
        setPushMessage('Price-change alerts turned off on this device.');
      } else {
        await enablePush(readPriorityMap());
        const next = await getPushState(readPriorityMap());
        setPushState(next);
        setPushMessage('Alerts are on. Star competitors to receive price-change notifications.');
      }
    } catch (err) {
      setPushMessage(err.message || 'Could not update notification settings.');
      try {
        setPushState(await getPushState(readPriorityMap()));
      } catch {
        setPushState((current) => ({ ...current, status: 'error' }));
      }
    } finally {
      pushBusyRef.current = false;
      setPushBusy(false);
    }
  };

  const closeAdmin = () => {
    setAdminOpen(false);
    setAdminPin('');
    setAdminUnlocked(false);
    setAdminBusy(false);
    setAdminMessage('');
    setAdminResult(null);
  };

  const unlockAdmin = async () => {
    if (!/^\d{4,8}$/.test(adminPin)) {
      setAdminMessage('Enter your 4–8 digit admin PIN.');
      return;
    }

    setAdminBusy(true);
    setAdminMessage('');
    try {
      await runAdminAction(adminPin, 'check-pin');
      setAdminUnlocked(true);
      setAdminMessage('Admin tools unlocked.');
      const health = await getSystemHealth();
      setAdminResult(health);
    } catch (err) {
      setAdminUnlocked(false);
      setAdminMessage(err.message || 'Could not unlock admin tools.');
    } finally {
      setAdminBusy(false);
    }
  };

  const handleSimulation = async () => {
    if (!adminUnlocked || !adminPin || !simulationValid || adminBusy) return;
    setAdminBusy(true);
    setAdminMessage('');
    try {
      const result = await runAdminAction(adminPin, 'simulate-price-change', {
        siteId,
        nodeId: simulationCompetitor,
        fuelType: simulationFuel,
        oldPrice: Number(simulationOldPrice),
        newPrice: Number(simulationNewPrice),
        simulation: true,
      });
      if (!result?.ok || result?.action !== 'simulate-price-change' || !result?.simulation) {
        throw new Error('Simulation is not enabled in the Cloudflare Worker. No simulation has been confirmed.');
      }
      setAdminResult(result);
      setAdminMessage('Simulation request accepted. Check the per-device delivery report.');
    } catch (error) {
      setAdminMessage(error?.message || 'Simulation failed.');
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAdminAction = async (action) => {
    if (!adminUnlocked || !adminPin) return;

    const confirmations = {
      'refresh-full-prices': 'Run the full national price refresh? This is a heavier recovery operation.',
      'refresh-pfs': 'Refresh the full station/PFS dataset now?',
    };
    if (confirmations[action] && !window.confirm(confirmations[action])) return;

    setAdminBusy(true);
    setAdminMessage('');
    try {
      const result =
        action === 'health'
          ? await getSystemHealth()
          : await runAdminAction(adminPin, action);
      setAdminResult(result);
      setAdminMessage('Action completed successfully.');

      if (action === 'refresh-incremental' || action === 'refresh-full-prices') {
        const refreshed = await getSiteComparison(siteId, radius);
        setData(refreshed);
      }
    } catch (err) {
      if (err.status === 401 || err.status === 429) setAdminUnlocked(false);
      setAdminMessage(err.message || 'Admin action failed.');
    } finally {
      setAdminBusy(false);
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

        <div className="top-actions">
          <button
            className={`notification-button ${pushState.subscribed ? 'active' : ''}`}
            onClick={handlePushToggle}
            disabled={pushBusy || pushState.status === 'checking' || pushState.permission === 'denied'}
          >
            {pushBusy
              ? 'Please wait…'
              : pushState.status === 'checking'
                ? '🔔 Checking alerts…'
                : pushState.permission === 'denied'
                  ? '🔕 Alerts blocked'
                  : pushState.status === 'error'
                    ? '⚠️ Check alerts'
                    : pushState.subscribed
                      ? '🔔 Alerts on'
                      : pushState.status === 'needs-action'
                        ? '🔔 Reconnect alerts'
                        : '🔔 Enable alerts'}
          </button>
          <button className="admin-open-button" onClick={() => setAdminOpen(true)}>
            🔒 Admin
          </button>
        </div>
      </header>

      {pushMessage && <div className="push-message">{pushMessage}</div>}
      {!pushMessage && pushState.syncError && (
        <div className="push-message">Alerts are enabled, but preference sync will retry when you reopen the app.</div>
      )}
      {!pushMessage && pushState.status === 'error' && (
        <div className="push-message">Could not verify alerts. Please check your connection and reopen the app.</div>
      )}

      <StationTabs stations={stations} selectedId={siteId} onSelect={setSiteId} />

      {notificationAlert && (
        <section className="price-alert-panel" role="region" aria-label="Price change notification details">
          <div className="price-alert-heading">
            <div>
              <strong>🔔 Price Change Alert</strong>
              <span>{notificationAlert.siteName || site.name}
                {notificationAlert.createdAt && !Number.isNaN(new Date(notificationAlert.createdAt).getTime())
                  ? ' · ' + new Date(notificationAlert.createdAt).toLocaleString('en-GB')
                  : ''}
              </span>
            </div>
            <button type="button" onClick={dismissNotificationAlert} aria-label="Dismiss price alert">✕</button>
          </div>
          {notificationAlert.changes.length ? (
            <div className="price-alert-changes">
              {notificationAlert.changes.map((change, index) => {
                const competitor = data?.competitors?.find((item) => item.id === change.nodeId);
                const difference = Number(change.newPrice) - Number(change.oldPrice);
                return (
                  <div className="price-alert-change" key={change.nodeId + change.fuelType + index}>
                    <strong>{competitor?.name || 'Priority competitor'}</strong>
                    <span>{fuelLabels[change.fuelType] || change.fuelType}</span>
                    <div className="price-alert-amounts">
                      <span>{priceText(change.oldPrice)} → <b>{priceText(change.newPrice)}</b></span>
                      <span className={difference < 0 ? 'price-alert-drop' : difference > 0 ? 'price-alert-rise' : ''}>
                        {difference < 0 ? '↓' : difference > 0 ? '↑' : '–'} {priceText(Math.abs(difference))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p>Change details were unavailable for this notification.</p>
          )}
          <small>Prices shown are from when the alert was sent. The comparison below shows the latest available data.</small>
        </section>
      )}

      <section className="site-toolbar">
        <div className="site-location">
          <strong>{site.name}</strong>
          <span>{site.address}</span>
          {defaultSiteId === siteId ? (
            <span className="default-site-status">★ Default on this device</span>
          ) : (
            <button
              type="button"
              className="default-site-button"
              onClick={makeCurrentSiteDefault}
              title="Open this station automatically on this device"
            >
              ☆ Set as default on this device
            </button>
          )}
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

      {adminOpen && (
        <div className="admin-overlay" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeAdmin();
        }}>
          <section className="admin-panel" role="dialog" aria-modal="true" aria-label="Admin tools">
            <div className="admin-panel-heading">
              <div>
                <strong>Admin tools</strong>
                <span>Fuel Price Monitor maintenance</span>
              </div>
              <button className="admin-close" onClick={closeAdmin} aria-label="Close admin tools">×</button>
            </div>

            {!adminUnlocked ? (
              <div className="admin-unlock">
                <label htmlFor="admin-pin">Admin PIN</label>
                <input
                  id="admin-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={adminPin}
                  maxLength={8}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') unlockAdmin(); }}
                  placeholder="Enter PIN"
                />
                <button className="admin-primary" onClick={unlockAdmin} disabled={adminBusy || !adminPin}>
                  {adminBusy ? 'Checking…' : 'Unlock'}
                </button>
                <small>The PIN is checked by the Cloudflare Worker and is not saved in the app.</small>
              </div>
            ) : (
              <>
                <div className="admin-actions-grid">
                  <button onClick={() => handleAdminAction('refresh-incremental')} disabled={adminBusy}>
                    <strong>Refresh prices now</strong>
                    <span>Incremental • recommended</span>
                  </button>
                  <button onClick={() => handleAdminAction('health')} disabled={adminBusy}>
                    <strong>System health</strong>
                    <span>Refresh status & OAuth</span>
                  </button>
                  <button onClick={() => handleAdminAction('test-push')} disabled={adminBusy}>
                    <strong>Test notification</strong>
                    <span>Send a push test</span>
                  </button>
                  <button onClick={() => handleAdminAction('refresh-pfs')} disabled={adminBusy}>
                    <strong>Refresh stations</strong>
                    <span>PFS dataset • heavier</span>
                  </button>
                  <button className="admin-recovery" onClick={() => handleAdminAction('refresh-full-prices')} disabled={adminBusy}>
                    <strong>Full price refresh</strong>
                    <span>Recovery only • heavy</span>
                  </button>
                </div>
                <div className="admin-unlock" style={{ marginTop: 16 }}>
                  <strong>Simulate a real price change (backend required)</strong>
                  <small>Uses starred competitors for the selected station. Does not edit actual prices. Only works after the Cloudflare simulation endpoint is deployed.</small>
                  <label htmlFor="simulation-competitor">Starred competitor — {site.name}</label>
                  <select id="simulation-competitor" value={simulationCompetitor} onChange={(e) => setSimulationCompetitor(e.target.value)}>
                    <option value="">Choose a starred competitor</option>
                    {simulationCandidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <label htmlFor="simulation-fuel">Fuel type</label>
                  <select id="simulation-fuel" value={simulationFuel} onChange={(e) => setSimulationFuel(e.target.value)}>
                    <option value="E10">E10 petrol</option><option value="E5">E5 petrol</option><option value="B7">B7 diesel</option>
                  </select>
                  <label htmlFor="simulation-old">Previous price (p)</label>
                  <input id="simulation-old" type="number" min="0.1" step="0.1" value={simulationOldPrice} onChange={(e) => setSimulationOldPrice(e.target.value)} />
                  <label htmlFor="simulation-new">New price (p)</label>
                  <input id="simulation-new" type="number" min="0.1" step="0.1" value={simulationNewPrice} onChange={(e) => setSimulationNewPrice(e.target.value)} />
                  <button className="admin-primary" onClick={handleSimulation} disabled={adminBusy || !simulationValid}>Simulate price change</button>
                  <small>SIMULATION — this must not alter Fuel Finder prices or trigger genuine price history.</small>
                </div>
                {adminBusy && <div className="admin-working">Working… please keep this panel open.</div>}
              </>
            )}

            {adminMessage && <div className={`admin-message ${adminMessage.includes('success') || adminMessage.includes('unlocked') ? 'success' : ''}`}>{adminMessage}</div>}

            {adminResult && (
              <details className="admin-result" open>
                <summary>Latest result</summary>
                <pre>{JSON.stringify(adminResult, null, 2)}</pre>
              </details>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
