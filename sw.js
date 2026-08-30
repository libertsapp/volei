// Service Worker do Volei de Terça — existe SÓ pra deixar o site instalável
// como app (PWA). De propósito, ele NÃO guarda nada em cache: só repassa
// toda requisição direto pra rede, sempre. Isso é intencional — já tivemos
// um problema sério de dados desatualizados por causa de cache de requisição,
// e a ideia aqui é nunca mais correr esse risco.
//
// Onde colocar este arquivo: na MESMA pasta do volei-dashboard.html no seu
// host (ex: se o site é seusite.com/volei-dashboard.html, este arquivo
// precisa estar em seusite.com/sw.js).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // sempre busca da rede — nunca responde com algo guardado localmente
  event.respondWith(fetch(event.request));
});
