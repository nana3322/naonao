/**
 * pages/memo.js — 메모장 (요구사항 6)
 *  - 목록: 제목/카테고리/키워드/마지막 수정일/별/첨부 표시
 *  - ⭐ 즐겨찾기만 보기 토글은 검색 영역 밖(목록 상단)에 배치
 *  - 검색: 아이콘을 눌렀을 때만 펼침. 필터 순서 = 연도→카테고리→키워드→검색 내용
 *  - 탐색 메뉴(목차): ▶카테고리(접힘) / ▼키워드 → 키워드 탭 시 검색 필터 자동 적용
 *  - 편집기: 별(우상단, 저장 시 반영) / 손글씨·사진·음성은 버튼 눌렀을 때만 실행
 *  - 수정 이력: 저장 직전 전체 내용을 버전으로 보관, 접힌 상태 표시
 */
import { listActive, dbGet, dbByIndex } from '../db/indexedDb.js';
import { saveLocal, deleteLocal } from '../api/syncService.js';
import { openSheet, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { field, input, textarea, button, buildCategorySelect, emptyState, debounce } from '../state.js';
import { required, clearAllErrors } from '../utils/validation.js';
import { formatIsoShort } from '../utils/date.js';
import { pickPhotos, openHandwriting, openRecorder, attachmentUrl } from '../services/attachmentService.js';
import { uuid } from '../utils/uuid.js';

let container = null;
// 검색 상태 (탐색 메뉴에서 키워드 탭 시 여기에 반영)
const filter = { year: '', categoryId: '', keyword: '', text: '', favOnly: false, open: false };

export async function renderMemo(root, params = {}) {
  container = root;
  root.innerHTML = '';

  /* ---------- 상단: 검색 아이콘 + 탐색(목차) 아이콘 ---------- */
  const bar = document.createElement('div');
  bar.className = 'page-toolbar';
  const searchBtn = button('🔍', 'icon-btn', '검색 열기');
  const tocBtn = button('☰', 'icon-btn', '카테고리와 키워드 목록 열기');
  const newBtn = button('+ 새 메모', 'btn btn-primary');
  bar.append(searchBtn, tocBtn, newBtn);
  root.appendChild(bar);

  /* ---------- 검색 영역 (아이콘 눌렀을 때만 표시) ---------- */
  const searchPanel = document.createElement('div');
  searchPanel.className = 'card search-panel';
  searchPanel.hidden = !filter.open;
  root.appendChild(searchPanel);
  await buildSearchPanel(searchPanel);

  searchBtn.addEventListener('click', () => {
    filter.open = !filter.open;
    searchPanel.hidden = !filter.open;
  });
  tocBtn.addEventListener('click', openToc);
  newBtn.addEventListener('click', () => openMemoEditor(null));

  /* ---------- ⭐ 즐겨찾기만 보기 (검색 영역 밖) ---------- */
  const favToggle = document.createElement('label');
  favToggle.className = 'fav-toggle';
  const favCheck = document.createElement('input');
  favCheck.type = 'checkbox';
  favCheck.checked = filter.favOnly;
  favToggle.append(favCheck, document.createTextNode(' ⭐ 즐겨찾기만 보기'));
  favCheck.addEventListener('change', () => { filter.favOnly = favCheck.checked; drawList(); });
  root.appendChild(favToggle);

  /* ---------- 목록 ---------- */
  const listBox = document.createElement('div');
  listBox.className = 'memo-list';
  root.appendChild(listBox);

  async function drawList() {
    listBox.innerHTML = '';
    let memos = await listActive('memo');

    // 필터 적용
    if (filter.favOnly) memos = memos.filter(m => m.isFavorite === 'Y' || m.isFavorite === true);
    if (filter.year) memos = memos.filter(m => String(m.updatedAt || '').startsWith(filter.year));
    if (filter.categoryId) memos = memos.filter(m => m.categoryId === filter.categoryId);
    if (filter.keyword) memos = memos.filter(m => splitKeywords(m.keywords).includes(filter.keyword));
    if (filter.text) {
      const q = filter.text.toLowerCase();
      // 검색 내용은 제목 + 키워드 동시 검색 (요구사항 6-4)
      memos = memos.filter(m =>
        String(m.title || '').toLowerCase().includes(q) ||
        String(m.keywords || '').toLowerCase().includes(q));
    }
    memos.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    if (!memos.length) { listBox.appendChild(emptyState('메모가 없습니다. 새 메모를 작성해 보세요.')); return; }

    const atts = await listActive('attachment');
    const attByOwner = {};
    atts.forEach(a => { if (a.ownerType === 'memo') attByOwner[a.ownerId] = true; });

    for (const m of memos) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'memo-card';
      const cat = m.categoryId ? await dbGet('memoCategory', m.categoryId) : null;
      const fav = (m.isFavorite === 'Y' || m.isFavorite === true) ? '★ ' : '';
      const hasAtt = attByOwner[m.id] ? ' 📎' : '';
      card.innerHTML = `
        <div class="memo-card-title">${fav}${escapeHtml(m.title)}${hasAtt}</div>
        <div class="memo-card-meta">
          ${cat ? escapeHtml(cat.name) : '카테고리 없음'}
          ${m.keywords ? ' · ' + escapeHtml(m.keywords) : ''}
        </div>
        <div class="memo-card-date">수정 ${formatIsoShort(m.updatedAt)}</div>`;
      card.addEventListener('click', () => openMemoEditor(m.id));
      listBox.appendChild(card);
    }
  }
  root._drawList = drawList;
  await drawList();

  // 홈 퀵버튼 '#memo?new=1' 진입 처리
  if (params.new) openMemoEditor(null);
}

/* ---------------- 검색 패널 (순서: 연도→카테고리→키워드→내용) ---------------- */

async function buildSearchPanel(panel) {
  panel.innerHTML = '';
  const memos = await listActive('memo');

  // 1. 연도 (updatedAt 기준으로 존재하는 연도 + 전체)
  const yearSel = document.createElement('select');
  yearSel.className = 'input';
  const years = [...new Set(memos.map(m => String(m.updatedAt || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  yearSel.appendChild(new Option('전체', ''));
  years.forEach(y => yearSel.appendChild(new Option(y + '년', y)));
  yearSel.value = filter.year;
  yearSel.addEventListener('change', () => { filter.year = yearSel.value; container._drawList(); });

  // 2. 카테고리
  const catSel = document.createElement('select');
  catSel.className = 'input';
  catSel.appendChild(new Option('전체', ''));
  (await listActive('memoCategory')).forEach(c => catSel.appendChild(new Option(c.name, c.id)));
  catSel.value = filter.categoryId;
  catSel.addEventListener('change', () => { filter.categoryId = catSel.value; container._drawList(); });

  // 3. 키워드
  const kwSel = document.createElement('select');
  kwSel.className = 'input';
  kwSel.appendChild(new Option('전체', ''));
  allKeywords(memos).forEach(k => kwSel.appendChild(new Option(k, k)));
  kwSel.value = filter.keyword;
  kwSel.addEventListener('change', () => { filter.keyword = kwSel.value; container._drawList(); });

  // 4. 검색 내용 (제목+키워드, debounce)
  const textIn = input('search', filter.text, { placeholder: '제목·키워드 검색' });
  textIn.addEventListener('input', debounce(() => { filter.text = textIn.value.trim(); container._drawList(); }, 250));

  panel.append(
    field('연도', yearSel), field('카테고리', catSel),
    field('키워드', kwSel), field('검색 내용', textIn)
  );
  panel._kwSel = kwSel; panel._catSel = catSel; panel._yearSel = yearSel;
}

function splitKeywords(s) {
  return String(s || '').split(',').map(k => k.trim()).filter(Boolean);
}
function allKeywords(memos) {
  const set = new Set();
  memos.forEach(m => splitKeywords(m.keywords).forEach(k => set.add(k)));
  return [...set].sort();
}

/* ---------------- 탐색 메뉴 (▶카테고리 접힘 / ▼키워드) ---------------- */

async function openToc() {
  const box = document.createElement('div');
  const memos = await listActive('memo');
  const cats = await listActive('memoCategory');

  // ▶ 카테고리 (기본 접힘)
  const catHead = button('▶ 카테고리', 'toc-head');
  const catBody = document.createElement('div');
  catBody.hidden = true;
  cats.forEach(c => {
    const b = button(c.name, 'toc-item');
    b.addEventListener('click', () => {
      filter.categoryId = c.id;
      // 연도/키워드는 사용자가 직접 설정 안 했으면 '전체' 유지 (요구사항 6-5)
      applyFilterAndClose();
    });
    catBody.appendChild(b);
  });
  catHead.addEventListener('click', () => {
    catBody.hidden = !catBody.hidden;
    catHead.textContent = (catBody.hidden ? '▶' : '▼') + ' 카테고리';
  });

  // ▼ 키워드 (기본 펼침)
  const kwHead = button('▼ 키워드', 'toc-head');
  const kwBody = document.createElement('div');
  allKeywords(memos).forEach(k => {
    const b = button('#' + k, 'toc-item');
    b.addEventListener('click', () => {
      filter.keyword = k; // 키워드 필터만 자동 선택, 연도·카테고리는 유지
      applyFilterAndClose();
    });
    kwBody.appendChild(b);
  });
  if (!kwBody.children.length) kwBody.appendChild(emptyState('저장된 키워드가 없습니다.'));
  kwHead.addEventListener('click', () => {
    kwBody.hidden = !kwBody.hidden;
    kwHead.textContent = (kwBody.hidden ? '▶' : '▼') + ' 키워드';
  });

  box.append(catHead, catBody, kwHead, kwBody);
  const sheet = openSheet('메모 탐색', box);

  function applyFilterAndClose() {
    filter.open = true;
    sheet.close();
    renderMemo(container);
  }
}

/* ---------------- 메모 편집기 ---------------- */

async function openMemoEditor(memoId) {
  const existing = memoId ? await dbGet('memo', memoId) : null;
  const draftId = existing ? existing.id : uuid(); // 첨부 연결용 id 를 미리 확보
  const form = document.createElement('div');

  // 우상단 별 버튼 (화면상 즉시 토글, 데이터 반영은 저장 시 — 요구사항 6-2)
  let favState = existing ? (existing.isFavorite === 'Y' || existing.isFavorite === true) : false;
  const starBtn = button(favState ? '★' : '☆', 'icon-btn star-btn', '즐겨찾기');
  starBtn.addEventListener('click', () => {
    favState = !favState;
    starBtn.textContent = favState ? '★' : '☆';
  });

  const title = input('text', existing ? existing.title : '', { placeholder: '제목' });
  const catSel = await buildCategorySelect('memoCategory', {
    selectedId: existing ? existing.categoryId : '',
    allowEmpty: true, emptyLabel: '카테고리 없음',
    extraFields: { color: '' }
  });
  const keywords = input('text', existing ? existing.keywords : '', { placeholder: '키워드 (쉼표로 구분)' });
  const content = textarea(existing ? existing.content : '', 8);

  // 첨부 기능 버튼 (버튼을 눌렀을 때만 실행 — 요구사항 6-2)
  const attRow = document.createElement('div');
  attRow.className = 'att-row';
  const hwBtn = button('✍ 손글씨', 'btn btn-ghost');
  const photoBtn = button('📷 사진', 'btn btn-ghost');
  const voiceBtn = button('🎤 음성 기록', 'btn btn-ghost');
  attRow.append(hwBtn, photoBtn, voiceBtn);

  const attList = document.createElement('div');
  attList.className = 'att-list';
  async function drawAttachments() {
    attList.innerHTML = '';
    const atts = (await dbByIndex('attachment', 'ownerId', draftId)).filter(a => !a.deletedAt);
    for (const a of atts) {
      const item = document.createElement('div');
      item.className = 'att-item';
      const url = await attachmentUrl(a);
      if (a.fileType === 'audio') {
        const audio = document.createElement('audio');
        audio.controls = true;
        if (url) audio.src = url;
        item.appendChild(audio);
      } else {
        const img = document.createElement('img');
        img.alt = a.fileType === 'handwriting' ? '손글씨 이미지' : '첨부 사진';
        if (url) img.src = url;
        item.appendChild(img);
      }
      const del = button('✕', 'icon-btn att-del', '첨부 삭제');
      del.addEventListener('click', async () => {
        if (await confirmDialog('이 첨부를 삭제할까요?', '삭제', true)) {
          await deleteLocal('attachment', a.id);
          drawAttachments();
        }
      });
      item.appendChild(del);
      attList.appendChild(item);
    }
  }
  await drawAttachments();

  hwBtn.addEventListener('click', () => openHandwriting('memo', draftId, drawAttachments));
  photoBtn.addEventListener('click', () => pickPhotos('memo', draftId, drawAttachments));
  voiceBtn.addEventListener('click', () => openRecorder('memo', draftId, drawAttachments));

  // 수정 이력 (기존 메모만, 접힌 상태 — 요구사항 6-3)
  const historyBox = document.createElement('div');
  if (existing) {
    const versions = (await dbByIndex('memoVersion', 'memoId', existing.id))
      .sort((a, b) => Number(a.version) - Number(b.version));
    const head = button(`▶ 수정 이력 (${versions.length})`, 'toc-head');
    const body = document.createElement('div');
    body.hidden = true;
    versions.forEach(v => {
      const b = button(`버전 ${v.version} — ${formatIsoShort(v.savedAt)}`, 'toc-item');
      b.addEventListener('click', () => openVersionView(v));
      body.appendChild(b);
    });
    if (!versions.length) body.appendChild(emptyState('수정 이력이 없습니다.'));
    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      head.textContent = (body.hidden ? '▶' : '▼') + ` 수정 이력 (${versions.length})`;
    });
    historyBox.append(head, body);
  }

  const saveBtn = button('저장', 'btn btn-primary btn-block');
  const delBtn = existing ? button('삭제', 'btn btn-danger btn-block') : null;

  const topRow = document.createElement('div');
  topRow.className = 'editor-top';
  topRow.appendChild(starBtn);

  form.append(topRow, field('제목', title), field('카테고리', catSel.el),
    field('키워드', keywords), field('내용', content),
    attRow, attList, historyBox, saveBtn);
  if (delBtn) form.appendChild(delBtn);

  const sheet = openSheet(existing ? '메모 수정' : '새 메모', form, { full: true });

  saveBtn.addEventListener('click', async () => {
    clearAllErrors(form);
    if (!required(title, '제목을 입력하세요.')) return;

    // 수정이면 저장 직전 전체 내용을 이전 버전으로 보관 (요구사항 6-3)
    if (existing) {
      const versions = await dbByIndex('memoVersion', 'memoId', existing.id);
      const atts = (await dbByIndex('attachment', 'ownerId', existing.id)).filter(a => !a.deletedAt);
      await saveLocal('memoVersion', {
        memoId: existing.id,
        version: versions.length + 1,
        title: existing.title, categoryId: existing.categoryId,
        keywords: existing.keywords, content: existing.content,
        isFavorite: existing.isFavorite,
        attachmentMeta: JSON.stringify(atts.map(a => ({ id: a.id, fileType: a.fileType, fileName: a.fileName }))),
        savedAt: existing.updatedAt
      });
    }

    await saveLocal('memo', {
      ...(existing || {}),
      id: draftId,
      title: title.value.trim(),
      categoryId: catSel.getValue(),
      keywords: keywords.value.trim(),
      content: content.value,
      isFavorite: favState ? 'Y' : 'N'
    });
    toast('메모를 저장했습니다.');
    sheet.close();
    renderMemo(container);
  });

  if (delBtn) delBtn.addEventListener('click', async () => {
    if (await confirmDialog('이 메모를 휴지통으로 이동할까요?', '삭제', true)) {
      await deleteLocal('memo', existing.id);
      toast('휴지통으로 이동했습니다.');
      sheet.close();
      renderMemo(container);
    }
  });
}

/** 버전 읽기 전용 보기 */
function openVersionView(v) {
  const box = document.createElement('div');
  box.className = 'version-view';
  box.innerHTML = `
    <div class="detail-line"><strong>${escapeHtml(v.title)}</strong>
      ${v.isFavorite === 'Y' ? ' ★' : ''}</div>
    <div class="detail-line">키워드: ${escapeHtml(v.keywords || '없음')}</div>
    <div class="detail-line detail-memo">${escapeHtml(v.content || '')}</div>
    <div class="detail-line small">저장 시각: ${formatIsoShort(v.savedAt)}</div>`;
  openSheet(`버전 ${v.version} (읽기 전용)`, box);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
