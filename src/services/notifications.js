const API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';
const ALERTS_ENABLED_KEY = 'fuel-monitor:alerts-enabled:v1';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let lastSyncedEndpoint = '';
let lastSyncedAt = 0;
let stateCheckPromise = null;

function readAlertIntent() {
  try {
    return localStorage.getItem(ALERTS_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveAlertIntent(enabled) {
  try {
    localStorage.setItem(ALERTS_ENABLED_KEY, String(enabled));
  } catch {
    // A working push subscription remains authoritative if storage is unavailable.
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported on this device.');
  }

  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  const registration = await navigator.serviceWorker.register(swUrl, {
    scope: import.meta.env.BASE_URL,
  });

  await navigator.serviceWorker.ready;
  return registration;
}

async function getPushConfig() {
  const response = await fetch(`${API_BASE}/push/config`, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Push notification setup is not ready yet.');
  }

  if (!payload.configured || !payload.publicKey) {
    throw new Error('Push notification keys are not configured in Cloudflare yet.');
  }

  return payload;
}

async function postSubscription(path, subscription, priorityBySite) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      subscription: subscription?.toJSON ? subscription.toJSON() : subscription,
      priorityBySite,
      rules: { anyPriceChange: true },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not save notification preferences.');
  }
  return payload;
}

async function syncExistingSubscription(subscription, priorityBySite, force = false) {
  if (!priorityBySite) return;
  if (
    !force &&
    subscription.endpoint === lastSyncedEndpoint &&
    Date.now() - lastSyncedAt < SYNC_INTERVAL_MS
  ) {
    return;
  }

  await postSubscription('/push/subscribe', subscription, priorityBySite);
  lastSyncedEndpoint = subscription.endpoint;
  lastSyncedAt = Date.now();
}

async function checkPushState(priorityBySite) {
  if (!pushSupported()) {
    return {
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      status: 'unsupported',
    };
  }

  const permission = Notification.permission;
  if (permission === 'denied') {
    return {
      supported: true,
      permission,
      subscribed: false,
      status: 'blocked',
    };
  }

  let registration;
  let subscription;
  try {
    registration = await registerServiceWorker();
    subscription = await registration.pushManager.getSubscription();
  } catch (error) {
    // A temporary service-worker failure must not be mistaken for alerts OFF.
    return {
      supported: true,
      permission,
      subscribed: false,
      status: 'error',
      error: error?.message || 'Could not check Android notification status.',
    };
  }

  if (!subscription && readAlertIntent() && permission === 'granted') {
    // Only restore a subscription when the user previously opted in.
    // Never request notification permission automatically on app startup.
    try {
      const config = await getPushConfig();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
    } catch (error) {
      return {
        supported: true,
        permission,
        subscribed: false,
        status: 'needs-action',
        error: error?.message || 'Tap to reconnect alerts on this device.',
      };
    }
  }

  if (!subscription) {
    return {
      supported: true,
      permission,
      subscribed: false,
      status: readAlertIntent() ? 'needs-action' : 'off',
    };
  }

  // The actual browser subscription is the source of truth.
  saveAlertIntent(true);

  try {
    await syncExistingSubscription(subscription, priorityBySite);
  } catch (error) {
    // Backend sync failure must not incorrectly display alerts as OFF.
    return {
      supported: true,
      permission,
      subscribed: true,
      status: 'on',
      syncError: error?.message || 'Could not sync alert preferences.',
    };
  }

  return {
    supported: true,
    permission,
    subscribed: true,
    status: 'on',
  };
}

export function getPushState(priorityBySite) {
  // React StrictMode and Android focus events can request the same check twice.
  if (!stateCheckPromise) {
    stateCheckPromise = checkPushState(priorityBySite).finally(() => {
      stateCheckPromise = null;
    });
  }
  return stateCheckPromise;
}

export async function enablePush(priorityBySite) {
  if (!pushSupported()) {
    throw new Error(
      'Push notifications are not supported here. On iPhone/iPad, add this app to the Home Screen first.'
    );
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const [registration, config] = await Promise.all([
    registerServiceWorker(),
    getPushConfig(),
  ]);

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }

  saveAlertIntent(true);
  await syncExistingSubscription(subscription, priorityBySite, true);
  return subscription;
}

export async function syncPushPreferences(priorityBySite) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;

  const registration = await registerServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  await syncExistingSubscription(subscription, priorityBySite, true);
  return true;
}

export async function disablePush() {
  if (!pushSupported()) {
    saveAlertIntent(false);
    return;
  }

  const registration = await registerServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    saveAlertIntent(false);
    return;
  }

  try {
    await fetch(`${API_BASE}/push/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch {
    // Local unsubscribe is still required when the backend is unreachable.
  }

  const unsubscribed = await subscription.unsubscribe();
  if (!unsubscribed) {
    throw new Error('Android could not turn off the push subscription. Please try again.');
  }

  saveAlertIntent(false);
  lastSyncedEndpoint = '';
  lastSyncedAt = 0;
}
