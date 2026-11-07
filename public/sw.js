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
    try {
      const subscription = await self.registration.pushManager.getSubscription();
      endpoint = subscription?.endpoint || null;
      if (subscription) {
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
          if (payload?.alert) {
            alert = payload.alert;
            await acknowledgeAlert(endpoint, alert.id, 'retrieved');
          }
        }
      }
    } catch {
      // Show the generic notification if lookup fails.
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
      await acknowledgeAlert(endpoint, alert?.id, 'displayed');
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
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
