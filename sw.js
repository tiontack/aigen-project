const CACHE_NAME = 'aigen-v3';
const OFFLINE_URL = '/index.html';

// 설치: 앱 셸 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll([OFFLINE_URL, '/icon.svg', '/manifest.json']))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 이전 캐시 정리
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Firebase 실시간 데이터는 항상 네트워크 우선, 실패 시 캐시 폴백
self.addEventListener('fetch', e => {
  // Firebase / 외부 API 요청은 SW 개입 없이 그대로 통과
  const url = new URL(e.request.url);
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebasestorage') ||
    url.hostname.includes('ical.marudot.com') ||
    e.request.method !== 'GET'
  ) return;

  // 앱 HTML(index.html): 네트워크 우선, 오프라인 시 캐시
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(OFFLINE_URL, clone));
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 정적 자산(SVG, manifest 등): 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
