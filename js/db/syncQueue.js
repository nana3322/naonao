/**
 * db/syncQueue.js — 동기화 대기열 (IndexedDB 'syncQueue' 스토어)
 * 저장 버튼을 누를 때마다 작업 1건이 여기에 쌓이고,
 * 온라인이 되면 syncService 가 일괄 전송한다.
 */
import { openDb } from './indexedDb.js';

function promisify(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

/** 작업 추가: op = 'create'|'update'|'delete'|'restore'|'purge'|'uploadAttachment' */
export async function queueAdd(op, resource, data) {
  const db = await openDb();
  const item = { op, resource, data, queuedAt: new Date().toISOString() };
  return promisify(db.transaction('syncQueue', 'readwrite').objectStore('syncQueue').add(item));
}

/** 대기 작업 전체 */
export async function queueAll() {
  const db = await openDb();
  return promisify(db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll());
}

/** 대기 건수 */
export async function queueCount() {
  const db = await openDb();
  return promisify(db.transaction('syncQueue', 'readonly').objectStore('syncQueue').count());
}

/** 처리 완료된 작업 제거 */
export async function queueRemove(qid) {
  const db = await openDb();
  return promisify(db.transaction('syncQueue', 'readwrite').objectStore('syncQueue').delete(qid));
}

/** 전체 비우기 (복원 등 특수 상황용) */
export async function queueClear() {
  const db = await openDb();
  return promisify(db.transaction('syncQueue', 'readwrite').objectStore('syncQueue').clear());
}
