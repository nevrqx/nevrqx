// Имя кэша
const CACHE_NAME = 'universal-portal-cache-v1';

// Файлы для предварительного кэширования
const urlsToCache = [
  '/',
  '/index.html',
  '/offline.html',
  '/style.css',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.quilljs.com/1.3.6/quill.snow.css',
  'https://cdn.quilljs.com/1.3.6/quill.min.js'
];

// Установка Service Worker и кэширование основных файлов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Открыт кэш');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: сначала сеть, затем кэш
self.addEventListener('fetch', event => {
  // Пропускаем запросы к Supabase API
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Если получен ответ, клонируем его и сохраняем в кэше
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // Если сеть недоступна, пытаемся получить из кэша
        return caches.match(event.request)
          .then(response => {
            // Если запрос найден в кэше, возвращаем его
            if (response) {
              return response;
            }
            
            // Если запрос HTML-страницы, показываем offline.html
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }
            
            // Для изображений возвращаем заглушку
            if (event.request.url.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) {
              return new Response(
                '<svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">' +
                '<rect width="400" height="300" fill="#eee" />' +
                '<text x="200" y="150" font-size="20" text-anchor="middle" fill="#999">Изображение недоступно</text>' +
                '</svg>',
                { 
                  headers: { 'Content-Type': 'image/svg+xml' } 
                }
              );
            }
          });
      })
  );
});

// Обработка push-уведомлений
self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: 'icons/icon-192x192.png',
    badge: 'icons/badge.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
}); 