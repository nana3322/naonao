/**
 * api/gasApi.js — Google Apps Script API 클라이언트
 *
 * [중요] Apps Script 웹앱은 CORS 프리플라이트를 처리하지 못하므로
 * Content-Type 을 'text/plain;charset=utf-8' 로 보내 단순 요청으로 만든다.
 * 본문은 JSON 문자열이며 token 을 항상 포함한다.
 */
import { GAS_URL, API_TOKEN } from '../config.js';

/** 공통 요청. action + 추가 필드 → { success, data } 의 data 반환 */
export async function apiRequest(action, payload = {}) {
  const body = JSON.stringify({ token: API_TOKEN, action, ...payload });
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
  const json = await res.json();
  if (!json.success) {
    const msg = json.error ? json.error.message : '알 수 없는 서버 오류';
    const err = new Error(msg);
    err.code = json.error ? json.error.code : 'UNKNOWN';
    throw err;
  }
  return json.data;
}

/** 연결 확인 */
export function apiPing() { return apiRequest('ping'); }

/** 목록 (since: 증분 동기화용 ISO 시각) */
export function apiList(resource, opts = {}) {
  return apiRequest('list', { resource, ...opts });
}

/** 일괄 동기화 */
export function apiSync(operations, deviceId) {
  return apiRequest('sync', { operations, deviceId });
}

/** 첨부 파일 업로드 (Blob → base64 → Drive) */
export async function apiUploadAttachment(meta, blob, deviceId) {
  const base64 = await blobToBase64(blob);
  return apiRequest('uploadAttachment', {
    deviceId,
    data: { ...meta, base64 }
  });
}

/** 백업 / 복원 / 시트 복사본 */
export function apiBackup() { return apiRequest('backup'); }
export function apiImport(backup, mode) { return apiRequest('importData', { backup, mode }); }
export function apiBackupCopy() { return apiRequest('createBackupCopy'); }

/** Blob → base64 문자열 (data URL 접두사 제거) */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
