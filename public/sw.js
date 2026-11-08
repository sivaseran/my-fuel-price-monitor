const API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';

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

    try {
      await self.registration.showNotification(alert.title || 'Fuel Price Monitor', {
      body: alert.body || 'A priority competitor changed a fuel price.',
      icon,
      badge,
      // Give every received push its own notification so consecutive alerts remain visible.
      tag: `fuel-price-change-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      renotify: true,
      data: {
        url: self.registration.scope,
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
    const targetUrl = new URL(event.notification.data?.url || self.registration.scope);
    const details = event.notification.data?.details;
    if (details?.siteId && Array.isArray(details.changes) && details.changes.length) {
      // Use a fragment so the alert payload stays client-side, not in server logs.
      targetUrl.hash = 'price-alert=' + encodeURIComponent(JSON.stringify(details));
    }
    const target = targetUrl.href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      // Only reuse this PWA's own window, not another open page.
      if (!client.url.startsWith(self.registration.scope)) continue;

      // iOS can resume an existing Home Screen app without firing hashchange
      // or pageshow. Deliver the alert directly as well as via the URL.
      const message = { type: 'fuel-price-alert-open', details };
      try { client.postMessage(message); } catch {}

      let opened = client;
      let navigated = false;
      if ('navigate' in client) {
        try {
          opened = await client.navigate(target) || client;
          navigated = true;
        } catch {
          // Some WebKit versions reject navigation during notification clicks.
        }
      }
      let focused = false;
      try {
        if ('focus' in opened) {
          await opened.focus();
          focused = true;
        }
      } catch {
        // The direct message may still be delivered when the app resumes.
      }
      try { opened.postMessage(message); } catch {}
      if (navigated || focused) return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
