// Shared IndexedDB inbox for the PWA and its service worker.
// The worker stores notification taps before iOS resumes the app.
const DATABASE = 'fuel-price-monitor-alert-inbox-v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('alerts')) db.createObjectStore('alerts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAlertById(id) {
  if (!id) return null;
  try {
    const db = await openDatabase();
    try {
      return (await readStore(db, 'alerts', id))?.details || null;
    } finally { db.close(); }
  } catch { return null; }
}

export async function consumePendingAlert() {
  try {
    const db = await openDatabase();
    try {
      // One transaction makes read + consume atomic across resume events.
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        const get = store.get('pending');
        let pending = null;
        get.onsuccess = () => {
          const record = get.result;
          if (!record?.consumed && Date.now() - record.clickedAt < 10 * 60 * 1000) {
            pending = record;
            store.put({ ...record, consumed: true });
          }
        };
        tx.oncomplete = () => resolve(pending);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch { return null; }
}
