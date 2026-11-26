// إرسال الحركة المصدَّرة إلى برنامج الفيديو (نفس النطاق) عبر صندوق وارد مشترك في IndexedDB
export function sendToInbox({ name, blob, duration }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shared-media-inbox', 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' }); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const id = 'haraka_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const type = blob.type.startsWith('video/') ? 'video' : (blob.type === 'image/gif' || blob.type === 'image/webp') ? 'anim' : 'image';
      const tx = db.transaction('items', 'readwrite');
      tx.objectStore('items').put({ id, name, type, mime: blob.type, blob, duration, created: Date.now(), from: 'haraka' });
      tx.oncomplete = () => {
        try { const bc = new BroadcastChannel('shared-media-inbox'); bc.postMessage({ type: 'new-item', id }); bc.close(); } catch {}
        db.close();
        resolve(id);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
