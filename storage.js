// Persistência local em IndexedDB. Sem servidor: os dados ficam só neste aparelho.
const DB = 'batera-no-click', VER = 1;
let dbp = null;
const mem = { kv: {}, sessions: [] };

function open() {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    if (!('indexedDB' in window)) return res(null);
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null); // modo privado etc.: cai pra memória
  });
  return dbp;
}

function req(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r ? r.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export async function kvGet(key) {
  const db = await open();
  if (!db) return mem.kv[key];
  return req(db, 'kv', 'readonly', s => s.get(key));
}
export async function kvSet(key, val) {
  const db = await open();
  if (!db) { mem.kv[key] = val; return; }
  // clone estruturado: grava uma cópia, nunca a referência viva
  await req(db, 'kv', 'readwrite', s => s.put(JSON.parse(JSON.stringify(val)), key));
}
export async function addSession(sess) {
  const db = await open();
  if (!db) { sess.id = mem.sessions.length + 1; mem.sessions.push(sess); return sess.id; }
  return req(db, 'sessions', 'readwrite', s => s.add(sess));
}
export async function allSessions() {
  const db = await open();
  if (!db) return [...mem.sessions];
  const list = await req(db, 'sessions', 'readonly', s => s.getAll());
  return (list || []).sort((a, b) => a.ts - b.ts);
}
export async function clearAll() {
  const db = await open();
  mem.kv = {}; mem.sessions = [];
  if (!db) return;
  await req(db, 'kv', 'readwrite', s => s.clear());
  await req(db, 'sessions', 'readwrite', s => s.clear());
}
export async function isVolatile() { return !(await open()); }
// Pede pro navegador não apagar os dados em caso de pouco espaço
export function requestPersist() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
