/**
 * state.js — 화면 간 공유 상태와 공용 UI 헬퍼
 *  - 설정 캐시 (테마, 가계부 색상, 주기 기본값)
 *  - 가계부 구분(수입/지출/저금) 색상 계산
 *  - '+ 직접 입력' 지원 카테고리 드롭다운 빌더 (요구사항 7-1)
 *  - 폼 요소 생성 헬퍼
 */
import { getSettingLocal, setSettingLocal, listActive } from './db/indexedDb.js';
import { saveLocal } from './api/syncService.js';
import { COLOR_MAP } from './config.js';
import { apiRequest } from './api/gasApi.js';

/* ---------------- 설정 ---------------- */

const DEFAULT_SETTINGS = {
  theme: 'system',
  colorIncome: '초록', colorExpense: '빨강', colorSaving: '파랑',
  cycleDefaultLength: 28, cycleDefaultPeriod: 5
};

export async function getSetting(key) {
  const v = await getSettingLocal(key, null);
  return v === null ? DEFAULT_SETTINGS[key] : v;
}

/** 설정 저장: 로컬 즉시 반영 + 온라인이면 서버 '설정' 시트에도 기록 */
export async function saveSetting(key, value) {
  await setSettingLocal(key, value);
  if (navigator.onLine) {
    apiRequest('setSetting', { key, value }).catch(() => { /* 오프라인/실패 무시 */ });
  }
}

/** 현재 테마가 다크인지 */
export function isDarkNow() {
  return document.documentElement.dataset.theme === 'dark';
}

/** 테마 적용 (light | dark | system) */
export function applyTheme(theme) {
  let mode = theme;
  if (theme === 'system') {
    mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = mode;
}

/** 수입/지출/저금 표시 색 (다크모드 보정 포함) */
export async function ledgerColor(type) {
  const key = type === '수입' ? 'colorIncome' : type === '저금' ? 'colorSaving' : 'colorExpense';
  const name = await getSetting(key);
  const entry = COLOR_MAP[name] || COLOR_MAP['검정'];
  return isDarkNow() ? entry.dark : entry.light;
}

/* ---------------- 카테고리 드롭다운 (+ 직접 입력) ---------------- */

/**
 * 카테고리 select 를 만들고 '+ 직접 입력' 선택 시 즉시 새 카테고리를
 * 생성(IndexedDB + syncQueue → 서버)하여 선택값으로 설정한다.
 * @param resource 카테고리 리소스 이름 (예: 'personalCategory')
 * @param opts { selectedId, allowEmpty, emptyLabel, extraFields } 
 * @returns { el, getValue }  el=div(select 포함), getValue()=선택된 카테고리 id
 */
export async function buildCategorySelect(resource, opts = {}) {
  const wrap = document.createElement('div');
  const select = document.createElement('select');
  select.className = 'input';
  wrap.appendChild(select);

  async function reload(selectedId) {
    const cats = (await listActive(resource)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    select.innerHTML = '';
    if (opts.allowEmpty) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = opts.emptyLabel || '선택 안 함';
      select.appendChild(o);
    }
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = (c.icon ? c.icon + ' ' : '') + c.name;
      select.appendChild(o);
    });
    const custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = '+ 직접 입력';
    select.appendChild(custom);
    if (selectedId) select.value = selectedId;
    else if (!opts.allowEmpty && cats.length) select.value = cats[0].id;
  }
  await reload(opts.selectedId);

  // '+ 직접 입력' → 이름 입력 → 즉시 생성 후 선택 (요구사항 7-1)
  select.addEventListener('change', async () => {
    if (select.value !== '__custom__') return;
    const name = prompt('새 카테고리 이름을 입력하세요.');
    if (!name || !name.trim()) { select.selectedIndex = 0; return; }
    const rec = { name: name.trim(), ...(opts.extraFields || {}) };
    const saved = await saveLocal(resource, rec); // 로컬 저장 + 서버 동기화 큐
    await reload(saved.id);
  });

  return { el: wrap, select, getValue: () => (select.value === '__custom__' ? '' : select.value), reload };
}

/** 카테고리 id → 이름 (삭제된 카테고리도 이름 스냅샷 유지: 요구사항 10-2) */
export async function categoryName(resource, id, fallback = '') {
  if (!id) return fallback;
  const { dbGet } = await import('./db/indexedDb.js');
  const c = await dbGet(resource, id);
  return c ? c.name : fallback || '(삭제된 카테고리)';
}

export async function categoryIcon(resource, id) {
  if (!id) return '';
  const { dbGet } = await import('./db/indexedDb.js');
  const c = await dbGet(resource, id);
  return c && c.icon ? c.icon : '';
}

/* ---------------- 폼 요소 헬퍼 ---------------- */

/** label + input 묶음 생성 */
export function field(labelText, inputEl) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = 'f-' + Math.random().toString(36).slice(2, 8);
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = labelText;
  const target = inputEl.matches && inputEl.matches('input,select,textarea') ? inputEl
    : inputEl.querySelector ? inputEl.querySelector('input,select,textarea') : null;
  if (target) target.id = id;
  wrap.append(label, inputEl);
  return wrap;
}

export function input(type, value = '', attrs = {}) {
  const el = document.createElement('input');
  el.type = type;
  el.className = 'input';
  el.value = value;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  // 숫자 입력엔 모바일 숫자 키패드 (요구사항 8-3)
  if (type === 'number') el.setAttribute('inputmode', 'numeric');
  return el;
}

export function textarea(value = '', rows = 4) {
  const el = document.createElement('textarea');
  el.className = 'input';
  el.rows = rows;
  el.value = value;
  return el;
}

export function button(label, cls = 'btn btn-primary', ariaLabel = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

/** 빈 목록 안내 */
export function emptyState(message) {
  const d = document.createElement('div');
  d.className = 'empty-state';
  d.textContent = message;
  return d;
}

/** 로딩 스켈레톤 n개 */
export function skeletons(n = 3) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton';
    frag.appendChild(s);
  }
  return frag;
}

/** debounce (검색 입력용, 요구사항 17) */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
