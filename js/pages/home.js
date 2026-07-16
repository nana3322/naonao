/**
 * pages/home.js — 홈 화면 (요구사항 4) + 일정 기능 (요구사항 5)
 * 순서: 인사/날짜 → 동기화 상태 → 빠른 등록 → 오늘의 일정 → 최근 운동
 *      → 위클리 → 월간 달력 → 개인 가계부 요약 → 학교 예산 요약
 */
import { today, ymd, addDays, formatKoreanFull, ymdToKorean, ymdToMdShort, formatMinutes, formatIsoShort, parseYmd } from '../utils/date.js';
import { won } from '../utils/currency.js';
import { listActive, dbGet } from '../db/indexedDb.js';
import { saveLocal, deleteLocal, onSyncStatus, refreshStatus, flush } from '../api/syncService.js';
import { renderMonthCalendar, renderWeeklyStrip } from '../components/calendar.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, textarea, button, buildCategorySelect, ledgerColor, emptyState } from '../state.js';
import { required, timeOrder, clearAllErrors } from '../utils/validation.js';
import { calcCycle } from '../services/cycleService.js';

let weekStart = today();               // 위클리 시작일 (좌우 이동)
let calYear = today().getFullYear();   // 월간 달력 연/월
let calMonth = today().getMonth() + 1;
let container = null;

export async function renderHome(root) {
  container = root;
  root.innerHTML = '';

  /* ---------- 4-1 인사 및 날짜 ---------- */
  const greet = document.createElement('section');
  greet.className = 'card greet-card';
  greet.innerHTML = `<div class="greet-hello">좋은 하루입니다!</div>
    <div class="greet-date">${formatKoreanFull(today())}</div>`;

  /* ---------- 4-2 동기화 상태 ---------- */
  const syncChip = document.createElement('button');
  syncChip.type = 'button';
  syncChip.className = 'sync-chip';
  syncChip.setAttribute('aria-label', '동기화 상태 자세히 보기');
  syncChip.textContent = '⋯ 상태 확인 중';
  let lastState = { status: 'online', pendingCount: 0, lastSyncAt: null };
  onSyncStatus((s) => {
    lastState = s;
    if (s.status === 'offline') syncChip.textContent = '🔴 오프라인';
    else if (s.status === 'syncing') syncChip.textContent = '🔵 동기화 중';
    else if (s.pendingCount > 0) syncChip.textContent = `🟡 동기화 대기 ${s.pendingCount}건`;
    else syncChip.textContent = '🟢 동기화 완료';
  });
  refreshStatus();
  syncChip.addEventListener('click', () => {
    const box = document.createElement('div');
    box.innerHTML = `
      <p>마지막 동기화: ${lastState.lastSyncAt ? formatIsoShort(lastState.lastSyncAt) : '아직 없음'}</p>
      <p>대기 중인 데이터: ${lastState.pendingCount}건</p>
      <p>현재 상태: ${navigator.onLine ? '온라인' : '오프라인'}</p>`;
    const syncNow = button('지금 동기화', 'btn btn-primary btn-block');
    syncNow.addEventListener('click', () => { flush(); toast('동기화를 시작합니다.'); });
    box.appendChild(syncNow);
    openSheet('동기화 상태', box);
  });
  greet.appendChild(syncChip);

  /* ---------- 4-3 빠른 등록 버튼 ---------- */
  const quick = document.createElement('section');
  quick.className = 'quick-row';
  quick.append(
    quickBtn('📅', '일정 등록', () => openScheduleEditor(null, ymd(today()))),
    quickBtn('📝', '메모 쓰기', () => { location.hash = '#memo?new=1'; }),
    quickBtn('💰', '가계부 쓰기', () => { location.hash = '#ledger?new=1'; })
  );

  /* ---------- 4-4 오늘의 일정 ---------- */
  const todaySec = document.createElement('section');
  todaySec.className = 'card';
  todaySec.innerHTML = '<h2 class="card-title">오늘의 일정</h2>';
  const todayList = document.createElement('div');
  todaySec.appendChild(todayList);

  /* ---------- 4-5 최근 운동 ---------- */
  const exLine = document.createElement('button');
  exLine.type = 'button';
  exLine.className = 'recent-ex-line';
  exLine.setAttribute('aria-label', '최근 운동 기록 보기');

  /* ---------- 4-6 위클리 ---------- */
  const weeklySec = document.createElement('section');
  weeklySec.className = 'card';
  weeklySec.innerHTML = '<h2 class="card-title">이번 주 일정</h2>';
  const weeklyBox = document.createElement('div');
  weeklySec.appendChild(weeklyBox);

  /* ---------- 4-7 월간 달력 ---------- */
  const calSec = document.createElement('section');
  calSec.className = 'card';
  calSec.innerHTML = '<h2 class="card-title">월간 달력</h2>';
  const calBox = document.createElement('div');
  calSec.appendChild(calBox);

  /* ---------- 4-8 개인 가계부 요약 ---------- */
  const sumSec = document.createElement('section');
  sumSec.className = 'card';
  sumSec.innerHTML = '<h2 class="card-title">이번 달 개인 가계부</h2>';
  const sumBox = document.createElement('div');
  sumSec.appendChild(sumBox);

  /* ---------- 4-9 학교 예산 요약 ---------- */
  const schoolSec = document.createElement('section');
  schoolSec.className = 'card';
  schoolSec.innerHTML = '<h2 class="card-title">학교 예산</h2>';
  const schoolBox = document.createElement('div');
  schoolSec.appendChild(schoolBox);

  root.append(greet, quick, todaySec, exLine, weeklySec, calSec, sumSec, schoolSec);

  // 데이터 채우기
  await Promise.all([
    fillTodaySchedule(todayList),
    fillRecentExercise(exLine),
    fillWeekly(weeklyBox),
    fillMonthCalendar(calBox),
    fillMonthSummary(sumBox),
    fillSchoolBudget(schoolBox)
  ]);
}

function quickBtn(icon, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'quick-btn';
  b.innerHTML = `<span class="quick-icon">${icon}</span><span>${label}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

/* ================= 오늘의 일정 ================= */

async function fillTodaySchedule(box) {
  box.innerHTML = '';
  const dateStr = ymd(today());
  const items = (await listActive('schedule'))
    .filter(s => s.date === dateStr)
    .sort(sortSchedule);
  if (!items.length) { box.appendChild(emptyState('오늘 등록된 일정이 없습니다.')); return; }
  for (const s of items) box.appendChild(await scheduleRow(s));
}

function sortSchedule(a, b) {
  // 종일 일정 먼저, 이후 시간순
  const at = a.isAllDay === 'Y' || a.isAllDay === true ? '' : (a.startTime || '99:99');
  const bt = b.isAllDay === 'Y' || b.isAllDay === true ? '' : (b.startTime || '99:99');
  return at.localeCompare(bt);
}

async function scheduleRow(s) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'schedule-row';
  const allDay = s.isAllDay === 'Y' || s.isAllDay === true;
  const time = allDay ? '종일' : (s.startTime || '');
  const cat = s.categoryId ? await dbGet('scheduleCategory', s.categoryId) : null;
  row.innerHTML = `<span class="schedule-time">${time}</span>
    <span class="schedule-icon">${cat && cat.icon ? cat.icon : '📌'}</span>
    <span class="schedule-title">${escapeHtml(s.title)}</span>`;
  row.addEventListener('click', () => openScheduleDetail(s.id));
  return row;
}

/* ================= 최근 운동 한 줄 (4-5) ================= */

async function fillRecentExercise(line) {
  const records = (await listActive('exercise')).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!records.length) {
    line.textContent = '💪 최근 운동 기록이 없습니다';
    line.disabled = true;
    return;
  }
  const r = records[0];
  // 카테고리별 시간: categoryTimes = JSON [{name, minutes}] — 최대 2개 표시
  let parts = [];
  try {
    const times = JSON.parse(r.categoryTimes || '[]');
    parts = times.slice(0, 2).map(t => `${t.name} ${formatMinutes(t.minutes)}`);
    if (times.length > 2) parts.push('…');
  } catch (e) { /* 무시 */ }
  line.textContent = `💪 최근 운동: ${ymdToMdShort(r.date)} ${parts.join(', ') || formatMinutes(r.totalMinutes)}`;
  line.disabled = false;
  line.onclick = () => { location.hash = '#exercise?open=' + r.id; };
}

/* ================= 위클리 (4-6) ================= */

async function fillWeekly(box) {
  const schedules = await listActive('schedule');
  const cats = await listActive('scheduleCategory');
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });

  renderWeeklyStrip(box, {
    startDate: weekStart,
    dayContent: (dateStr) => {
      const items = schedules.filter(s => s.date === dateStr).sort(sortSchedule);
      if (!items.length) return null;
      const list = document.createElement('div');
      list.className = 'weekly-items';
      const showIcon = items.length <= 2; // 3개면 아이콘 생략 (규칙)
      items.slice(0, 3).forEach(s => {
        const it = document.createElement('div');
        it.className = 'weekly-item';
        const icon = showIcon && s.categoryId && catMap[s.categoryId] ? catMap[s.categoryId].icon + ' ' : '';
        it.textContent = icon + s.title;
        list.appendChild(it);
      });
      return list;
    },
    onSelectDate: (dateStr) => openDayDetail(dateStr),
    onShift: (days) => { weekStart = addDays(weekStart, days); renderHome(container); }
  });
}

/* ================= 월간 달력 (4-7) ================= */

async function fillMonthCalendar(box) {
  const [schedules, ledger, cycleInfo] = await Promise.all([
    listActive('schedule'), listActive('ledgerPersonal'), calcCycle()
  ]);
  const incomeColor = await ledgerColor('수입');
  const expenseColor = await ledgerColor('지출');
  const savingColor = await ledgerColor('저금');

  // 날짜별 개인 가계부 합계 (구분별)
  const byDate = {};
  ledger.forEach(l => {
    if (!byDate[l.date]) byDate[l.date] = { 수입: 0, 지출: 0, 저금: 0 };
    byDate[l.date][l.type] = (byDate[l.date][l.type] || 0) + Number(l.amount || 0);
  });

  renderMonthCalendar(box, {
    year: calYear, month: calMonth,
    cellContent: (dateStr) => {
      const frag = document.createElement('div');
      frag.className = 'cal-cell-content';
      let has = false;

      // 1) 개인 가계부 금액 (학교 가계부·운동·메모는 표시하지 않음)
      const sums = byDate[dateStr];
      if (sums) {
        [['수입', incomeColor], ['지출', expenseColor], ['저금', savingColor]].forEach(([type, color]) => {
          if (sums[type] > 0) {
            const d = document.createElement('div');
            d.className = 'cal-amount';
            d.style.color = color;
            d.textContent = (type === '수입' ? '+' : type === '지출' ? '-' : '±') + sums[type].toLocaleString('ko-KR');
            frag.appendChild(d);
            has = true;
          }
        });
      }

      // 2) '월 달력에 표시' 켠 일정의 키워드만
      schedules
        .filter(s => s.date === dateStr && (s.showOnCalendar === 'Y' || s.showOnCalendar === true) && s.calendarKeyword)
        .slice(0, 3)
        .forEach(s => {
          const k = document.createElement('div');
          k.className = 'cal-keyword';
          k.textContent = s.calendarKeyword;
          frag.appendChild(k);
          has = true;
        });

      // 3) 다음 주기 시작 예정일만 (배란/종료 예정일은 홈에 표시 안 함)
      if (cycleInfo && cycleInfo.nextStart === dateStr) {
        const c = document.createElement('div');
        c.className = 'cal-cycle';
        c.textContent = '주기 예정';
        frag.appendChild(c);
        has = true;
      }
      return has ? frag : null;
    },
    onSelectDate: (dateStr) => openDayDetail(dateStr),
    onMonthChange: (y, m) => { calYear = y; calMonth = m; renderHome(container); }
  });
}

/** 날짜 상세: 일정 + 개인 가계부 내역/합계 (학교·운동 제외) */
async function openDayDetail(dateStr) {
  const box = document.createElement('div');

  const [schedules, ledger] = await Promise.all([listActive('schedule'), listActive('ledgerPersonal')]);
  const daySch = schedules.filter(s => s.date === dateStr).sort(sortSchedule);
  const dayLedger = ledger.filter(l => l.date === dateStr);

  const schTitle = document.createElement('h3');
  schTitle.className = 'sheet-subtitle';
  schTitle.textContent = '일정';
  box.appendChild(schTitle);
  if (!daySch.length) box.appendChild(emptyState('일정이 없습니다.'));
  for (const s of daySch) box.appendChild(await scheduleRow(s));

  const addBtn = button('+ 이 날짜에 일정 등록', 'btn btn-ghost btn-block');
  addBtn.addEventListener('click', () => { sheet.close(); openScheduleEditor(null, dateStr); });
  box.appendChild(addBtn);

  const ledTitle = document.createElement('h3');
  ledTitle.className = 'sheet-subtitle';
  ledTitle.textContent = '개인 가계부';
  box.appendChild(ledTitle);

  if (!dayLedger.length) box.appendChild(emptyState('가계부 내역이 없습니다.'));
  else {
    for (const l of dayLedger) {
      const row = document.createElement('div');
      row.className = 'ledger-mini-row';
      const color = await ledgerColor(l.type);
      const catName = l.categoryId ? (await dbGet('personalCategory', l.categoryId) || {}).name || l.categoryName || '기타' : (l.categoryName || '기타');
      row.innerHTML = `<span style="color:${color}">${l.type})</span> ${escapeHtml(catName)} - ${escapeHtml(l.content || '')}
        <span class="ledger-mini-amount" style="color:${color}">${won(l.amount)}</span>`;
      box.appendChild(row);
    }
    const sums = { 수입: 0, 지출: 0, 저금: 0 };
    dayLedger.forEach(l => { sums[l.type] += Number(l.amount || 0); });
    const sumEl = document.createElement('div');
    sumEl.className = 'day-sums';
    sumEl.innerHTML = `수입 합계 ${won(sums.수입)} · 지출 합계 ${won(sums.지출)} · 저금 합계 ${won(sums.저금)}`;
    box.appendChild(sumEl);
  }

  const sheet = openSheet(ymdToKorean(dateStr), box);
}

/* ================= 개인 가계부 월간 요약 (4-8) ================= */

async function fillMonthSummary(box) {
  box.innerHTML = '';
  const prefix = `${calYear}-${String(calMonth).padStart(2, '0')}`;
  const ledger = (await listActive('ledgerPersonal')).filter(l => String(l.date).startsWith(prefix));
  const sums = { 수입: 0, 지출: 0, 저금: 0 };
  ledger.forEach(l => { sums[l.type] = (sums[l.type] || 0) + Number(l.amount || 0); });
  const balance = sums.수입 - sums.지출 - sums.저금;

  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  for (const [label, val, type] of [['총 수입', sums.수입, '수입'], ['총 지출', sums.지출, '지출'], ['총 저금', sums.저금, '저금']]) {
    const cell = document.createElement('div');
    cell.className = 'summary-cell';
    const color = await ledgerColor(type);
    cell.innerHTML = `<div class="summary-label">${label}</div><div class="summary-value" style="color:${color}">${won(val)}</div>`;
    grid.appendChild(cell);
  }
  const bal = document.createElement('div');
  bal.className = 'summary-balance';
  bal.innerHTML = `<span>현재 잔액</span><strong>${won(balance)}</strong>`;
  box.append(grid, bal);
}

/* ================= 학교 예산 요약 (4-9) ================= */

async function fillSchoolBudget(box) {
  box.innerHTML = '';
  const projects = (await listActive('schoolProject')).filter(p => p.displayType === '남은 금액 표시');
  if (!projects.length) { box.appendChild(emptyState('남은 금액 표시 방식의 학교 프로젝트가 없습니다.')); return; }
  const expenses = await listActive('ledgerSchool');
  const todayStr = ymd(today());

  projects.forEach(p => {
    const used = expenses.filter(e => e.projectId === p.id)
      .reduce((acc, e) => acc + Number(e.amount || 0), 0);
    const remain = Number(p.budget || 0) - used;
    const overdue = p.deadline && p.deadline < todayStr;

    const card = document.createElement('div');
    card.className = 'project-card' + (overdue ? ' overdue' : '');
    card.innerHTML = `
      <div class="project-name">${escapeHtml(p.name)}${overdue ? ' <span class="badge-overdue">기한 지남</span>' : ''}</div>
      <div class="project-line">사용 가능 금액 ${won(p.budget)}</div>
      <div class="project-line">사용 금액 ${won(used)}</div>
      <div class="project-line project-remain">남은 금액 ${won(remain)}</div>
      <div class="project-line">사용 기한 ${p.deadline || '없음'}</div>`;
    box.appendChild(card);
  });
}

/* ================= 일정 편집기 (요구사항 5) ================= */

/** scheduleId=null 이면 새 일정. defaultDate 로 날짜 초기값 지정 */
export async function openScheduleEditor(scheduleId, defaultDate) {
  const existing = scheduleId ? await dbGet('schedule', scheduleId) : null;
  const form = document.createElement('div');

  const title = input('text', existing ? existing.title : '', { placeholder: '일정 제목' });
  const date = input('date', existing ? existing.date : (defaultDate || ymd(today())));
  const start = input('time', existing ? existing.startTime : '');
  const end = input('time', existing ? existing.endTime : '');

  const allDay = document.createElement('input');
  allDay.type = 'checkbox';
  allDay.checked = existing ? (existing.isAllDay === 'Y' || existing.isAllDay === true) : false;
  const allDayWrap = document.createElement('label');
  allDayWrap.className = 'check-row';
  allDayWrap.append(allDay, document.createTextNode(' 하루 종일'));

  const catSel = await buildCategorySelect('scheduleCategory', {
    selectedId: existing ? existing.categoryId : '',
    allowEmpty: true, emptyLabel: '카테고리 없음',
    extraFields: { icon: '📌', color: '파랑' }
  });

  const memo = textarea(existing ? existing.memo : '', 3);

  // 월 달력 표시 ON/OFF + 키워드 (켜졌을 때만 활성화)
  const showCal = document.createElement('input');
  showCal.type = 'checkbox';
  showCal.checked = existing ? (existing.showOnCalendar === 'Y' || existing.showOnCalendar === true) : false;
  const showCalWrap = document.createElement('label');
  showCalWrap.className = 'check-row';
  showCalWrap.append(showCal, document.createTextNode(' 월 달력에 표시'));
  const keyword = input('text', existing ? existing.calendarKeyword : '', { placeholder: '달력 표시 키워드 (짧게)', maxlength: '10' });
  keyword.disabled = !showCal.checked;
  showCal.addEventListener('change', () => { keyword.disabled = !showCal.checked; });

  // 하루 종일이면 시간 입력 비활성화
  function syncAllDay() { start.disabled = allDay.checked; end.disabled = allDay.checked; }
  allDay.addEventListener('change', syncAllDay);
  syncAllDay();

  const saveBtn = button('저장', 'btn btn-primary btn-block');

  form.append(
    field('제목', title), field('날짜', date),
    allDayWrap,
    field('시작 시간', start), field('종료 시간', end),
    field('일정 카테고리', catSel.el),
    field('메모', memo),
    showCalWrap, field('달력 표시 키워드', keyword),
    saveBtn
  );

  const sheet = openSheet(existing ? '일정 수정' : '일정 등록', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    let ok = required(title, '제목을 입력하세요.');
    ok = required(date, '날짜를 선택하세요.') && ok;
    if (!allDay.checked) ok = timeOrder(start, end) && ok;
    if (!ok) return;

    await saveLocal('schedule', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      title: title.value.trim(),
      date: date.value,
      startTime: allDay.checked ? '' : start.value,
      endTime: allDay.checked ? '' : end.value,
      isAllDay: allDay.checked ? 'Y' : 'N',
      categoryId: catSel.getValue(),
      memo: memo.value,
      showOnCalendar: showCal.checked ? 'Y' : 'N',
      calendarKeyword: showCal.checked ? keyword.value.trim() : ''
    });
    toast('일정을 저장했습니다.');
    sheet.close();
    renderHome(container);
  });
}

/** 일정 상세: 수정 / 다른 날짜에 복사 / 삭제 */
async function openScheduleDetail(id) {
  const s = await dbGet('schedule', id);
  if (!s) return;
  const box = document.createElement('div');
  const cat = s.categoryId ? await dbGet('scheduleCategory', s.categoryId) : null;
  const allDay = s.isAllDay === 'Y' || s.isAllDay === true;
  box.innerHTML = `
    <div class="detail-line"><strong>${escapeHtml(s.title)}</strong></div>
    <div class="detail-line">${ymdToKorean(s.date)} · ${allDay ? '종일' : `${s.startTime || ''}${s.endTime ? ' ~ ' + s.endTime : ''}`}</div>
    <div class="detail-line">${cat ? (cat.icon + ' ' + cat.name) : '카테고리 없음'}</div>
    ${s.memo ? `<div class="detail-line detail-memo">${escapeHtml(s.memo)}</div>` : ''}`;

  const editBtn = button('수정', 'btn btn-primary btn-block');
  const copyBtn = button('다른 날짜에 복사', 'btn btn-ghost btn-block');
  const delBtn = button('삭제', 'btn btn-danger btn-block');
  box.append(editBtn, copyBtn, delBtn);
  const sheet = openSheet('일정 상세', box);

  editBtn.addEventListener('click', () => { sheet.close(); openScheduleEditor(id); });
  copyBtn.addEventListener('click', () => { sheet.close(); openCopyDates(s); });
  delBtn.addEventListener('click', async () => {
    if (await confirmDialog('이 일정을 휴지통으로 이동할까요?', '삭제', true)) {
      await deleteLocal('schedule', id);
      toast('휴지통으로 이동했습니다.');
      sheet.close();
      renderHome(container);
    }
  });
}

/** 여러 날짜 선택 → 각 날짜에 독립 사본 생성 (요구사항 5 복사 기능) */
function openCopyDates(source) {
  const box = document.createElement('div');
  const info = document.createElement('p');
  info.textContent = `'${source.title}' 일정을 복사할 날짜들을 달력에서 선택하세요.`;
  box.appendChild(info);

  const selected = new Set(); // 'YYYY-MM-DD'
  let y = parseYmd(source.date).getFullYear();
  let m = parseYmd(source.date).getMonth() + 1;
  const calBox = document.createElement('div');
  box.appendChild(calBox);

  const chosen = document.createElement('div');
  chosen.className = 'chosen-dates';
  box.appendChild(chosen);

  function draw() {
    renderMonthCalendar(calBox, {
      year: y, month: m,
      cellClass: (dateStr) => selected.has(dateStr) ? 'selected' : '',
      cellContent: null,
      onSelectDate: (dateStr) => {
        if (selected.has(dateStr)) selected.delete(dateStr);
        else selected.add(dateStr);
        chosen.textContent = selected.size ? '선택: ' + [...selected].sort().map(ymdToMdShort).join(', ') : '';
        draw();
      },
      onMonthChange: (ny, nm) => { y = ny; m = nm; draw(); }
    });
  }
  draw();

  const doneBtn = button('선택한 날짜에 복사', 'btn btn-primary btn-block');
  box.appendChild(doneBtn);
  const sheet = openSheet('다른 날짜에 복사', box, { full: true });

  doneBtn.addEventListener('click', async () => {
    if (!selected.size) { toast('복사할 날짜를 선택하세요.', 'warn'); return; }
    for (const dateStr of selected) {
      // 원본과 독립된 새 일정으로 생성 (id 새로 발급)
      await saveLocal('schedule', {
        title: source.title, date: dateStr,
        startTime: source.startTime, endTime: source.endTime,
        isAllDay: source.isAllDay, categoryId: source.categoryId,
        memo: source.memo, showOnCalendar: source.showOnCalendar,
        calendarKeyword: source.calendarKeyword
      });
    }
    toast(`${selected.size}개 날짜에 일정을 복사했습니다.`);
    sheet.close();
    renderHome(container);
  });
}

/* ---------------- 공용 ---------------- */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
