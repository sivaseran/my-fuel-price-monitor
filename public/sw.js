const API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';


// Store each push and tap before iOS opens/resumes the Home Screen PWA.
// IndexedDB is shared by this service worker and the app on the same origin.
const ALERT_DB = 'fuel-price-monitor-alert-inbox-v1';
function openAlertDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ALERT_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('alerts')) db.createObjectStore('alerts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function writeAlert(id, details) {
  if (!id || !details?.siteId) return;
  const db = await openAlertDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('alerts', 'readwrite');
      tx.objectStore('alerts').put({ id, details, savedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function readAlert(id) {
  if (!id) return null;
  const db = await openAlertDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('alerts', 'readonly');
      const request = tx.objectStore('alerts').get(id);
      request.onsuccess = () => resolve(request.result?.details || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function writePendingClick(id, details) {
  const db = await openAlertDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'pending', id, details, clickedAt: Date.now(), consumed: false });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch handler helps browsers recognise this as an active PWA while keeping
// all requests network-first so live fuel prices are never served from a stale cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});

async function acknowledgeAlert(endpoint, alertId, phase) {
  if (!endpoint || !alertId) return;
  try {
    await fetch(`${API_BASE}/push/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, alertId, phase }),
    });
  } catch {
    // Diagnostics must never prevent a notification from being displayed.
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let alert = {
      title: 'Fuel Price Monitor',
      body: 'A priority competitor changed a fuel price.',
    };

    let endpoint = null;
    let receivedPayload = false;
    try {
      // New Workers send the complete alert inside the encrypted Web Push
      // payload. Do not fetch /push/latest: a newer alert may overwrite it.
      const payload = event.data?.json();
      if (payload?.alert?.id && typeof payload.alert.title === 'string') {
        alert = payload.alert;
        receivedPayload = true;
      }
    } catch {
      // Older empty-payload pushes still use the legacy lookup below.
    }
    try {
      const subscription = await self.registration.pushManager.getSubscription();
      endpoint = subscription?.endpoint || null;
      if (subscription && !receivedPayload) {
        const response = await fetch(`${API_BASE}/push/latest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.alert) alert = payload.alert;
        }
      }
    } catch {
      // If the legacy lookup fails, show the generic notification.
    }

    const icon = new URL('icons/icon-192.png', self.registration.scope).href;
    const badge = new URL('icons/icon-192.png', self.registration.scope).href;

    // Keep the exact change details with the notification, even if the backend
    // receives a newer alert before this notification is opened.
    const details = alert?.test ? null : {
      simulation: alert?.simulation === true,
      siteId: alert?.siteId,
      siteName: alert?.siteName,
      createdAt: alert?.createdAt,
      changes: Array.isArray(alert?.changes) ? alert.changes.slice(0, 10) : [],
    };

    const alertId = alert?.id || crypto.randomUUID();
    try {
      // The persisted alert is a fallback when iOS loses the click's message
      // or cannot navigate a running PWA on the first tap.
      try { await writeAlert(alertId, details); } catch {}
      await self.registration.showNotification(alert.title || 'Fuel Price Monitor', {
      body: alert.body || 'A priority competitor changed a fuel price.',
      icon,
      badge,
      // Give every received push its own notification so consecutive alerts remain visible.
      tag: `fuel-price-change-${alertId}`,
      renotify: true,
      data: {
        url: self.registration.scope,
        alertId,
        details,
      },
      });
      await Promise.all([acknowledgeAlert(endpoint, alert?.id, 'retrieved'), acknowledgeAlert(endpoint, alert?.id, 'displayed')]);
    } catch (error) {
      await acknowledgeAlert(endpoint, alert?.id, 'display-failed');
      throw error;
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const notificationData = event.notification.data || {};
    const alertId = notificationData.alertId ||
      (event.notification.tag?.startsWith('fuel-price-change-')
        ? event.notification.tag.slice('fuel-price-change-'.length)
        : crypto.randomUUID());
    let details = notificationData.details;
    if (!details?.changes?.length) {
      try { details = await readAlert(alertId); } catch {}
    }

    // Persist the tap BEFORE focusing/navigating. iOS can resume the app
    // before postMessage or hashchange is delivered.
    try { await writePendingClick(alertId, details); } catch {}

    const targetUrl = new URL(notificationData.url || self.registration.scope);
    targetUrl.hash = 'price-alert-id=' + encodeURIComponent(alertId);
    const target = targetUrl.href;
    const message = { type: 'fuel-price-alert-open', id: alertId, details };
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windows) {
      if (!client.url.startsWith(self.registration.scope)) continue;
      try { client.postMessage(message); } catch {}
      let opened = client;
      try {
        if ('navigate' in client) opened = await client.navigate(target) || client;
      } catch {}
      try { if ('focus' in opened) await opened.focus(); } catch {}
      try { opened.postMessage(message); } catch {}
      // The pending record survives even if every iOS event above was missed.
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
