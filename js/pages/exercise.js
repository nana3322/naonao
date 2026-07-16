/**
 * pages/exercise.js — 운동 기록 (요구사항 8, '헬스' 명칭 사용 금지)
 *
 * 데이터 구조:
 *  exercise: 날짜/요일(자동)/시작·종료/전체시간(자동 계산, 수정 가능)/
 *            categoryTimes(JSON [{categoryId,name,minutes}])/메모
 *  exerciseItem: 기록에 속한 종목 (recordId, name, orderIndex)
 *  exerciseSet: 종목에 속한 세트 구성 (itemId, kg, rep, sets, orderIndex)
 *  routine / routineItem / routineSet: 루틴 (불러오면 사본 생성, 원본 불변)
 */
import { listActive, dbGet, dbByIndex } from '../db/indexedDb.js';
import { saveLocal, deleteLocal, purgeLocal } from '../api/syncService.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, textarea, button, emptyState, debounce } from '../state.js';
import { required, nonNegativeOrEmpty, timeOrder, clearAllErrors } from '../utils/validation.js';
import { today, ymd, weekdayOf, ymdToMdShort, ymdToKorean, diffMinutes, formatMinutes } from '../utils/date.js';
import { uuid } from '../utils/uuid.js';

let container = null;
const filter = { year: '', month: '', categoryId: '', text: '' };

export async function renderExercise(root, params = {}) {
  container = root;
  root.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'page-toolbar';
  const newBtn = button('+ 운동 기록', 'btn btn-primary');
  const routineBtn = button('루틴', 'btn btn-ghost');
  bar.append(newBtn, routineBtn);
  root.appendChild(bar);
  newBtn.addEventListener('click', () => openExerciseEditor(null));
  routineBtn.addEventListener('click', openRoutineManager);

  /* ---------- 최근 7일 한 줄 목록 (요구사항 8-2) ---------- */
  const recentSec = document.createElement('section');
  recentSec.className = 'card';
  recentSec.innerHTML = '<h2 class="card-title">최근 7일</h2>';
  const recentBox = document.createElement('div');
  recentSec.appendChild(recentBox);
  root.appendChild(recentSec);

  const all = (await listActive('exercise')).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const weekAgo = ymd(new Date(today().getTime() - 6 * 86400000));
  const recent = all.filter(r => r.date >= weekAgo);
  if (!recent.length) recentBox.appendChild(emptyState('최근 7일간 운동 기록이 없습니다.'));
  recent.forEach(r => {
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'recent-ex-item';
    let names = '';
    try {
      names = JSON.parse(r.categoryTimes || '[]').map(t => t.name).join(' · ');
    } catch (e) { /* 무시 */ }
    line.textContent = `${ymdToMdShort(r.date)} ${names || formatMinutes(r.totalMinutes)}`;
    line.addEventListener('click', () => openExerciseDetail(r.id));
    recentBox.appendChild(line);
  });

  /* ---------- 검색 (연도→월→카테고리→내용) ---------- */
  const panel = document.createElement('div');
  panel.className = 'card search-panel';
  root.appendChild(panel);

  const years = [...new Set(all.map(r => String(r.date).slice(0, 4)))].sort().reverse();
  const yearSel = selectWith([['', '전체']].concat(years.map(y => [y, y + '년'])), filter.year);
  const monthSel = selectWith([['', '전체']].concat(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), (i + 1) + '월'])), filter.month);
  const catSel = document.createElement('select');
  catSel.className = 'input';
  catSel.appendChild(new Option('전체', ''));
  (await listActive('exerciseCategory')).forEach(c => catSel.appendChild(new Option(c.name, c.id)));
  catSel.value = filter.categoryId;
  const textIn = input('search', filter.text, { placeholder: '종목 이름 검색 (부분 일치)' });
  panel.append(field('연도', yearSel), field('월', monthSel), field('카테고리', catSel), field('내용 검색', textIn));

  /* ---------- 기록 목록 ---------- */
  const listBox = document.createElement('div');
  root.appendChild(listBox);

  async function draw() {
    listBox.innerHTML = '';
    let items = (await listActive('exercise'));
    if (filter.year) items = items.filter(r => String(r.date).startsWith(filter.year));
    if (filter.month) items = items.filter(r => String(r.date).slice(5, 7) === filter.month);
    if (filter.categoryId) {
      items = items.filter(r => {
        try { return JSON.parse(r.categoryTimes || '[]').some(t => t.categoryId === filter.categoryId); }
        catch (e) { return false; }
      });
    }
    if (filter.text) {
      // 종목 이름 부분 일치 검색 (요구사항 8-5)
      const q = filter.text.toLowerCase();
      const allItems = await listActive('exerciseItem');
      const matchedRecordIds = new Set(
        allItems.filter(i => String(i.name || '').toLowerCase().includes(q)).map(i => i.recordId));
      items = items.filter(r => matchedRecordIds.has(r.id));
    }
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!items.length) { listBox.appendChild(emptyState('운동 기록이 없습니다.')); return; }

    for (const r of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'exercise-card';
      let catLine = '';
      try {
        catLine = JSON.parse(r.categoryTimes || '[]').map(t => `${t.name} ${formatMinutes(t.minutes)}`).join(' · ');
      } catch (e) { /* 무시 */ }
      const recItems = (await dbByIndex('exerciseItem', 'recordId', r.id)).filter(i => !i.deletedAt);
      const mainNames = recItems.slice(0, 3).map(i => i.name).join(', ') + (recItems.length > 3 ? ' 외' : '');
      card.innerHTML = `
        <div class="ex-card-date">${ymdToMdShort(r.date)} (${r.weekday || weekdayOf(r.date)})
          <span class="ex-card-time">${r.startTime || ''}${r.endTime ? '~' + r.endTime : ''} · ${formatMinutes(r.totalMinutes)}</span></div>
        <div class="ex-card-cats">${catLine}</div>
        <div class="ex-card-items">${escapeHtml(mainNames || '종목 없음')}</div>`;
      card.addEventListener('click', () => openExerciseDetail(r.id));
      listBox.appendChild(card);
    }
  }
  yearSel.addEventListener('change', () => { filter.year = yearSel.value; draw(); });
  monthSel.addEventListener('change', () => { filter.month = monthSel.value; draw(); });
  catSel.addEventListener('change', () => { filter.categoryId = catSel.value; draw(); });
  textIn.addEventListener('input', debounce(() => { filter.text = textIn.value.trim(); draw(); }, 250));
  await draw();

  // 홈 최근 운동 '#exercise?open=<id>' 진입 처리
  if (params.open) openExerciseDetail(params.open);
}

/* ================= 기록 상세 (탭 시 전체 세트 확인) ================= */

async function openExerciseDetail(id) {
  const r = await dbGet('exercise', id);
  if (!r) return;
  const box = document.createElement('div');
  let catLine = '';
  try { catLine = JSON.parse(r.categoryTimes || '[]').map(t => `${t.name} ${formatMinutes(t.minutes)}`).join(' · '); } catch (e) { /* */ }
  box.innerHTML = `
    <div class="detail-line"><strong>${ymdToKorean(r.date)} (${r.weekday || weekdayOf(r.date)})</strong></div>
    <div class="detail-line">${r.startTime || ''}${r.endTime ? ' ~ ' + r.endTime : ''} · 전체 ${formatMinutes(r.totalMinutes)}</div>
    <div class="detail-line">${catLine || '카테고리 없음'}</div>
    ${r.memo ? `<div class="detail-line detail-memo">${escapeHtml(r.memo)}</div>` : ''}`;

  const items = (await dbByIndex('exerciseItem', 'recordId', id))
    .filter(i => !i.deletedAt)
    .sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
  for (const item of items) {
    const itemBox = document.createElement('div');
    itemBox.className = 'ex-item-view';
    const sets = (await dbByIndex('exerciseSet', 'itemId', item.id))
      .filter(s => !s.deletedAt)
      .sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
    itemBox.innerHTML = `<div class="ex-item-name">${escapeHtml(item.name)}</div>` +
      sets.map(s => `<div class="ex-set-line">${s.kg !== '' && s.kg !== undefined ? s.kg + 'kg' : '-'} × ${s.rep || '-'}회 × ${s.sets || '-'}세트</div>`).join('');
    box.appendChild(itemBox);
  }

  const editBtn = button('수정', 'btn btn-primary btn-block');
  const delBtn = button('삭제', 'btn btn-danger btn-block');
  box.append(editBtn, delBtn);
  const sheet = openSheet('운동 기록', box, { full: true });

  editBtn.addEventListener('click', () => { sheet.close(); openExerciseEditor(id); });
  delBtn.addEventListener('click', async () => {
    if (await confirmDialog('이 운동 기록을 휴지통으로 이동할까요?', '삭제', true)) {
      await deleteLocal('exercise', id);
      toast('휴지통으로 이동했습니다.');
      sheet.close();
      renderExercise(container);
    }
  });
}

/* ================= 기록 편집기 ================= */

/** presetItems: 루틴 불러오기 시 [{name, sets:[{kg,rep,sets}]}] */
async function openExerciseEditor(id, presetItems = null, presetCategoryIds = null) {
  const existing = id ? await dbGet('exercise', id) : null;
  const form = document.createElement('div');

  const date = input('date', existing ? existing.date : ymd(today()));
  const weekdayEl = document.createElement('div');
  weekdayEl.className = 'weekday-auto';
  function syncWeekday() { weekdayEl.textContent = date.value ? weekdayOf(date.value) + '요일 (자동)' : ''; }
  date.addEventListener('change', syncWeekday);
  syncWeekday();

  const start = input('time', existing ? existing.startTime : '');
  const end = input('time', existing ? existing.endTime : '');
  const total = input('number', existing ? existing.totalMinutes : '', { placeholder: '분', min: '0' });
  // 시작~종료 입력 시 전체 시간 자동 계산 (직접 수정 가능 — 요구사항 8-1)
  function autoTotal() {
    if (start.value && end.value) total.value = diffMinutes(start.value, end.value);
  }
  start.addEventListener('change', autoTotal);
  end.addEventListener('change', autoTotal);

  /* ---------- 카테고리 다중 선택 + 카테고리별 시간 ---------- */
  const catBox = document.createElement('div');
  catBox.className = 'ex-cat-box';
  const cats = await listActive('exerciseCategory');
  let existingTimes = [];
  try { existingTimes = JSON.parse((existing && existing.categoryTimes) || '[]'); } catch (e) { /* */ }
  const catRows = []; // {cat, check, minutes}
  cats.forEach(c => {
    const row = document.createElement('div');
    row.className = 'ex-cat-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    const found = existingTimes.find(t => t.categoryId === c.id);
    const preset = presetCategoryIds && presetCategoryIds.includes(c.id);
    check.checked = !!found || !!preset;
    const label = document.createElement('label');
    label.className = 'check-row';
    label.append(check, document.createTextNode(' ' + c.name));
    const minutes = input('number', found ? found.minutes : '', { placeholder: '시간(분)', min: '0' });
    minutes.classList.add('ex-cat-minutes');
    minutes.disabled = !check.checked;
    check.addEventListener('change', () => { minutes.disabled = !check.checked; checkSum(); });
    minutes.addEventListener('input', () => checkSum());
    row.append(label, minutes);
    catBox.appendChild(row);
    catRows.push({ cat: c, check, minutes });
  });
  // 합계 불일치 안내 (저장은 막지 않음 — 요구사항 8-1)
  const sumNotice = document.createElement('div');
  sumNotice.className = 'sum-notice';
  catBox.appendChild(sumNotice);
  function checkSum() {
    const sum = catRows.filter(r => r.check.checked)
      .reduce((acc, r) => acc + (Number(r.minutes.value) || 0), 0);
    const t = Number(total.value) || 0;
    sumNotice.textContent = (sum && t && sum !== t)
      ? `카테고리별 시간 합계(${formatMinutes(sum)})가 전체 시간(${formatMinutes(t)})과 다릅니다.` : '';
  }
  total.addEventListener('input', checkSum);

  /* ---------- 종목 카드 목록 ---------- */
  const itemsBox = document.createElement('div');
  itemsBox.className = 'ex-items-box';
  const itemStates = []; // { nameInput, setRows: [{kg,rep,sets}], el }

  function addItemCard(name = '', sets = null) {
    const cardEl = document.createElement('div');
    cardEl.className = 'ex-item-card';

    // 상단: 종목 이름
    const nameInput = input('text', name, { placeholder: '종목 이름 (예: 벤치프레스)' });
    const removeItem = button('✕', 'icon-btn', '종목 삭제');
    const headRow = document.createElement('div');
    headRow.className = 'ex-item-head';
    headRow.append(nameInput, removeItem);

    // 세트 표 헤더: 종목 | kg | rep | 세트 순서 (요구사항 8-3)
    const table = document.createElement('div');
    table.className = 'ex-set-table';
    const header = document.createElement('div');
    header.className = 'ex-set-row ex-set-header';
    header.innerHTML = '<span>kg</span><span>rep</span><span>세트</span><span></span>';
    table.appendChild(header);

    const state = { nameInput, setRows: [], el: cardEl };

    function addSetRow(kg = '', rep = '', setCount = '') {
      const row = document.createElement('div');
      row.className = 'ex-set-row';
      const kgIn = input('number', kg, { placeholder: 'kg', min: '0', step: '0.5' });
      const repIn = input('number', rep, { placeholder: 'rep', min: '0' });
      const setIn = input('number', setCount, { placeholder: '세트', min: '0' });
      const del = button('✕', 'icon-btn', '세트 구성 삭제');
      row.append(kgIn, repIn, setIn, del);
      table.appendChild(row);
      const rowState = { kgIn, repIn, setIn, el: row };
      state.setRows.push(rowState);
      del.addEventListener('click', () => {
        state.setRows.splice(state.setRows.indexOf(rowState), 1);
        row.remove();
      });
    }

    if (sets && sets.length) sets.forEach(s => addSetRow(s.kg, s.rep, s.sets));
    else addSetRow();

    const addSetBtn = button('+ 세트 구성 추가', 'btn btn-ghost btn-sm');
    addSetBtn.addEventListener('click', () => addSetRow());

    removeItem.addEventListener('click', async () => {
      if (await confirmDialog('이 종목을 삭제할까요?', '삭제', true)) {
        itemStates.splice(itemStates.indexOf(state), 1);
        cardEl.remove();
      }
    });

    cardEl.append(headRow, table, addSetBtn);
    itemsBox.appendChild(cardEl);
    itemStates.push(state);
  }

  // 기존 기록 or 루틴 프리셋 로드
  if (existing) {
    const recItems = (await dbByIndex('exerciseItem', 'recordId', existing.id))
      .filter(i => !i.deletedAt)
      .sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
    for (const it of recItems) {
      const sets = (await dbByIndex('exerciseSet', 'itemId', it.id))
        .filter(s => !s.deletedAt)
        .sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
      addItemCard(it.name, sets);
    }
    if (!recItems.length) addItemCard();
  } else if (presetItems) {
    presetItems.forEach(p => addItemCard(p.name, p.sets));
  } else {
    addItemCard();
  }

  const addItemBtn = button('+ 운동 종목 추가', 'btn btn-ghost btn-block');
  addItemBtn.addEventListener('click', () => addItemCard());

  const loadRoutineBtn = button('루틴 불러오기', 'btn btn-ghost btn-block');
  loadRoutineBtn.addEventListener('click', async () => {
    const routines = await listActive('routine');
    if (!routines.length) { toast('저장된 루틴이 없습니다.', 'warn'); return; }
    const box = document.createElement('div');
    routines.forEach(rt => {
      const b = button(rt.name, 'toc-item');
      b.addEventListener('click', async () => {
        // 루틴 → 편집 중인 폼에 종목/세트 채우기 (원본 불변)
        const rItems = (await dbByIndex('routineItem', 'routineId', rt.id))
          .filter(i => !i.deletedAt)
          .sort((a, b2) => Number(a.orderIndex) - Number(b2.orderIndex));
        for (const it of rItems) {
          const rSets = (await dbByIndex('routineSet', 'routineItemId', it.id))
            .filter(s => !s.deletedAt)
            .sort((a, b2) => Number(a.orderIndex) - Number(b2.orderIndex));
          addItemCard(it.name, rSets);
        }
        // 루틴 카테고리 자동 체크
        try {
          const ids = JSON.parse(rt.categoryIds || '[]');
          catRows.forEach(r => { if (ids.includes(r.cat.id)) { r.check.checked = true; r.minutes.disabled = false; } });
        } catch (e) { /* */ }
        pick.close();
        toast(`루틴 '${rt.name}'을 불러왔습니다. 자유롭게 수정하세요.`);
      });
      box.appendChild(b);
    });
    const pick = openSheet('루틴 선택', box);
  });

  const memo = textarea(existing ? existing.memo : '', 3);
  const saveBtn = button('저장', 'btn btn-primary btn-block');

  form.append(
    field('날짜', date), weekdayEl,
    field('시작 시간', start), field('종료 시간', end),
    field('전체 운동 시간 (분)', total),
    field('운동 카테고리 (여러 개 선택 가능)', catBox),
    loadRoutineBtn, itemsBox, addItemBtn,
    field('메모', memo), saveBtn
  );

  const sheet = openSheet(existing ? '운동 기록 수정' : '운동 기록', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    let ok = required(date, '날짜를 선택하세요.');
    ok = timeOrder(start, end) && ok;
    // kg/rep/세트 음수 금지 (요구사항 16)
    for (const st of itemStates) {
      for (const row of st.setRows) {
        ok = nonNegativeOrEmpty(row.kgIn) && ok;
        ok = nonNegativeOrEmpty(row.repIn) && ok;
        ok = nonNegativeOrEmpty(row.setIn) && ok;
      }
    }
    if (!ok) return;

    const categoryTimes = catRows.filter(r => r.check.checked)
      .map(r => ({ categoryId: r.cat.id, name: r.cat.name, minutes: Number(r.minutes.value) || 0 }));

    const record = await saveLocal('exercise', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      date: date.value,
      weekday: weekdayOf(date.value),
      startTime: start.value, endTime: end.value,
      totalMinutes: Number(total.value) || 0,
      categoryTimes: JSON.stringify(categoryTimes),
      memo: memo.value
    });

    // 기존 종목/세트는 제거 후 현재 폼 내용으로 재생성 (수정 시 일관성 유지)
    if (existing) {
      const oldItems = await dbByIndex('exerciseItem', 'recordId', existing.id);
      for (const it of oldItems) {
        const oldSets = await dbByIndex('exerciseSet', 'itemId', it.id);
        for (const s of oldSets) await purgeLocal('exerciseSet', s.id);
        await purgeLocal('exerciseItem', it.id);
      }
    }
    let order = 0;
    for (const st of itemStates) {
      const name = st.nameInput.value.trim();
      if (!name) continue;
      const item = await saveLocal('exerciseItem', { recordId: record.id, name, orderIndex: order++ });
      let sOrder = 0;
      for (const row of st.setRows) {
        if (row.kgIn.value === '' && row.repIn.value === '' && row.setIn.value === '') continue;
        await saveLocal('exerciseSet', {
          itemId: item.id,
          kg: row.kgIn.value === '' ? '' : Number(row.kgIn.value),
          rep: row.repIn.value === '' ? '' : Number(row.repIn.value),
          sets: row.setIn.value === '' ? '' : Number(row.setIn.value),
          orderIndex: sOrder++
        });
      }
    }

    toast('운동 기록을 저장했습니다.');
    sheet.close();
    renderExercise(container);
  });
}

/* ================= 루틴 관리 (추가/수정/삭제/불러오기 — 요구사항 8-4) ================= */

async function openRoutineManager() {
  const box = document.createElement('div');
  const routines = await listActive('routine');

  if (!routines.length) box.appendChild(emptyState('저장된 루틴이 없습니다.'));
  for (const rt of routines) {
    const row = document.createElement('div');
    row.className = 'routine-row';
    const name = document.createElement('span');
    name.className = 'routine-name';
    name.textContent = rt.name;
    const useBtn = button('기록으로', 'btn btn-ghost btn-sm', '이 루틴으로 운동 기록 시작');
    const editBtn = button('수정', 'btn btn-ghost btn-sm');
    const delBtn = button('삭제', 'btn btn-ghost btn-sm');
    row.append(name, useBtn, editBtn, delBtn);
    box.appendChild(row);

    useBtn.addEventListener('click', async () => {
      // 루틴 내용으로 새 운동 기록 편집기 열기 (사본, 원본 불변)
      const rItems = (await dbByIndex('routineItem', 'routineId', rt.id))
        .filter(i => !i.deletedAt).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
      const preset = [];
      for (const it of rItems) {
        const rSets = (await dbByIndex('routineSet', 'routineItemId', it.id))
          .filter(s => !s.deletedAt).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
        preset.push({ name: it.name, sets: rSets });
      }
      let catIds = [];
      try { catIds = JSON.parse(rt.categoryIds || '[]'); } catch (e) { /* */ }
      sheet.close();
      openExerciseEditor(null, preset, catIds);
    });
    editBtn.addEventListener('click', () => { sheet.close(); openRoutineEditor(rt.id); });
    delBtn.addEventListener('click', async () => {
      if (await confirmDialog(`루틴 '${rt.name}'을 삭제할까요? (기존 운동 기록에는 영향이 없습니다)`, '삭제', true)) {
        await deleteLocal('routine', rt.id);
        toast('루틴을 삭제했습니다.');
        sheet.close();
        openRoutineManager();
      }
    });
  }

  const addBtn = button('+ 루틴 추가', 'btn btn-primary btn-block');
  addBtn.addEventListener('click', () => { sheet.close(); openRoutineEditor(null); });
  box.appendChild(addBtn);
  const sheet = openSheet('운동 루틴', box);
}

/** 루틴 편집기 (운동 기록 편집기와 유사, 시간 입력 없음) */
export async function openRoutineEditor(id) {
  const existing = id ? await dbGet('routine', id) : null;
  const form = document.createElement('div');

  const name = input('text', existing ? existing.name : '', { placeholder: '루틴 이름 (예: 상체 A)' });

  // 카테고리 다중 선택
  const catBox = document.createElement('div');
  const cats = await listActive('exerciseCategory');
  let selIds = [];
  try { selIds = JSON.parse((existing && existing.categoryIds) || '[]'); } catch (e) { /* */ }
  const catChecks = [];
  cats.forEach(c => {
    const label = document.createElement('label');
    label.className = 'check-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selIds.includes(c.id);
    label.append(check, document.createTextNode(' ' + c.name));
    catBox.appendChild(label);
    catChecks.push({ id: c.id, check });
  });

  const itemsBox = document.createElement('div');
  itemsBox.className = 'ex-items-box';
  const itemStates = [];

  function addItemCard(nm = '', sets = null) {
    const cardEl = document.createElement('div');
    cardEl.className = 'ex-item-card';
    const nameInput = input('text', nm, { placeholder: '종목 이름' });
    const removeItem = button('✕', 'icon-btn', '종목 삭제');
    const headRow = document.createElement('div');
    headRow.className = 'ex-item-head';
    headRow.append(nameInput, removeItem);
    const table = document.createElement('div');
    table.className = 'ex-set-table';
    const header = document.createElement('div');
    header.className = 'ex-set-row ex-set-header';
    header.innerHTML = '<span>kg</span><span>rep</span><span>세트</span><span></span>';
    table.appendChild(header);
    const state = { nameInput, setRows: [], el: cardEl };
    function addSetRow(kg = '', rep = '', setCount = '') {
      const row = document.createElement('div');
      row.className = 'ex-set-row';
      const kgIn = input('number', kg, { placeholder: 'kg', min: '0', step: '0.5' });
      const repIn = input('number', rep, { placeholder: 'rep', min: '0' });
      const setIn = input('number', setCount, { placeholder: '세트', min: '0' });
      const del = button('✕', 'icon-btn', '세트 구성 삭제');
      row.append(kgIn, repIn, setIn, del);
      table.appendChild(row);
      const rowState = { kgIn, repIn, setIn };
      state.setRows.push(rowState);
      del.addEventListener('click', () => {
        state.setRows.splice(state.setRows.indexOf(rowState), 1);
        row.remove();
      });
    }
    if (sets && sets.length) sets.forEach(s => addSetRow(s.kg, s.rep, s.sets));
    else addSetRow();
    const addSetBtn = button('+ 세트 구성 추가', 'btn btn-ghost btn-sm');
    addSetBtn.addEventListener('click', () => addSetRow());
    removeItem.addEventListener('click', () => {
      itemStates.splice(itemStates.indexOf(state), 1);
      cardEl.remove();
    });
    cardEl.append(headRow, table, addSetBtn);
    itemsBox.appendChild(cardEl);
    itemStates.push(state);
  }

  if (existing) {
    const rItems = (await dbByIndex('routineItem', 'routineId', existing.id))
      .filter(i => !i.deletedAt).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
    for (const it of rItems) {
      const rSets = (await dbByIndex('routineSet', 'routineItemId', it.id))
        .filter(s => !s.deletedAt).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));
      addItemCard(it.name, rSets);
    }
    if (!rItems.length) addItemCard();
  } else addItemCard();

  const addItemBtn = button('+ 운동 종목 추가', 'btn btn-ghost btn-block');
  addItemBtn.addEventListener('click', () => addItemCard());

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  form.append(field('루틴 이름', name), field('카테고리', catBox), itemsBox, addItemBtn, saveBtn);
  const sheet = openSheet(existing ? '루틴 수정' : '루틴 추가', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    if (!required(name, '루틴 이름을 입력하세요.')) return;

    const routine = await saveLocal('routine', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      name: name.value.trim(),
      categoryIds: JSON.stringify(catChecks.filter(c => c.check.checked).map(c => c.id))
    });

    if (existing) {
      const oldItems = await dbByIndex('routineItem', 'routineId', existing.id);
      for (const it of oldItems) {
        const oldSets = await dbByIndex('routineSet', 'routineItemId', it.id);
        for (const s of oldSets) await purgeLocal('routineSet', s.id);
        await purgeLocal('routineItem', it.id);
      }
    }
    let order = 0;
    for (const st of itemStates) {
      const nm = st.nameInput.value.trim();
      if (!nm) continue;
      const item = await saveLocal('routineItem', { routineId: routine.id, name: nm, orderIndex: order++ });
      let sOrder = 0;
      for (const row of st.setRows) {
        if (row.kgIn.value === '' && row.repIn.value === '' && row.setIn.value === '') continue;
        await saveLocal('routineSet', {
          routineItemId: item.id,
          kg: row.kgIn.value === '' ? '' : Number(row.kgIn.value),
          rep: row.repIn.value === '' ? '' : Number(row.repIn.value),
          sets: row.setIn.value === '' ? '' : Number(row.setIn.value),
          orderIndex: sOrder++
        });
      }
    }
    toast('루틴을 저장했습니다.');
    sheet.close();
  });
}

/* ---------------- 공용 ---------------- */
function selectWith(pairs, selected) {
  const sel = document.createElement('select');
  sel.className = 'input';
  pairs.forEach(([v, t]) => sel.appendChild(new Option(t, v)));
  if (selected !== undefined) sel.value = selected;
  return sel;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
