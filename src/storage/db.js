// تخزين المشاريع والملفات في IndexedDB (يعمل بلا إنترنت)
const DB_NAME = 'nabd';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const saveProject = (p) => tx('projects', 'readwrite', (s) => s.put(p));
export const loadProject = (id) => tx('projects', 'readonly', (s) => s.get(id));
export const deleteProjectRecord = (id) => tx('projects', 'readwrite', (s) => s.delete(id));
export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export const putBlob = (key, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, key));
export const getBlob = (key) => tx('blobs', 'readonly', (s) => s.get(key));
export const deleteBlob = (key) => tx('blobs', 'readwrite', (s) => s.delete(key));
export const setMeta = (key, v) => tx('meta', 'readwrite', (s) => s.put(v, key));
export const getMeta = (key) => tx('meta', 'readonly', (s) => s.get(key));

export async function deleteProject(p) {
  for (const a of p.assets || []) if (a.blobKey) await deleteBlob(a.blobKey).catch(() => {});
  for (const l of p.layers || []) for (const f of l.frames || []) if (f.blobKey) await deleteBlob(f.blobKey).catch(() => {});
  await deleteProjectRecord(p.id);
}

/** طلب تخزين دائم حتى لا يمسح المتصفح المشاريع */
export async function requestPersist() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
