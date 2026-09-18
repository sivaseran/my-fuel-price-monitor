const API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';

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

export async function getPushState() {
  if (!pushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }

  try {
    const registration = await registerServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: Boolean(subscription),
    };
  } catch {
    return {
      supported: true,
      permission: Notification.permission,
      subscribed: false,
    };
  }
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
      rules: {
        anyPriceChange: true,
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not save notification preferences.');
  }
  return payload;
}

export async function enablePush(priorityBySite) {
  if (!pushSupported()) {
    throw new Error(
      'Push notifications are not supported here. On iPhone/iPad, add this app to the Home Screen first.'
    );
  }

  const permission = await Notification.requestPermission();
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

  await postSubscription('/push/subscribe', subscription, priorityBySite);
  return subscription;
}

export async function syncPushPreferences(priorityBySite) {
  if (!pushSupported()) return false;

  const registration = await registerServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  await postSubscription('/push/subscribe', subscription, priorityBySite);
  return true;
}

export async function disablePush() {
  if (!pushSupported()) return;

  const registration = await registerServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await fetch(`${API_BASE}/push/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe();
  }
}
