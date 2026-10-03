/**
 * 화면 미러링 - 기기 목록 저장용 Apps Script
 * 사용법: 구글 시트 > 확장 프로그램 > Apps Script 에 붙여넣기
 *        배포 > 새 배포 > 웹 앱 > 액세스: "모든 사용자" > 배포 후 /exec URL 복사
 * 시트 이름 '기기' 는 자동 생성됩니다. (열: 이름 | IP | 포트 | 상태 | 갱신시각)
 */
const SHEET_NAME = '기기';
const STALE_MS = 70 * 60 * 1000;   // 30분 갱신 기준, 70분 지나면 목록에서 숨김

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['이름', 'IP', '포트', '상태', '갱신시각']);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || 'list';

  if (action === 'update') {
    const name = String(p.name || '').trim();
    if (!name) return out_({ ok: false, error: 'no name' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sh = getSheet_();
      const last = sh.getLastRow();
      let row = -1;
      if (last >= 2) {
        const names = sh.getRange(2, 1, last - 1, 1).getValues();
        for (let i = 0; i < names.length; i++) {
          if (String(names[i][0]) === name) { row = i + 2; break; }
        }
      }
      if (row < 0) row = last + 1;
      sh.getRange(row, 1, 1, 5).setValues([[
        name, p.ip || '', Number(p.port) || 8080,
        p.on === '1' ? '켜짐' : '꺼짐', Date.now()
      ]]);
      CacheService.getScriptCache().remove('list');
    } finally {
      lock.releaseLock();
    }
    return out_({ ok: true });
  }

  // list: 켜짐 + 최근 갱신된 기기만 (20초 캐시로 요청 부하 최소화)
  const cache = CacheService.getScriptCache();
  const cached = cache.get('list');
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const sh = getSheet_();
  const last = sh.getLastRow();
  const devices = [];
  if (last >= 2) {
    const rows = sh.getRange(2, 1, last - 1, 5).getValues();
    const now = Date.now();
    rows.forEach(r => {
      if (r[3] === '켜짐' && r[1] && now - Number(r[4]) < STALE_MS) {
        devices.push({ name: String(r[0]), ip: String(r[1]), port: Number(r[2]) });
      }
    });
  }
  const json = JSON.stringify({ ok: true, devices: devices });
  cache.put('list', json, 20);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
