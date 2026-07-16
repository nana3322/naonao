/**
 * app.js — 앱 진입점
 *  - IndexedDB 초기화, 테마 적용, 동기화 시작, 서비스 워커 등록
 *  - 해시 라우터: #home / #memo / #ledger / #exercise / #cycle / #settings
 *    쿼리 파라미터 지원: #memo?new=1, #exercise?open=<id>
 */
import { openDb } from './db/indexedDb.js';
import { initSync } from './api/syncService.js';
import { getSetting, applyTheme } from './state.js';
import { renderHome } from './pages/home.js';
import { renderMemo } from './pages/memo.js';
import { renderLedger } from './pages/ledger.js';
import { renderExercise } from './pages/exercise.js';
import { renderCycle } from './pages/cycle.js';
import { renderSettings } from './pages/settings.js';

const PAGES = {
  home: renderHome,
  memo: renderMemo,
  ledger: renderLedger,
  exercise: renderExercise,
  cycle: renderCycle,
  settings: renderSettings
};

/** 현재 해시 → { page, params } */
function parseHash() {
  const raw = (location.hash || '#home').slice(1);
  const [page, query] = raw.split('?');
  const params = {};
  if (query) {
    query.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
  }
  return { page: PAGES[page] ? page : 'home', params };
}

async function route() {
  const { page, params } = parseHash();
  const main = document.getElementById('page');
  main.scrollTop = 0;

  // 하단 탭 활성 표시
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.page === page);
    tab.setAttribute('aria-current', tab.dataset.page === page ? 'page' : 'false');
  });

  await PAGES[page](main, params);
  // 파라미터는 1회성 → 해시 정리 (뒤로가기 시 재실행 방지)
  if (Object.keys(params).length) {
    history.replaceState(null, '', '#' + page);
  }
}

async function init() {
  await openDb();
  applyTheme(await getSetting('theme'));
  // 시스템 테마 변경 감지 (시스템 설정 따르기일 때)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    applyTheme(await getSetting('theme'));
  });

  initSync();

  // 하단 탭 클릭 → 해시 변경
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => { location.hash = '#' + tab.dataset.page; });
  });

  window.addEventListener('hashchange', route);
  await route();

  // 서비스 워커 등록 (PWA 오프라인 지원)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(e => {
      console.warn('서비스 워커 등록 실패:', e.message);
    });
  }
}

init();
