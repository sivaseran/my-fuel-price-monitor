const API_BASE = 'https://fuel-price-monitor-api.5sivas01.workers.dev';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A fetch handler helps browsers recognise this as an active PWA while keeping
// all requests network-first so live fuel prices are never served from a stale cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let alert = {
      title: 'Fuel Price Monitor',
      body: 'A priority competitor changed a fuel price.',
    };

    try {
      const subscription = await self.registration.pushManager.getSubscription();
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
          if (payload?.alert) alert = payload.alert;
        }
      }
    } catch {
      // Show the generic notification if lookup fails.
    }

    const icon = new URL('icons/icon-192.png', self.registration.scope).href;
    const badge = new URL('icons/icon-192.png', self.registration.scope).href;

    await self.registration.showNotification(alert.title || 'Fuel Price Monitor', {
      body: alert.body || 'A priority competitor changed a fuel price.',
      icon,
      badge,
      tag: 'fuel-price-change',
      renotify: true,
      data: {
        url: self.registration.scope,
      },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const target = event.notification.data?.url || self.registration.scope;
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
