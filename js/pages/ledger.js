/**
 * pages/ledger.js — 가계부 (요구사항 7)
 *  상단 탭: 개인 | 학교
 *  개인: 날짜/구분(수입·지출·저금)/카테고리/내용/금액/비고, '구분) 카테고리 - 내용' 표기
 *  학교: 지출만. 프로젝트 선택은 선택 사항(일반 지출 가능). 세부 카테고리는
 *        프로젝트 연결 카테고리 우선, 미선택 시 공통 카테고리.
 */
import { listActive, dbGet } from '../db/indexedDb.js';
import { saveLocal, deleteLocal } from '../api/syncService.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, textarea, button, buildCategorySelect, ledgerColor, emptyState, debounce } from '../state.js';
import { required, positiveNumber, clearAllErrors } from '../utils/validation.js';
import { won, parseAmount } from '../utils/currency.js';
import { today, ymd, ymdToMdShort } from '../utils/date.js';

let container = null;
let activeTab = 'personal'; // 'personal' | 'school' (마지막 사용 탭 유지)
const pFilter = { year: '', month: '', type: '', categoryId: '', text: '' };
const sFilter = { year: '', month: '', projectId: '', text: '' };

export async function renderLedger(root, params = {}) {
  container = root;
  root.innerHTML = '';

  // 상단 탭
  const tabs = document.createElement('div');
  tabs.className = 'seg-tabs';
  const pTab = button('개인', 'seg-tab' + (activeTab === 'personal' ? ' active' : ''));
  const sTab = button('학교', 'seg-tab' + (activeTab === 'school' ? ' active' : ''));
  tabs.append(pTab, sTab);
  root.appendChild(tabs);
  pTab.addEventListener('click', () => { activeTab = 'personal'; renderLedger(root); });
  sTab.addEventListener('click', () => { activeTab = 'school'; renderLedger(root); });

  const body = document.createElement('div');
  root.appendChild(body);

  if (activeTab === 'personal') await renderPersonal(body);
  else await renderSchool(body);

  // 홈 '가계부 쓰기' 진입: 마지막 사용 탭의 입력 화면 바로 열기 (요구사항 4-3)
  if (params.new) {
    if (activeTab === 'personal') openPersonalEditor(null);
    else openSchoolEditor(null);
  }
}

/* ================= 개인 가계부 ================= */

async function renderPersonal(root) {
  const bar = document.createElement('div');
  bar.className = 'page-toolbar';
  const newBtn = button('+ 내역 추가', 'btn btn-primary');
  bar.appendChild(newBtn);
  root.appendChild(bar);
  newBtn.addEventListener('click', () => openPersonalEditor(null));

  // 필터: 연도/월/구분/카테고리/내용 검색 (요구사항 7-1)
  const panel = document.createElement('div');
  panel.className = 'card search-panel';
  root.appendChild(panel);

  const rows = await listActive('ledgerPersonal');
  const years = [...new Set(rows.map(r => String(r.date).slice(0, 4)))].sort().reverse();

  const yearSel = selectWith([['', '전체']].concat(years.map(y => [y, y + '년'])), pFilter.year);
  const monthSel = selectWith([['', '전체']].concat(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), (i + 1) + '월'])), pFilter.month);
  const typeSel = selectWith([['', '전체'], ['수입', '수입'], ['지출', '지출'], ['저금', '저금']], pFilter.type);
  const catSel = document.createElement('select');
  catSel.className = 'input';
  catSel.appendChild(new Option('전체', ''));
  (await listActive('personalCategory')).forEach(c => catSel.appendChild(new Option(c.name, c.id)));
  catSel.value = pFilter.categoryId;
  const textIn = input('search', pFilter.text, { placeholder: '내용 검색' });

  panel.append(field('연도', yearSel), field('월', monthSel), field('구분', typeSel),
    field('카테고리', catSel), field('내용 검색', textIn));

  const listBox = document.createElement('div');
  root.appendChild(listBox);

  async function draw() {
    listBox.innerHTML = '';
    let items = await listActive('ledgerPersonal');
    if (pFilter.year) items = items.filter(r => String(r.date).startsWith(pFilter.year));
    if (pFilter.month) items = items.filter(r => String(r.date).slice(5, 7) === pFilter.month);
    if (pFilter.type) items = items.filter(r => r.type === pFilter.type);
    if (pFilter.categoryId) items = items.filter(r => r.categoryId === pFilter.categoryId);
    if (pFilter.text) {
      const q = pFilter.text.toLowerCase();
      items = items.filter(r => String(r.content || '').toLowerCase().includes(q));
    }
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!items.length) { listBox.appendChild(emptyState('가계부 내역이 없습니다.')); return; }

    for (const r of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ledger-card';
      const color = await ledgerColor(r.type);
      const cat = r.categoryId ? await dbGet('personalCategory', r.categoryId) : null;
      const catName = cat ? cat.name : (r.categoryName || '기타');
      // 표시 형식: 구분) 카테고리 - 내용 (카테고리가 내용보다 먼저)
      card.innerHTML = `
        <div class="ledger-main">
          <span class="ledger-type" style="color:${color}">${r.type})</span>
          ${escapeHtml(catName)} - ${escapeHtml(r.content || '')}
        </div>
        <div class="ledger-sub">${ymdToMdShort(r.date)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
        <div class="ledger-amount" style="color:${color}">${won(r.amount)}</div>`;
      card.addEventListener('click', () => openPersonalEditor(r.id));
      listBox.appendChild(card);
    }
  }
  yearSel.addEventListener('change', () => { pFilter.year = yearSel.value; draw(); });
  monthSel.addEventListener('change', () => { pFilter.month = monthSel.value; draw(); });
  typeSel.addEventListener('change', () => { pFilter.type = typeSel.value; draw(); });
  catSel.addEventListener('change', () => { pFilter.categoryId = catSel.value; draw(); });
  textIn.addEventListener('input', debounce(() => { pFilter.text = textIn.value.trim(); draw(); }, 250));
  await draw();
}

async function openPersonalEditor(id) {
  const existing = id ? await dbGet('ledgerPersonal', id) : null;
  const form = document.createElement('div');

  const date = input('date', existing ? existing.date : ymd(today()));
  const typeSel = selectWith([['수입', '수입'], ['지출', '지출'], ['저금', '저금']], existing ? existing.type : '지출');
  const catSel = await buildCategorySelect('personalCategory', {
    selectedId: existing ? existing.categoryId : ''
  });
  const content = input('text', existing ? existing.content : '', { placeholder: '내용' });
  const amount = input('number', existing ? existing.amount : '', { placeholder: '금액 (숫자만)', min: '0' });
  const note = input('text', existing ? existing.note : '', { placeholder: '비고 (선택)' });

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  form.append(field('날짜', date), field('구분', typeSel), field('카테고리', catSel.el),
    field('내용', content), field('금액', amount), field('비고', note), saveBtn);
  if (existing) {
    const delBtn = button('삭제', 'btn btn-danger btn-block');
    form.appendChild(delBtn);
    delBtn.addEventListener('click', async () => {
      if (await confirmDialog('이 내역을 휴지통으로 이동할까요?', '삭제', true)) {
        await deleteLocal('ledgerPersonal', existing.id);
        toast('휴지통으로 이동했습니다.');
        sheet.close();
        renderLedger(container);
      }
    });
  }

  const sheet = openSheet(existing ? '내역 수정' : '개인 가계부 입력', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    let ok = required(date, '날짜를 선택하세요.');
    ok = required(content, '내용을 입력하세요.') && ok;
    ok = positiveNumber(amount, '금액은 0보다 큰 숫자여야 합니다.') && ok;
    if (!ok) return;

    const cat = catSel.getValue() ? await dbGet('personalCategory', catSel.getValue()) : null;
    await saveLocal('ledgerPersonal', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      date: date.value, type: typeSel.value,
      categoryId: catSel.getValue(),
      categoryName: cat ? cat.name : '', // 카테고리 삭제 대비 이름 스냅샷 (요구사항 10-2)
      content: content.value.trim(),
      amount: parseAmount(amount.value),
      note: note.value.trim()
    });
    toast('저장했습니다.');
    sheet.close();
    renderLedger(container);
  });
}

/* ================= 학교 가계부 ================= */

async function renderSchool(root) {
  const bar = document.createElement('div');
  bar.className = 'page-toolbar';
  const newBtn = button('+ 지출 추가', 'btn btn-primary');
  bar.appendChild(newBtn);
  root.appendChild(bar);
  newBtn.addEventListener('click', () => openSchoolEditor(null));

  const panel = document.createElement('div');
  panel.className = 'card search-panel';
  root.appendChild(panel);

  const rows = await listActive('ledgerSchool');
  const years = [...new Set(rows.map(r => String(r.date).slice(0, 4)))].sort().reverse();
  const yearSel = selectWith([['', '전체']].concat(years.map(y => [y, y + '년'])), sFilter.year);
  const monthSel = selectWith([['', '전체']].concat(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), (i + 1) + '월'])), sFilter.month);
  const projSel = document.createElement('select');
  projSel.className = 'input';
  projSel.appendChild(new Option('전체', ''));
  projSel.appendChild(new Option('일반 (프로젝트 없음)', '__none__'));
  (await listActive('schoolProject')).forEach(p => projSel.appendChild(new Option(p.name, p.id)));
  projSel.value = sFilter.projectId;
  const textIn = input('search', sFilter.text, { placeholder: '내용 검색' });
  panel.append(field('연도', yearSel), field('월', monthSel), field('프로젝트', projSel), field('내용 검색', textIn));

  const listBox = document.createElement('div');
  root.appendChild(listBox);

  async function draw() {
    listBox.innerHTML = '';
    let items = await listActive('ledgerSchool');
    if (sFilter.year) items = items.filter(r => String(r.date).startsWith(sFilter.year));
    if (sFilter.month) items = items.filter(r => String(r.date).slice(5, 7) === sFilter.month);
    if (sFilter.projectId === '__none__') items = items.filter(r => !r.projectId);
    else if (sFilter.projectId) items = items.filter(r => r.projectId === sFilter.projectId);
    if (sFilter.text) {
      const q = sFilter.text.toLowerCase();
      items = items.filter(r => String(r.content || '').toLowerCase().includes(q));
    }
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!items.length) { listBox.appendChild(emptyState('학교 지출 내역이 없습니다.')); return; }

    const expenseColor = await ledgerColor('지출');
    for (const r of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ledger-card';
      const proj = r.projectId ? await dbGet('schoolProject', r.projectId) : null;
      const sub = r.subCategoryId ? await dbGet('schoolCategory', r.subCategoryId) : null;
      card.innerHTML = `
        <div class="ledger-main">
          <span class="ledger-proj">[${proj ? escapeHtml(proj.name) : '일반'}]</span>
          ${sub ? escapeHtml(sub.name) : (r.subCategoryName ? escapeHtml(r.subCategoryName) : '기타')} - ${escapeHtml(r.content || '')}
        </div>
        <div class="ledger-sub">${ymdToMdShort(r.date)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
        <div class="ledger-amount" style="color:${expenseColor}">${won(r.amount)}</div>`;
      card.addEventListener('click', () => openSchoolEditor(r.id));
      listBox.appendChild(card);
    }
  }
  yearSel.addEventListener('change', () => { sFilter.year = yearSel.value; draw(); });
  monthSel.addEventListener('change', () => { sFilter.month = monthSel.value; draw(); });
  projSel.addEventListener('change', () => { sFilter.projectId = projSel.value; draw(); });
  textIn.addEventListener('input', debounce(() => { sFilter.text = textIn.value.trim(); draw(); }, 250));
  await draw();
}

async function openSchoolEditor(id) {
  const existing = id ? await dbGet('ledgerSchool', id) : null;
  const form = document.createElement('div');

  const date = input('date', existing ? existing.date : ymd(today()));

  // 프로젝트: 선택 사항 (없으면 일반 지출 — 요구사항 7-3)
  const projSel = document.createElement('select');
  projSel.className = 'input';
  projSel.appendChild(new Option('프로젝트 없음 (일반 지출)', ''));
  const projects = await listActive('schoolProject');
  projects.forEach(p => projSel.appendChild(new Option(p.name, p.id)));
  projSel.value = existing ? (existing.projectId || '') : '';

  // 세부 카테고리: 프로젝트 연결 카테고리 우선, 없으면 공통 (요구사항 7-5)
  const subWrap = document.createElement('div');
  let subSel = null;
  async function rebuildSub(selectedId) {
    subWrap.innerHTML = '';
    const projId = projSel.value;
    const built = await buildCategorySelect('schoolCategory', {
      selectedId, allowEmpty: true, emptyLabel: '세부 카테고리 없음',
      extraFields: { projectId: projId || '' }
    });
    // 프로젝트 선택 시: 해당 프로젝트 카테고리 + 공통 카테고리, 미선택 시 공통만
    const all = await listActive('schoolCategory');
    const filtered = projId
      ? all.filter(c => c.projectId === projId || !c.projectId)
      : all.filter(c => !c.projectId);
    built.select.innerHTML = '';
    built.select.appendChild(new Option('세부 카테고리 없음', ''));
    // 프로젝트 연결 카테고리를 먼저 표시
    filtered.sort((a, b) => (b.projectId ? 1 : 0) - (a.projectId ? 1 : 0));
    filtered.forEach(c => built.select.appendChild(new Option(c.name + (c.projectId ? '' : ' (공통)'), c.id)));
    built.select.appendChild(new Option('+ 직접 입력', '__custom__'));
    if (selectedId) built.select.value = selectedId;
    subSel = built;
    subWrap.appendChild(built.el);
  }
  await rebuildSub(existing ? existing.subCategoryId : '');
  projSel.addEventListener('change', () => rebuildSub(''));

  const content = input('text', existing ? existing.content : '', { placeholder: '내용' });
  const amount = input('number', existing ? existing.amount : '', { placeholder: '금액 (숫자만)', min: '0' });
  const note = input('text', existing ? existing.note : '', { placeholder: '비고 (선택)' });

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  form.append(field('날짜', date), field('프로젝트', projSel), field('세부 카테고리', subWrap),
    field('내용', content), field('금액', amount), field('비고', note), saveBtn);
  if (existing) {
    const delBtn = button('삭제', 'btn btn-danger btn-block');
    form.appendChild(delBtn);
    delBtn.addEventListener('click', async () => {
      if (await confirmDialog('이 내역을 휴지통으로 이동할까요?', '삭제', true)) {
        await deleteLocal('ledgerSchool', existing.id);
        toast('휴지통으로 이동했습니다.');
        sheet.close();
        renderLedger(container);
      }
    });
  }

  const sheet = openSheet(existing ? '학교 지출 수정' : '학교 가계부 입력', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    let ok = required(date, '날짜를 선택하세요.');
    ok = required(content, '내용을 입력하세요.') && ok;
    ok = positiveNumber(amount, '금액은 0보다 큰 숫자여야 합니다.') && ok;
    if (!ok) return;

    const subId = subSel ? subSel.getValue() : '';
    const sub = subId ? await dbGet('schoolCategory', subId) : null;
    await saveLocal('ledgerSchool', {
      ...(existing || {}),
      id: existing ? existing.id : undefined,
      date: date.value,
      projectId: projSel.value || '',
      subCategoryId: subId,
      subCategoryName: sub ? sub.name : '',
      content: content.value.trim(),
      amount: parseAmount(amount.value),
      note: note.value.trim()
    });
    toast('저장했습니다.');
    sheet.close();
    renderLedger(container);
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
