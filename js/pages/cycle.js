/**
 * pages/cycle.js — 주기 기록 (요구사항 9, '월경' 명칭 사용 금지)
 *  - 시작일/종료일(나중 수정 가능)/메모
 *  - 자동 계산: 평균 주기·기간, 다음 시작/종료 예정일, 예상 배란일
 *  - 주기 탭 전용 월간 달력: 실제 기간 / 예측(시작·종료·배란) 구분 표시
 *  - 홈 달력에는 '주기 예정'(다음 시작 예정일)만 표시 (home.js 에서 처리)
 */
import { listActive, dbGet } from '../db/indexedDb.js';
import { saveLocal, deleteLocal } from '../api/syncService.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, textarea, button, emptyState } from '../state.js';
import { required, dateOrder, clearAllErrors } from '../utils/validation.js';
import { today, ymd, ymdToKorean, parseYmd } from '../utils/date.js';
import { renderMonthCalendar } from '../components/calendar.js';
import { calcCycle } from '../services/cycleService.js';

let container = null;
let calYear = today().getFullYear();
let calMonth = today().getMonth() + 1;

export async function renderCycle(root) {
  container = root;
  root.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'page-toolbar';
  const newBtn = button('+ 주기 기록', 'btn btn-primary');
  bar.appendChild(newBtn);
  root.appendChild(bar);
  newBtn.addEventListener('click', () => openCycleEditor(null));

  const info = await calcCycle();

  /* ---------- 자동 계산 요약 ---------- */
  const sumSec = document.createElement('section');
  sumSec.className = 'card';
  sumSec.innerHTML = '<h2 class="card-title">주기 요약</h2>';
  if (!info) {
    sumSec.appendChild(emptyState('아직 기록이 없습니다. 첫 주기를 기록해 보세요.'));
  } else {
    const grid = document.createElement('div');
    grid.className = 'cycle-summary';
    grid.innerHTML = `
      <div class="cycle-cell"><div class="summary-label">평균 주기</div><div class="summary-value">${info.avgLength}일</div></div>
      <div class="cycle-cell"><div class="summary-label">평균 기간</div><div class="summary-value">${info.avgPeriod}일</div></div>
      <div class="cycle-cell"><div class="summary-label">다음 시작 예정</div><div class="summary-value">${ymdToKorean(info.nextStart)}</div></div>
      <div class="cycle-cell"><div class="summary-label">예상 배란일</div><div class="summary-value">${ymdToKorean(info.ovulation)}</div></div>`;
    sumSec.appendChild(grid);
  }
  root.appendChild(sumSec);

  /* ---------- 전용 월간 달력 ---------- */
  const calSec = document.createElement('section');
  calSec.className = 'card';
  calSec.innerHTML = `<h2 class="card-title">주기 달력</h2>
    <div class="cycle-legend">
      <span class="legend-item lg-actual">실제 기간</span>
      <span class="legend-item lg-predict">예정 기간</span>
      <span class="legend-item lg-ovul">배란 예상</span>
    </div>`;
  const calBox = document.createElement('div');
  calSec.appendChild(calBox);
  root.appendChild(calSec);

  const records = info ? info.records : [];
  function isActual(dateStr) {
    return records.some(r => r.startDate <= dateStr && dateStr <= (r.endDate || r.startDate));
  }
  function isPredicted(dateStr) {
    return info && info.nextStart <= dateStr && dateStr <= info.nextEnd;
  }

  renderMonthCalendar(calBox, {
    year: calYear, month: calMonth,
    cellClass: (dateStr) => {
      if (isActual(dateStr)) return 'cycle-actual';
      if (info && dateStr === info.ovulation) return 'cycle-ovul';
      if (isPredicted(dateStr)) return 'cycle-predict';
      return '';
    },
    cellContent: null,
    onSelectDate: (dateStr) => openCycleDayDetail(dateStr, info),
    onMonthChange: (y, m) => { calYear = y; calMonth = m; renderCycle(container); }
  });

  /* ---------- 기록 목록 ---------- */
  const listSec = document.createElement('section');
  listSec.className = 'card';
  listSec.innerHTML = '<h2 class="card-title">기록</h2>';
  const listBox = document.createElement('div');
  listSec.appendChild(listBox);
  root.appendChild(listSec);

  const sorted = [...records].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  if (!sorted.length) listBox.appendChild(emptyState('기록이 없습니다.'));
  sorted.forEach(r => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cycle-row';
    const days = r.endDate ? ((parseYmd(r.endDate) - parseYmd(r.startDate)) / 86400000 + 1) + '일간' : '진행 중 (종료일 미입력)';
    row.innerHTML = `<span>${ymdToKorean(r.startDate)}${r.endDate ? ' ~ ' + ymdToKorean(r.endDate) : ''}</span>
      <span class="cycle-days">${days}</span>`;
    row.addEventListener('click', () => openCycleEditor(r.id));
    listBox.appendChild(row);
  });

  /* ---------- 안내 문구 (요구사항 9-4) ---------- */
  const notice = document.createElement('p');
  notice.className = 'cycle-notice';
  notice.textContent = '예정일은 기록을 바탕으로 한 단순 계산 결과이며, 의학적 진단이 아닙니다.';
  root.appendChild(notice);
}

/** 날짜 탭 상세 */
function openCycleDayDetail(dateStr, info) {
  const box = document.createElement('div');
  const lines = [];
  if (info) {
    info.records.forEach(r => {
      if (r.startDate <= dateStr && dateStr <= (r.endDate || r.startDate)) {
        lines.push(`실제 기간에 포함됩니다 (${ymdToKorean(r.startDate)} 시작).`);
        if (r.memo) lines.push('메모: ' + r.memo);
      }
    });
    if (dateStr === info.nextStart) lines.push('다음 주기 시작 예정일입니다.');
    if (dateStr === info.nextEnd) lines.push('다음 주기 종료 예정일입니다.');
    if (dateStr === info.ovulation) lines.push('예상 배란일입니다.');
    if (info.nextStart < dateStr && dateStr <= info.nextEnd) lines.push('예정 기간에 포함됩니다.');
  }
  if (!lines.length) lines.push('이 날짜에는 표시할 정보가 없습니다.');
  box.innerHTML = lines.map(l => `<div class="detail-line">${l}</div>`).join('');
  openSheet(ymdToKorean(dateStr), box);
}

/* ---------------- 기록 편집기 ---------------- */

async function openCycleEditor(id) {
  const existing = id ? await dbGet('cycle', id) : null;
  const form = document.createElement('div');

  const start = input('date', existing ? existing.startDate : ymd(today()));
  const end = input('date', existing ? (existing.endDate || '') : '');
  const endHint = document.createElement('div');
  endHint.className = 'field-hint';
  endHint.textContent = '종료일은 나중에 다시 수정할 수 있습니다.';
  const memo = textarea(existing ? existing.memo : '', 3);

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  form.append(field('시작일', start), field('종료일 (선택)', end), endHint, field('메모', memo), saveBtn);
  if (existing) {
    const delBtn = button('삭제', 'btn btn-danger btn-block');
    form.appendChild(delBtn);
    delBtn.addEventListener('click', async () => {
      if (await confirmDialog('이 기록을 휴지통으로 이동할까요?', '삭제', true)) {
        await deleteLocal('cycle', existing.id);
        toast('휴지통으로 이동했습니다.');
        sheet.close();
        renderCycle(container);
      }
    });
  }

  const sheet = openSheet(existing ? '주기 기록 수정' : '주기 기록', form);

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    let ok = required(start, '시작일을 선택하세요.');
    // 종료일은 시작일보다 빠를 수 없음 (요구사항 16)
    ok = dateOrder(start, end, '종료일이 시작일보다 빠릅니다.') && ok;
    if (!ok) return;

    await saveLocal('cycle', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      startDate: start.value,
      endDate: end.value || '',
      memo: memo.value
    });
    toast('기록을 저장했습니다.');
    sheet.close();
    renderCycle(container);
  });
}
