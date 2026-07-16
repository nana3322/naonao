/**
 * api/syncService.js — local-first 동기화의 중심
 *
 * 저장 흐름 (요구사항 11):
 *  1) 저장 버튼 → saveLocal() 이 IndexedDB 에 먼저 기록
 *  2) 같은 작업을 syncQueue 에 추가
 *  3) 온라인이면 즉시 flush(), 오프라인이면 대기
 *  4) online 이벤트 발생 시 자동 flush()
 *
 * 상태: 'online' | 'offline' | 'syncing' | 'pending'
 * 구독: onSyncStatus(fn) → fn({status, pendingCount, lastSyncAt})
 */
import { dbPut, dbGet, dbDelete, getMeta, setMeta, dbAll } from '../db/indexedDb.js';
import { queueAdd, queueAll, queueCount, queueRemove } from '../db/syncQueue.js';
import { apiSync, apiList, apiUploadAttachment } from './gasApi.js';
import { RESOURCES } from '../config.js';
import { uuid } from '../utils/uuid.js';
import { toast } from '../components/toast.js';

let deviceId = null;
let listeners = [];
let flushing = false;

/** 기기 식별자 (최초 1회 생성 후 유지) */
export async function getDeviceId() {
  if (deviceId) return deviceId;
  deviceId = await getMeta('deviceId');
  if (!deviceId) {
    deviceId = 'dev-' + uuid();
    await setMeta('deviceId', deviceId);
  }
  return deviceId;
}

/** 동기화 상태 구독 */
export function onSyncStatus(fn) { listeners.push(fn); }

async function emitStatus(status) {
  const pendingCount = await queueCount();
  const lastSyncAt = await getMeta('lastSyncAt');
  const s = status || (!navigator.onLine ? 'offline' : (pendingCount > 0 ? 'pending' : 'online'));
  listeners.forEach(fn => fn({ status: s, pendingCount, lastSyncAt }));
}

/** 외부에서 상태 갱신 요청 */
export function refreshStatus() { return emitStatus(); }

/* ---------------- local-first 저장 API (모든 페이지가 이걸 사용) ---------------- */

/**
 * 생성/수정 공통 저장.
 * record 에 id 가 없으면 새로 만들고 createdAt 을 채운다.
 */
export async function saveLocal(resource, record) {
  const now = new Date().toISOString();
  const dev = await getDeviceId();
  const isNew = !record.id;
  if (isNew) record.id = uuid();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  record.deletedAt = record.deletedAt || '';
  record.syncStatus = 'pending';
  record.deviceId = dev;

  await dbPut(resource, record);
  await queueAdd(isNew ? 'create' : 'update', resource, record);
  flush(); // 온라인이면 즉시 전송 (오프라인이면 내부에서 스킵)
  emitStatus();
  return record;
}

/** 소프트 삭제 (휴지통 이동) */
export async function deleteLocal(resource, id) {
  const rec = await dbGet(resource, id);
  if (!rec) return;
  rec.deletedAt = new Date().toISOString();
  rec.updatedAt = rec.deletedAt;
  rec.syncStatus = 'pending';
  await dbPut(resource, rec);
  await queueAdd('delete', resource, { id });
  flush();
  emitStatus();
}

/** 휴지통 복원 */
export async function restoreLocal(resource, id) {
  const rec = await dbGet(resource, id);
  if (!rec) return;
  rec.deletedAt = '';
  rec.updatedAt = new Date().toISOString();
  rec.syncStatus = 'pending';
  await dbPut(resource, rec);
  await queueAdd('restore', resource, { id });
  flush();
  emitStatus();
}

/** 영구 삭제 */
export async function purgeLocal(resource, id) {
  await dbDelete(resource, id);
  await queueAdd('purge', resource, { id });
  flush();
  emitStatus();
}

/** 첨부 파일 업로드 예약 (Blob 은 blobs 스토어에 이미 저장된 상태) */
export async function queueAttachmentUpload(attachmentId) {
  await queueAdd('uploadAttachment', 'attachment', { id: attachmentId });
  flush();
  emitStatus();
}

/* ---------------- 큐 전송 (flush) ---------------- */

/** 대기 중인 작업을 서버로 전송 */
export async function flush() {
  if (!navigator.onLine || flushing) return;
  const items = await queueAll();
  if (!items.length) { emitStatus(); return; }

  flushing = true;
  emitStatus('syncing');
  const dev = await getDeviceId();

  try {
    // 1) 첨부 업로드는 개별 처리 (파일 크기 때문에 batch 와 분리)
    const uploads = items.filter(i => i.op === 'uploadAttachment');
    for (const item of uploads) {
      try {
        const meta = await dbGet('attachment', item.data.id);
        const blobRow = await dbGet('blobs', item.data.id);
        if (meta && blobRow && blobRow.blob) {
          const result = await apiUploadAttachment({
            id: meta.id, ownerType: meta.ownerType, ownerId: meta.ownerId,
            fileType: meta.fileType, fileName: meta.fileName, mimeType: meta.mimeType
          }, blobRow.blob, dev);
          // Drive 파일 정보 반영 (Blob 은 오프라인 재생용으로 계속 보관)
          meta.driveFileId = result.driveFileId;
          meta.driveUrl = result.driveUrl;
          meta.syncStatus = 'synced';
          await dbPut('attachment', meta);
        }
        await queueRemove(item.qid);
      } catch (e) {
        // 개별 업로드 실패는 큐에 남겨 다음 기회에 재시도
        console.warn('첨부 업로드 실패, 재시도 예정:', e.message);
      }
    }

    // 2) 나머지 CRUD 는 batch sync
    const ops = items.filter(i => i.op !== 'uploadAttachment');
    if (ops.length) {
      const operations = ops.map(i => ({ op: i.op, resource: i.resource, data: i.data, deviceId: dev }));
      const result = await apiSync(operations, dev);

      // 결과 처리: 성공/충돌은 큐에서 제거, 오류는 남겨 재시도
      for (let idx = 0; idx < ops.length; idx++) {
        const item = ops[idx];
        const r = result.results[idx];
        if (!r) continue;
        if (r.status === 'ok') {
          // 서버 기준 최신본으로 로컬 갱신 (updatedAt 서버값 반영)
          if (r.data && r.data.id && item.op !== 'purge') {
            const local = await dbGet(item.resource, r.data.id);
            await dbPut(item.resource, { ...(local || {}), ...r.data, syncStatus: 'synced' });
          }
          await queueRemove(item.qid);
        } else if (r.status === 'conflict') {
          // 충돌: 서버가 더 최신 → 서버본으로 교체하고 사용자에게 안내 (요구사항 11)
          if (r.serverData && r.serverData.id) {
            await dbPut(item.resource, { ...r.serverData, syncStatus: 'synced' });
          }
          await queueRemove(item.qid);
          toast('다른 기기에서 더 최신으로 수정된 항목이 있어 서버 내용을 유지했습니다.', 'warn');
        } else {
          // error: 큐 유지 (다음 flush 에서 재시도)
          console.warn('동기화 실패 항목:', r.message);
          await queueRemove(item.qid); // 영구 실패 반복을 막기 위해 제거하되 안내
          toast('일부 항목 동기화에 실패했습니다: ' + (r.message || ''), 'error');
        }
      }
    }

    await setMeta('lastSyncAt', new Date().toISOString());
  } catch (e) {
    // 네트워크 단절 등 전체 실패: 큐 그대로 유지
    console.warn('동기화 중단:', e.message);
  } finally {
    flushing = false;
    emitStatus();
  }
}

/* ---------------- 서버 → 로컬 pull ---------------- */

/**
 * 서버 데이터 내려받기 (증분).
 * lastPullAt 이후 updatedAt 인 것만 가져와 updatedAt 비교 병합.
 */
export async function pullAll() {
  if (!navigator.onLine) return;
  const since = await getMeta('lastPullAt');
  try {
    for (const resource of RESOURCES) {
      const rows = await apiList(resource, { includeDeleted: true, since: since || null });
      for (const row of rows) {
        if (!row.id) continue;
        const local = await dbGet(resource, row.id);
        // 충돌 정책: updatedAt 이 최신인 쪽 우선
        if (!local || String(row.updatedAt) >= String(local.updatedAt || '')) {
          await dbPut(resource, { ...row, syncStatus: 'synced' });
        }
      }
    }
    await setMeta('lastPullAt', new Date().toISOString());
  } catch (e) {
    console.warn('서버 데이터 내려받기 실패:', e.message);
  }
  emitStatus();
}

/* ---------------- 초기화 ---------------- */

/** 앱 시작 시 1회 호출: 온라인 이벤트 연결 + 초기 동기화 */
export function initSync() {
  window.addEventListener('online', () => { toast('온라인 상태입니다. 동기화를 시작합니다.'); flush(); });
  window.addEventListener('offline', () => { toast('오프라인 상태입니다. 기록은 기기에 저장됩니다.', 'warn'); emitStatus(); });
  // 시작 시: 서버 pull 후 큐 flush
  (async () => {
    await pullAll();
    await flush();
  })();
}
