const CACHE_NAME = 'aigen-v4'; // 구버전 캐시 강제 삭제
const STATIC_ASSETS = ['/icon.svg', '/manifest.json']; // HTML은 캐시 안 함

// 설치: 정적 자산만 캐시 (index.html 제외)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 구버전 캐시 전부 삭제 + 즉시 컨트롤 획득
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase / 외부 API: SW 개입 없이 통과
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebasestorage') ||
    url.hostname.includes('ical.marudot.com') ||
    e.request.method !== 'GET'
  ) return;

  // HTML(navigate): 항상 네트워크에서 최신 버전 — 캐시 폴백 없음
  // 구버전 JS가 캐시에서 서빙돼 syncToFirebase() 전체 덮어쓰기 발생하는 문제 방지
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  // 정적 자산(SVG, manifest): 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
