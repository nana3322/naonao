/**
 * pages/settings.js — 설정 (요구사항 10)
 *  화면 설정 / 카테고리 관리(접힘) / 가계부 색상 / 주기 설정 /
 *  동기화 및 데이터(백업·복원·시트 복사본) / 휴지통
 */
import { listActive, listDeleted, dbAll, dbGet, getMeta, allSettingsLocal, setSettingLocal } from '../db/indexedDb.js';
import { saveLocal, deleteLocal, restoreLocal, purgeLocal, flush, refreshStatus, onSyncStatus } from '../api/syncService.js';
import { queueCount } from '../db/syncQueue.js';
import { apiBackup, apiImport, apiBackupCopy } from '../api/gasApi.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, button, getSetting, saveSetting, applyTheme, emptyState } from '../state.js';
import { COLOR_NAMES, COLOR_MAP, RESOURCES } from '../config.js';
import { formatIsoShort } from '../utils/date.js';
import { openRoutineEditor } from './exercise.js';

let container = null;

export async function renderSettings(root) {
  container = root;
  root.innerHTML = '';

  /* ================= 화면 설정 ================= */
  const themeSec = section('화면 설정');
  const themeNow = await getSetting('theme');
  const themeRow = document.createElement('div');
  themeRow.className = 'theme-row';
  [['light', '라이트'], ['dark', '다크'], ['system', '시스템 설정 따르기']].forEach(([v, t]) => {
    const label = document.createElement('label');
    label.className = 'check-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme';
    radio.value = v;
    radio.checked = themeNow === v;
    radio.addEventListener('change', async () => {
      await saveSetting('theme', v);
      applyTheme(v);
      toast('화면 설정을 저장했습니다.');
    });
    label.append(radio, document.createTextNode(' ' + t));
    themeRow.appendChild(label);
  });
  themeSec.appendChild(themeRow);

  /* ================= 카테고리 관리 (접힘) ================= */
  const catSec = section('카테고리 관리');
  const catHead = button('▶ 카테고리 관리 펼치기', 'toc-head');
  const catBody = document.createElement('div');
  catBody.hidden = true;
  catHead.addEventListener('click', () => {
    catBody.hidden = !catBody.hidden;
    catHead.textContent = catBody.hidden ? '▶ 카테고리 관리 펼치기' : '▼ 카테고리 관리 접기';
  });

  const managers = [
    ['일정 카테고리', 'scheduleCategory', ['icon']],
    ['메모 카테고리', 'memoCategory', []],
    ['개인 가계부 카테고리', 'personalCategory', []],
    ['학교 프로젝트', 'schoolProject', ['project']],
    ['학교 세부 카테고리', 'schoolCategory', []],
    ['운동 카테고리', 'exerciseCategory', []],
    ['운동 루틴', 'routine', ['routine']]
  ];
  managers.forEach(([label, resource, opts]) => {
    const b = button(label + ' 관리', 'toc-item');
    b.addEventListener('click', () => openCategoryManager(label, resource, opts));
    catBody.appendChild(b);
  });
  catSec.append(catHead, catBody);

  /* ================= 가계부 색상 ================= */
  const colorSec = section('가계부 색상');
  for (const [label, key] of [['수입 색상', 'colorIncome'], ['지출 색상', 'colorExpense'], ['저금 색상', 'colorSaving']]) {
    const sel = document.createElement('select');
    sel.className = 'input';
    COLOR_NAMES.forEach(name => {
      const o = new Option(name, name);
      sel.appendChild(o);
    });
    sel.value = await getSetting(key);
    sel.addEventListener('change', async () => {
      await saveSetting(key, sel.value);
      toast('색상을 저장했습니다.');
    });
    // 색 미리보기 점
    const wrap = document.createElement('div');
    wrap.className = 'color-select-row';
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    function paint() {
      const entry = COLOR_MAP[sel.value];
      dot.style.background = document.documentElement.dataset.theme === 'dark' ? entry.dark : entry.light;
    }
    sel.addEventListener('change', paint);
    paint();
    wrap.append(dot, sel);
    colorSec.appendChild(field(label, wrap));
  }
  const colorHint = document.createElement('p');
  colorHint.className = 'field-hint';
  colorHint.textContent = '선택한 색상은 가계부 목록, 달력, 홈 요약, 합계에 함께 적용됩니다. 다크 모드에서는 잘 보이도록 밝기가 자동 조정됩니다.';
  colorSec.appendChild(colorHint);

  /* ================= 주기 설정 ================= */
  const cycleSec = section('주기 설정');
  const defLen = input('number', await getSetting('cycleDefaultLength'), { min: '10', max: '90' });
  const defPer = input('number', await getSetting('cycleDefaultPeriod'), { min: '1', max: '15' });
  const cycleSave = button('주기 설정 저장', 'btn btn-primary');
  cycleSave.addEventListener('click', async () => {
    await saveSetting('cycleDefaultLength', Number(defLen.value) || 28);
    await saveSetting('cycleDefaultPeriod', Number(defPer.value) || 5);
    toast('주기 설정을 저장했습니다.');
  });
  const cycleHint = document.createElement('p');
  cycleHint.className = 'field-hint';
  cycleHint.textContent = '계산 기준: 평균 주기는 기록된 시작일 간격의 단순 평균입니다. 기록이 1건뿐이면 위 기본 주기 길이를 사용합니다.';
  cycleSec.append(field('기본 주기 길이 (일)', defLen), field('기본 기간 (일)', defPer), cycleSave, cycleHint);

  /* ================= 동기화 및 데이터 ================= */
  const syncSec = section('동기화 및 데이터');
  const statusLine = document.createElement('p');
  const lastLine = document.createElement('p');
  const pendingLine = document.createElement('p');
  async function drawSyncInfo() {
    statusLine.textContent = '현재 상태: ' + (navigator.onLine ? '온라인' : '오프라인');
    const last = await getMeta('lastSyncAt');
    lastLine.textContent = '마지막 동기화: ' + (last ? formatIsoShort(last) : '아직 없음');
    pendingLine.textContent = '동기화 대기: ' + (await queueCount()) + '건';
  }
  onSyncStatus(drawSyncInfo);
  await drawSyncInfo();

  const syncNowBtn = button('지금 동기화', 'btn btn-primary btn-block');
  syncNowBtn.addEventListener('click', () => { flush(); toast('동기화를 시작합니다.'); });

  const backupBtn = button('백업 파일 내려받기 (JSON)', 'btn btn-ghost btn-block');
  backupBtn.addEventListener('click', doBackup);
  const restoreBtn = button('백업 파일에서 복원', 'btn btn-ghost btn-block');
  restoreBtn.addEventListener('click', doRestore);
  const sheetCopyBtn = button('구글 시트 복사본 만들기', 'btn btn-ghost btn-block');
  sheetCopyBtn.addEventListener('click', async () => {
    if (!navigator.onLine) { toast('온라인 상태에서만 가능합니다.', 'warn'); return; }
    try {
      const r = await apiBackupCopy();
      toast('시트 복사본을 만들었습니다: ' + r.name);
    } catch (e) { toast('복사본 생성 실패: ' + e.message, 'error'); }
  });

  syncSec.append(statusLine, lastLine, pendingLine, syncNowBtn, backupBtn, restoreBtn, sheetCopyBtn);

  /* ================= 휴지통 ================= */
  const trashSec = section('휴지통');
  const trashBtn = button('휴지통 열기', 'btn btn-ghost btn-block');
  trashBtn.addEventListener('click', openTrash);
  trashSec.appendChild(trashBtn);

  root.append(themeSec, catSec, colorSec, cycleSec, syncSec, trashSec);
}

function section(title) {
  const sec = document.createElement('section');
  sec.className = 'card';
  const h = document.createElement('h2');
  h.className = 'card-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

/* ================= 카테고리 관리 시트 ================= */

const RESOURCE_LABELS = {
  schedule: '일정', scheduleCategory: '일정 카테고리',
  memo: '메모', memoVersion: '메모 버전', memoCategory: '메모 카테고리',
  attachment: '첨부 파일',
  ledgerPersonal: '개인 가계부', personalCategory: '개인 가계부 카테고리',
  ledgerSchool: '학교 가계부', schoolProject: '학교 프로젝트', schoolCategory: '학교 세부 카테고리',
  exercise: '운동 기록', exerciseCategory: '운동 카테고리', exerciseItem: '운동 종목', exerciseSet: '운동 세트',
  routine: '운동 루틴', routineItem: '루틴 종목', routineSet: '루틴 세트',
  cycle: '주기 기록'
};

async function openCategoryManager(label, resource, opts) {
  const box = document.createElement('div');
  const items = await listActive(resource);

  if (!items.length) box.appendChild(emptyState('등록된 항목이 없습니다.'));
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'routine-row';
    const name = document.createElement('span');
    name.className = 'routine-name';
    name.textContent = (item.icon ? item.icon + ' ' : '') + item.name
      + (resource === 'schoolProject' ? ` (${item.displayType || '일반 지출'})` : '');
    const editBtn = button('수정', 'btn btn-ghost btn-sm');
    const delBtn = button('삭제', 'btn btn-ghost btn-sm');
    row.append(name, editBtn, delBtn);
    box.appendChild(row);

    editBtn.addEventListener('click', () => {
      sheet.close();
      if (opts.includes('routine')) openRoutineEditor(item.id);
      else openCategoryEditor(label, resource, opts, item.id);
    });
    delBtn.addEventListener('click', async () => {
      // 사용 중인 카테고리 삭제 시 영향 안내 (요구사항 10-2)
      const usage = await countUsage(resource, item.id);
      const warnText = usage > 0
        ? `'${item.name}'은(는) 현재 ${usage}개 기록에서 사용 중입니다. 삭제해도 기존 기록의 이름 표시는 유지됩니다. 삭제할까요?`
        : `'${item.name}'을(를) 삭제할까요?`;
      if (await confirmDialog(warnText, '삭제', true)) {
        await deleteLocal(resource, item.id);
        toast('삭제했습니다.');
        sheet.close();
        openCategoryManager(label, resource, opts);
      }
    });
  }

  const addBtn = button('+ 추가', 'btn btn-primary btn-block');
  addBtn.addEventListener('click', () => {
    sheet.close();
    if (opts.includes('routine')) openRoutineEditor(null);
    else openCategoryEditor(label, resource, opts, null);
  });
  box.appendChild(addBtn);
  const sheet = openSheet(label, box);
}

/** 카테고리가 실제 기록에서 몇 번 쓰이는지 대략 집계 */
async function countUsage(resource, id) {
  const checks = {
    scheduleCategory: ['schedule', 'categoryId'],
    memoCategory: ['memo', 'categoryId'],
    personalCategory: ['ledgerPersonal', 'categoryId'],
    schoolProject: ['ledgerSchool', 'projectId'],
    schoolCategory: ['ledgerSchool', 'subCategoryId'],
    exerciseCategory: null // categoryTimes JSON 내부라 별도 처리
  };
  if (resource === 'exerciseCategory') {
    const records = await listActive('exercise');
    return records.filter(r => {
      try { return JSON.parse(r.categoryTimes || '[]').some(t => t.categoryId === id); }
      catch (e) { return false; }
    }).length;
  }
  const c = checks[resource];
  if (!c) return 0;
  const rows = await listActive(c[0]);
  return rows.filter(r => r[c[1]] === id).length;
}

async function openCategoryEditor(label, resource, opts, id) {
  const existing = id ? await dbGet(resource, id) : null;
  const form = document.createElement('div');

  const name = input('text', existing ? existing.name : '', { placeholder: '이름' });
  form.appendChild(field('이름', name));

  let icon = null, color = null, displayType = null, budget = null, deadline = null, projLink = null;

  if (opts.includes('icon')) {
    icon = input('text', existing ? existing.icon : '', { placeholder: '아이콘 (이모지 1개)', maxlength: '2' });
    color = input('text', existing ? existing.color : '', { placeholder: '색상 이름 (선택)' });
    form.append(field('아이콘', icon), field('색상', color));
  }
  if (opts.includes('project')) {
    displayType = document.createElement('select');
    displayType.className = 'input';
    ['일반 지출', '남은 금액 표시'].forEach(t => displayType.appendChild(new Option(t, t)));
    displayType.value = existing ? (existing.displayType || '일반 지출') : '일반 지출';
    budget = input('number', existing ? existing.budget : '', { placeholder: '사용 가능 금액', min: '0' });
    deadline = input('date', existing ? (existing.deadline || '') : '');
    form.append(field('표시 방식', displayType), field('사용 가능 금액', budget), field('사용 기한 (선택)', deadline));
  }
  if (resource === 'schoolCategory') {
    projLink = document.createElement('select');
    projLink.className = 'input';
    projLink.appendChild(new Option('공통 (모든 프로젝트)', ''));
    (await listActive('schoolProject')).forEach(p => projLink.appendChild(new Option(p.name, p.id)));
    projLink.value = existing ? (existing.projectId || '') : '';
    form.appendChild(field('연결 프로젝트', projLink));
  }

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  form.appendChild(saveBtn);
  const sheet = openSheet(existing ? label + ' 수정' : label + ' 추가', form);

  saveBtn.addEventListener('click', async () => {
    const { required, clearAllErrors } = await import('../utils/validation.js');
    clearAllErrors(form);
    if (!required(name, '이름을 입력하세요.')) return;
    if (budget && budget.value !== '' && Number(budget.value) < 0) {
      const { showFieldError } = await import('../utils/validation.js');
      showFieldError(budget, '금액은 0 이상이어야 합니다.');
      return;
    }
    const rec = { ...(existing || {}), id: existing ? existing.id : undefined, name: name.value.trim() };
    if (icon) rec.icon = icon.value.trim();
    if (color) rec.color = color.value.trim();
    if (displayType) rec.displayType = displayType.value;
    if (budget) rec.budget = Number(budget.value) || 0;
    if (deadline) rec.deadline = deadline.value || '';
    if (projLink) rec.projectId = projLink.value || '';
    await saveLocal(resource, rec);
    toast('저장했습니다.');
    sheet.close();
  });
}

/* ================= 백업 / 복원 ================= */

async function doBackup() {
  toast('백업을 준비하고 있습니다…', 'info');
  const backup = { exportedAt: new Date().toISOString(), source: 'lifeManager', data: {}, settings: {} };
  for (const r of RESOURCES) backup.data[r] = await dbAll(r);
  backup.settings = await allSettingsLocal();

  // 온라인이면 서버 데이터도 병합 (서버가 원본)
  if (navigator.onLine) {
    try {
      const serverBackup = await apiBackup();
      backup.server = serverBackup;
    } catch (e) { /* 서버 백업 실패해도 로컬 백업은 제공 */ }
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lifeManager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('백업 파일을 내려받았습니다.');
}

async function doRestore() {
  const fileIn = document.createElement('input');
  fileIn.type = 'file';
  fileIn.accept = 'application/json';
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch (e) { toast('백업 파일을 읽을 수 없습니다.', 'error'); return; }

    // 병합 / 전체 교체 선택 (요구사항 15)
    const box = document.createElement('div');
    box.innerHTML = '<p>복원 방식을 선택하세요.</p>';
    const mergeBtn = button('병합 — 기존 데이터를 유지하고 백업 내용을 추가/갱신', 'btn btn-primary btn-block');
    const replaceBtn = button('전체 교체 — 기존 데이터를 모두 지우고 백업으로 대체', 'btn btn-danger btn-block');
    box.append(mergeBtn, replaceBtn);
    const sheet = openSheet('복원 방식', box);

    async function run(mode) {
      sheet.close();
      const label = mode === 'replace' ? '전체 교체' : '병합';
      if (!await confirmDialog(`정말 '${label}' 방식으로 복원할까요? 이 작업은 되돌릴 수 없습니다.`, '복원 실행', mode === 'replace')) return;

      const { dbClear, dbPut } = await import('../db/indexedDb.js');
      const data = backup.data || {};
      for (const r of RESOURCES) {
        if (mode === 'replace') await dbClear(r);
        for (const row of (data[r] || [])) {
          if (row && row.id) await dbPut(r, row);
        }
      }
      for (const [k, v] of Object.entries(backup.settings || {})) await setSettingLocal(k, v);

      // 서버에도 반영
      if (navigator.onLine) {
        try {
          await apiImport({ data }, mode);
          toast('서버에도 복원 내용을 반영했습니다.');
        } catch (e) { toast('서버 반영 실패 (로컬 복원은 완료): ' + e.message, 'warn'); }
      }
      toast('복원을 완료했습니다.');
      renderSettings(container);
    }
    mergeBtn.addEventListener('click', () => run('merge'));
    replaceBtn.addEventListener('click', () => run('replace'));
  });
  fileIn.click();
}

/* ================= 휴지통 ================= */

async function openTrash() {
  const box = document.createElement('div');
  let total = 0;

  for (const resource of RESOURCES) {
    const deleted = await listDeleted(resource);
    if (!deleted.length) continue;
    total += deleted.length;

    const head = document.createElement('h3');
    head.className = 'sheet-subtitle';
    head.textContent = `${RESOURCE_LABELS[resource] || resource} (${deleted.length})`;
    box.appendChild(head);

    deleted.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    deleted.forEach(item => {
      const row = document.createElement('div');
      row.className = 'trash-row';
      const name = document.createElement('span');
      name.className = 'trash-name';
      name.textContent = item.title || item.name || item.content || item.startDate || item.id;
      const restoreBtn = button('복원', 'btn btn-ghost btn-sm');
      const purgeBtn = button('영구 삭제', 'btn btn-ghost btn-sm');
      row.append(name, restoreBtn, purgeBtn);
      box.appendChild(row);

      restoreBtn.addEventListener('click', async () => {
        await restoreLocal(resource, item.id);
        toast('복원했습니다.');
        sheet.close();
        openTrash();
      });
      purgeBtn.addEventListener('click', async () => {
        if (await confirmDialog('영구 삭제하면 되돌릴 수 없습니다. 삭제할까요?', '영구 삭제', true)) {
          await purgeLocal(resource, item.id);
          toast('영구 삭제했습니다.');
          sheet.close();
          openTrash();
        }
      });
    });
  }

  if (!total) box.appendChild(emptyState('휴지통이 비어 있습니다.'));
  else {
    const emptyBtn = button('휴지통 전체 비우기', 'btn btn-danger btn-block');
    emptyBtn.addEventListener('click', async () => {
      if (await confirmDialog('휴지통의 모든 항목을 영구 삭제할까요? 되돌릴 수 없습니다.', '전체 비우기', true)) {
        for (const resource of RESOURCES) {
          const deleted = await listDeleted(resource);
          for (const item of deleted) await purgeLocal(resource, item.id);
        }
        toast('휴지통을 비웠습니다.');
        sheet.close();
      }
    });
    box.appendChild(emptyBtn);
  }

  const sheet = openSheet('휴지통', box, { full: true });
}
