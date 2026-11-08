import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_RADIUS_MILES, fuelLabels, stations } from './config/stations';
import { getSiteComparison, getSystemHealth, runAdminAction } from './services/api';
import {
  disablePush,
  enablePush,
  getPushState,
  getDeviceCode,
  syncPushPreferences,
} from './services/notifications';
import StationTabs from './components/StationTabs';
import SummaryCards from './components/SummaryCards';
import CompetitorTable from './components/CompetitorTable';
import { consumePendingAlert, getAlertById } from './services/alertInbox';
import './styles.css';

const DEFAULT_SITE_KEY = 'fuel-monitor:default-site:v1';
const SIMULATION_HISTORY_KEY = 'fuel-monitor:simulation-history:v1';
const SIMULATION_REPORT_TTL_MS = 24 * 60 * 60 * 1000;

function readSimulationHistory() {
  try {
    const entries = JSON.parse(localStorage.getItem(SIMULATION_HISTORY_KEY) || '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) =>
      typeof entry?.eventId === 'string' &&
      Number.isFinite(Date.parse(entry.createdAt)) &&
      Date.now() - Date.parse(entry.createdAt) < SIMULATION_REPORT_TTL_MS
    ).slice(0, 10);
  } catch {
    return [];
  }
}


function readDefaultSite() {
  try {
    const saved = localStorage.getItem(DEFAULT_SITE_KEY);
    return stations.some((station) => station.id === saved) ? saved : stations[0].id;
  } catch {
    return stations[0].id;
  }
}

function normaliseNotificationAlert(parsed) {
  if (!stations.some((station) => station.id === parsed?.siteId) || !Array.isArray(parsed?.changes)) return null;
  const changes = parsed.changes.slice(0, 10).filter((change) =>
    change && typeof change.nodeId === 'string' &&
    typeof change.fuelType === 'string' &&
    Number.isFinite(Number(change.oldPrice)) &&
    Number.isFinite(Number(change.newPrice))
  );
  if (!changes.length) return null;
  return {
    siteId: parsed.siteId,
    siteName: String(parsed.siteName || ''),
    createdAt: parsed.createdAt || null,
    simulation: parsed.simulation === true,
    changes,
  };
}

function readNotificationAlert() {
  try {
    const prefix = '#price-alert=';
    if (!window.location.hash.startsWith(prefix)) return null;
    return normaliseNotificationAlert(
      JSON.parse(decodeURIComponent(window.location.hash.slice(prefix.length)))
    );
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
  const [adminSiteId, setAdminSiteId] = useState(readDefaultSite);
  const [adminComparison, setAdminComparison] = useState(null);
  const [adminComparisonLoading, setAdminComparisonLoading] = useState(false);
  const [adminComparisonError, setAdminComparisonError] = useState('');
  const [adminComparisonRetry, setAdminComparisonRetry] = useState(0);
  const [simulationCompetitor, setSimulationCompetitor] = useState('');
  const [simulationFuel, setSimulationFuel] = useState('E10');
  const [simulationOldPrice, setSimulationOldPrice] = useState('139.9');
  const [simulationNewPrice, setSimulationNewPrice] = useState('137.9');
  const [simulationDevices, setSimulationDevices] = useState([]);
  const [selectedSimulationDevices, setSelectedSimulationDevices] = useState([]);
  const [lastSimulationId, setLastSimulationId] = useState('');
  const [simulationHistory, setSimulationHistory] = useState(readSimulationHistory);

  const site = useMemo(() => stations.find((s) => s.id === siteId), [siteId]);
  const adminSite = stations.find((station) => station.id === adminSiteId) || stations[0];
  const simulationCandidates = adminComparison?.siteId === adminSiteId ? adminComparison.competitors : [];
  const simulationValidCompetitor = simulationCandidates.some((item) => item.id === simulationCompetitor);
  const simulationValid = !adminComparisonLoading && !adminComparisonError &&
    simulationValidCompetitor && adminSite.fuels.includes(simulationFuel) && Number(simulationOldPrice) >= 1 &&
    Number(simulationNewPrice) >= 1 && Number(simulationOldPrice) <= 300 &&
    Number(simulationNewPrice) <= 300 &&
    Math.abs(Number(simulationOldPrice) - Number(simulationNewPrice)) >= 0.05 &&
    selectedSimulationDevices.length > 0;

  useEffect(() => {
    let alive = true;
    let latestCheck = 0;
    let checkPromise = null;
    const showAlert = (incoming, id = null) => {
      if (!alive || !incoming) return;
      if (id) {
        const hash = '#price-alert-id=' + encodeURIComponent(id);
        if (window.location.hash !== hash) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
        }
      }
      setNotificationAlert(incoming);
      setSiteId(incoming.siteId);
    };
    const handleAlertLink = () => {
      if (checkPromise) return checkPromise;
      checkPromise = (async () => {
      const check = ++latestCheck;
      // Pending tap takes precedence over an older URL/hash on resumed iOS PWAs.
      const pending = await consumePendingAlert();
      if (!alive || check !== latestCheck) return;
      if (pending) {
        const details = normaliseNotificationAlert(pending.details) ||
          normaliseNotificationAlert(await getAlertById(pending.id));
        if (!alive || check !== latestCheck) return;
        if (details) {
          showAlert(details, pending.id);
          return;
        }
      }
      const prefix = '#price-alert-id=';
      if (window.location.hash.startsWith(prefix)) {
        const id = decodeURIComponent(window.location.hash.slice(prefix.length));
        const details = normaliseNotificationAlert(await getAlertById(id));
        if (!alive || check !== latestCheck) return;
        if (details) showAlert(details);
        return;
      }
      showAlert(readNotificationAlert());
      })().finally(() => { checkPromise = null; });
      return checkPromise;
    };
    const handleWorkerMessage = (event) => {
      if (event.data?.type !== 'fuel-price-alert-open') return;
      const incoming = normaliseNotificationAlert(event.data.details);
      if (incoming) {
        ++latestCheck;
        showAlert(incoming, event.data.id);
      } else {
        void handleAlertLink();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void handleAlertLink();
    };
    window.addEventListener('hashchange', handleAlertLink);
    window.addEventListener('pageshow', handleAlertLink);
    window.addEventListener('focus', handleAlertLink);
    document.addEventListener('visibilitychange', handleVisibility);
    navigator.serviceWorker?.addEventListener('message', handleWorkerMessage);
    void handleAlertLink();
    return () => {
      alive = false;
      window.removeEventListener('hashchange', handleAlertLink);
      window.removeEventListener('pageshow', handleAlertLink);
      window.removeEventListener('focus', handleAlertLink);
      document.removeEventListener('visibilitychange', handleVisibility);
      navigator.serviceWorker?.removeEventListener('message', handleWorkerMessage);
    };
  }, []);

  useEffect(() => {
    if (!adminOpen || !adminUnlocked) return;
    let active = true;
    setAdminComparison(null);
    setAdminComparisonLoading(true);
    setAdminComparisonError('');
    getSiteComparison(adminSiteId, 15)
      .then((comparison) => {
        if (active) setAdminComparison({ siteId: adminSiteId, competitors: comparison.competitors || [] });
      })
      .catch((error) => {
        if (active) setAdminComparisonError(error?.message || 'Could not load competitors for this station.');
      })
      .finally(() => { if (active) setAdminComparisonLoading(false); });
    return () => { active = false; };
  }, [adminOpen, adminUnlocked, adminSiteId, adminComparisonRetry]);

  const changeAdminSite = (nextSiteId) => {
    const nextSite = stations.find((station) => station.id === nextSiteId);
    if (!nextSite) return;
    setAdminSiteId(nextSiteId);
    setAdminComparison(null);
    setSimulationCompetitor('');
    setSimulationFuel(nextSite.fuels[0]);
    setSimulationDevices([]);
    setSelectedSimulationDevices([]);
    setLastSimulationId('');
    setAdminMessage('');
    setAdminResult(null);
  };

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
    setSimulationCompetitor('');
    setSimulationDevices([]);
    setSelectedSimulationDevices([]);
    setLastSimulationId('');
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
    setAdminComparison(null);
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

  const loadSimulationDevices = async () => {
    if (!adminUnlocked || !adminPin || !simulationValidCompetitor || adminBusy || adminComparisonLoading) return;
    setAdminBusy(true);
    setAdminMessage('');
    try {
      if (pushState.subscribed) await syncPushPreferences(readPriorityMap());
      const result = await runAdminAction(adminPin, 'list-push-devices', {
        siteId: adminSiteId, nodeId: simulationCompetitor,
      });
      setSimulationDevices(result.devices || []);
      setSelectedSimulationDevices([]);
      setAdminMessage('Select the devices to test. Only starred competitors are eligible for delivery.');
    } catch (error) {
      setAdminMessage(error?.message || 'Could not load registered devices.');
    } finally {
      setAdminBusy(false);
    }
  };

  const rememberSimulation = (result) => {
    if (!result?.eventId) return;
    setSimulationHistory((current) => {
      const next = [result, ...current.filter((entry) => entry.eventId !== result.eventId)]
        .filter((entry) => Date.now() - Date.parse(entry.createdAt) < SIMULATION_REPORT_TTL_MS)
        .slice(0, 10);
      try { localStorage.setItem(SIMULATION_HISTORY_KEY, JSON.stringify(next)); } catch {
        // History remains available for this session when storage is disabled.
      }
      return next;
    });
  };

  const loadSimulationReport = async (simulationId = lastSimulationId) => {
    if (!simulationId || adminBusy) return;
    setAdminBusy(true);
    try {
      const result = await runAdminAction(adminPin, 'simulation-report', {
        simulationId,
      });
      rememberSimulation(result);
      setAdminResult(result);
      setAdminMessage('Delivery report refreshed. Push acceptance does not guarantee device receipt.');
    } catch (error) {
      setAdminMessage(error?.message || 'Could not load simulation report.');
    } finally {
      setAdminBusy(false);
    }
  };

  const handleSimulation = async () => {
    if (!adminUnlocked || !adminPin || !simulationValid || adminBusy) return;
    if (!window.confirm(`Send a clearly marked simulated price alert to ${selectedSimulationDevices.length} selected subscription(s)? No real prices will change.`)) return;
    setAdminBusy(true);
    setAdminMessage('');
    try {
      const result = await runAdminAction(adminPin, 'simulate-price-change', {
        siteId: adminSiteId,
        nodeId: simulationCompetitor,
        fuelType: simulationFuel,
        oldPrice: Number(simulationOldPrice),
        newPrice: Number(simulationNewPrice),
        simulation: true,
        targetDeviceIds: selectedSimulationDevices,
      });
      if (!result?.ok || result?.action !== 'simulate-price-change' || !result?.simulation) {
        throw new Error('Simulation is not enabled in the Cloudflare Worker. No simulation has been confirmed.');
      }
      setAdminResult(result);
      rememberSimulation(result);
      setLastSimulationId(result.eventId);
      setAdminMessage(`Simulation sent: ${result.sent} accepted, ${result.failed} failed, ${result.excluded} not eligible. Check delivery report after a few seconds.`);
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
          <button className="admin-open-button" onClick={() => { changeAdminSite(siteId); setAdminOpen(true); }}>
            🔒 Admin
          </button>
        </div>
      </header>

      {pushState.subscribed && <div className="device-code">This phone's test code: <strong>{getDeviceCode().slice(0, 8)}</strong></div>}
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
              <strong>{notificationAlert.simulation ? '🧪 SIMULATION — Price Change Alert' : '🔔 Price Change Alert'}</strong>
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
          <small>{notificationAlert.simulation ? 'SIMULATED PRICES ONLY — no actual fuel prices were changed.' : 'Prices shown are from when the alert was sent. The comparison below shows the latest available data.'}</small>
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
                  <strong>🧪 Full price-change simulation</strong>
                  <small>Choose a station independently of the dashboard. Priority eligibility is checked for the selected station on each phone.</small>
                  <label htmlFor="simulation-site">Service station to test</label>
                  <select id="simulation-site" value={adminSiteId} disabled={adminBusy}
                    onChange={(event) => changeAdminSite(event.target.value)}>
                    {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                  </select>
                  {adminComparisonLoading && <small role="status">Loading competitors for {adminSite.name}…</small>}
                  {adminComparisonError && (
                    <div className="admin-message" role="alert">
                      {adminComparisonError}
                      <button type="button" onClick={() => setAdminComparisonRetry((value) => value + 1)}>Retry</button>
                    </div>
                  )}
                  <label htmlFor="simulation-competitor">Competitor near {adminSite.name}</label>
                  <select id="simulation-competitor" value={simulationCompetitor} disabled={adminComparisonLoading || !!adminComparisonError || adminBusy} onChange={(e) => {
                    setSimulationCompetitor(e.target.value);
                    setSimulationDevices([]);
                    setSelectedSimulationDevices([]);
                  }}>
                    <option value="">Choose competitor</option>
                    {simulationCandidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <button type="button" onClick={loadSimulationDevices} disabled={adminBusy || !simulationValidCompetitor || adminComparisonLoading}>1. Load registered devices</button>
                  {simulationDevices.length > 0 && (
                    <div className="simulation-device-list">
                      <strong>2. Select devices to test — {adminSite.shortName}</strong>
                      <small>Match each code with the one shown on that phone. Leave Samsung S23 unchecked.</small>
                      {simulationDevices.map((device) => (
                        <label key={device.id} className="simulation-device-option">
                          <input type="checkbox" checked={selectedSimulationDevices.includes(device.id)}
                            onChange={(e) => setSelectedSimulationDevices((current) => e.target.checked
                              ? [...current, device.id]
                              : current.filter((id) => id !== device.id))} />
                          <span>{device.platform || device.provider} · Code {device.deviceId ? device.deviceId.slice(0, 8) : 'not yet synced'} · {device.shortId}
                            <small>{device.prioritySelected ? '⭐ Eligible — competitor starred' : 'Not starred on this device — will be excluded'}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  <label htmlFor="simulation-fuel">Fuel type</label>
                  <select id="simulation-fuel" value={simulationFuel} onChange={(e) => setSimulationFuel(e.target.value)}>
                    {adminSite.fuels.map((fuel) => <option key={fuel} value={fuel}>{fuelLabels[fuel] || fuel}</option>)}
                  </select>
                  <label htmlFor="simulation-old">Previous price (p)</label>
                  <input id="simulation-old" type="number" min="1" max="300" step="0.1" value={simulationOldPrice} onChange={(e) => setSimulationOldPrice(e.target.value)} />
                  <label htmlFor="simulation-new">New price (p)</label>
                  <input id="simulation-new" type="number" min="1" max="300" step="0.1" value={simulationNewPrice} onChange={(e) => setSimulationNewPrice(e.target.value)} />
                  <button className="admin-primary" onClick={handleSimulation} disabled={adminBusy || !simulationValid}>3. Send simulated price change for {adminSite.shortName}</button>
                  {lastSimulationId && <button type="button" onClick={() => loadSimulationReport()} disabled={adminBusy}>4. Refresh per-device delivery report</button>}
                  <small>SIMULATION ONLY. Push-service acceptance is not proof of phone delivery; look for retrieved/displayed acknowledgements.</small>
                </div>
                {simulationHistory.length > 0 && (
                  <section className="simulation-history" aria-label="Previous simulation reports">
                    <strong>🧪 Simulation history — last 24 hours</strong>
                    <small>Each test has its own report. Open a test to inspect or refresh its device acknowledgements.</small>
                    {simulationHistory.map((entry, index) => (
                      <details className="simulation-history-entry" key={entry.eventId}>
                        <summary>
                          <span>Push {simulationHistory.length - index} · {entry.competitorName || entry.siteId} · {entry.fuelType}</span>
                          <small>{Number(entry.oldPrice).toFixed(1)}p → {Number(entry.newPrice).toFixed(1)}p · {new Date(entry.createdAt).toLocaleString('en-GB')}</small>
                        </summary>
                        <div className="simulation-history-content">
                          <div>Accepted: <strong>{entry.sent ?? '—'}</strong> · Failed: {entry.failed ?? '—'} · Excluded: {entry.excluded ?? '—'}</div>
                          {(entry.devices || []).map((device) => (
                            <div className="simulation-history-device" key={device.id}>
                              <strong>{device.platform || device.provider || 'Device'} · {device.deviceId?.slice(0, 8) || device.shortId}</strong>
                              <span>{!device.eligible ? 'Not eligible' : device.accepted ? 'Push accepted' : 'Push failed'}
                                {device.status ? ' (HTTP ' + device.status + ')' : ''}
                                {device.acknowledgements?.displayed ? ' · Display acknowledged' : device.acknowledgements?.retrieved ? ' · Retrieved' : ' · No display acknowledgement yet'}
                              </span>
                            </div>
                          ))}
                          <button type="button" onClick={() => loadSimulationReport(entry.eventId)} disabled={adminBusy}>
                            Refresh this test's delivery report
                          </button>
                          <details className="admin-result">
                            <summary>View this test's JSON</summary>
                            <pre>{JSON.stringify(entry, null, 2)}</pre>
                          </details>
                        </div>
                      </details>
                    ))}
                  </section>
                )}
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
