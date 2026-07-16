/**
 * db/indexedDb.js — IndexedDB 접근 계층 (local-first 저장의 핵심)
 *
 * 스토어 구성:
 *  - 각 리소스(schedule, memo, ...): keyPath 'id'
 *  - settings: keyPath 'key'  (테마, 색상 등)
 *  - blobs: keyPath 'id'      (사진/손글씨/음성 원본 Blob — 오프라인 재생용)
 *  - syncQueue: autoIncrement (동기화 대기 작업)
 *  - meta: keyPath 'key'      (deviceId, lastSyncAt 등)
 */
import { DB_NAME, DB_VERSION, RESOURCES } from '../config.js';

let dbPromise = null;

/** DB 열기 (최초 1회 스토어/인덱스 생성) */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 리소스별 데이터 스토어 + 검색용 인덱스 (요구사항 17)
      RESOURCES.forEach(name => {
        if (db.objectStoreNames.contains(name)) return;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        // 자주 조회하는 필드에 인덱스
        if (['schedule', 'ledgerPersonal', 'ledgerSchool', 'exercise'].includes(name)) {
          store.createIndex('date', 'date', { unique: false });
        }
        if (name === 'cycle') store.createIndex('startDate', 'startDate', { unique: false });
        if (name === 'exerciseItem') store.createIndex('recordId', 'recordId', { unique: false });
        if (name === 'exerciseSet') store.createIndex('itemId', 'itemId', { unique: false });
        if (name === 'routineItem') store.createIndex('routineId', 'routineId', { unique: false });
        if (name === 'routineSet') store.createIndex('routineItemId', 'routineItemId', { unique: false });
        if (name === 'attachment') store.createIndex('ownerId', 'ownerId', { unique: false });
        if (name === 'memoVersion') store.createIndex('memoId', 'memoId', { unique: false });
      });

      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'qid', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 트랜잭션 헬퍼: IDBRequest → Promise */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 저장(있으면 갱신) */
export async function dbPut(store, value) {
  const db = await openDb();
  return promisify(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

/** 단건 조회 */
export async function dbGet(store, key) {
  const db = await openDb();
  return promisify(db.transaction(store, 'readonly').objectStore(store).get(key));
}

/** 전체 조회 */
export async function dbAll(store) {
  const db = await openDb();
  return promisify(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/** 인덱스로 조회 (예: dbByIndex('exerciseItem','recordId', id)) */
export async function dbByIndex(store, indexName, value) {
  const db = await openDb();
  const idx = db.transaction(store, 'readonly').objectStore(store).index(indexName);
  return promisify(idx.getAll(value));
}

/** 실제 삭제 (영구 삭제 시에만 사용, 일반 삭제는 deletedAt 소프트 삭제) */
export async function dbDelete(store, key) {
  const db = await openDb();
  return promisify(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/** 스토어 비우기 */
export async function dbClear(store) {
  const db = await openDb();
  return promisify(db.transaction(store, 'readwrite').objectStore(store).clear());
}

/* ---------------- 리소스 공통 헬퍼 (삭제 필터 포함) ---------------- */

/** 삭제되지 않은 항목만 */
export async function listActive(resource) {
  const all = await dbAll(resource);
  return all.filter(r => !r.deletedAt);
}

/** 휴지통(삭제된) 항목만 */
export async function listDeleted(resource) {
  const all = await dbAll(resource);
  return all.filter(r => !!r.deletedAt);
}

/* ---------------- meta / settings ---------------- */

export async function getMeta(key) {
  const row = await dbGet('meta', key);
  return row ? row.value : null;
}
export async function setMeta(key, value) {
  return dbPut('meta', { key, value });
}
export async function getSettingLocal(key, fallback = null) {
  const row = await dbGet('settings', key);
  return row ? row.value : fallback;
}
export async function setSettingLocal(key, value) {
  return dbPut('settings', { key, value });
}
export async function allSettingsLocal() {
  const rows = await dbAll('settings');
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}
