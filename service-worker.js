/**
 * service-worker.js — PWA 오프라인 지원
 *  - 앱 셸(HTML/CSS/JS/아이콘)을 설치 시 캐시
 *  - 정적 파일: 캐시 우선, 네트워크 폴백
 *  - API(POST) 요청은 캐시하지 않음 (동기화는 IndexedDB 큐가 담당)
 * 새 버전 배포 시 CACHE_VERSION 을 올리면 이전 캐시가 정리된다.
 */
const CACHE_VERSION = 'life-manager-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/pages.css',
  './js/config.js',
  './js/app.js',
  './js/state.js',
  './js/utils/date.js',
  './js/utils/currency.js',
  './js/utils/uuid.js',
  './js/utils/validation.js',
  './js/db/indexedDb.js',
  './js/db/syncQueue.js',
  './js/api/gasApi.js',
  './js/api/syncService.js',
  './js/components/toast.js',
  './js/components/modal.js',
  './js/components/calendar.js',
  './js/services/attachmentService.js',
  './js/services/cycleService.js',
  './js/pages/home.js',
  './js/pages/memo.js',
  './js/pages/ledger.js',
  './js/pages/exercise.js',
  './js/pages/cycle.js',
  './js/pages/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // API 요청(POST)과 외부 도메인은 그대로 네트워크로
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // 성공한 정적 파일은 캐시에 보관
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // 오프라인에서 캐시에 없는 페이지 → 앱 셸로
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 503 });
      });
    })
  );
});
