const CACHE_NAME = 'firesafe-v195';
const ASSETS = [
    '/Firesafe-ordreseddel/',
    '/Firesafe-ordreseddel/index.html',
    '/Firesafe-ordreseddel/styles.css',
    '/Firesafe-ordreseddel/script.js',
    '/Firesafe-ordreseddel/script-ui.js',
    '/Firesafe-ordreseddel/lang.js',
    '/Firesafe-ordreseddel/icon-192.png',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Only handle http/https requests (skip chrome-extension, etc.)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }

    // Let Firebase requests go to network always
    if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('firebaseapp.com')) {
        return;
    }

    // Network-first strategy: always try network, fall back to cache
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Update cache with fresh response
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request);
            })
    );
});
