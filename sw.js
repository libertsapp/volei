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
  // sempre busca da rede — nunca responde com algo guardado localmente.
  // cache:'no-store' é essencial aqui: sem isso, fetch() simples ainda respeita o
  // Cache-Control do host (GitHub Pages manda max-age=600), e um app instalado que
  // "acorda" do segundo plano (sem fazer uma navegação nova de verdade) podia ficar
  // preso numa versão antiga da página mesmo com o SW dizendo que não guarda nada.
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});

// notificações push (ajuste 11): mostra a notificação mesmo com o app fechado. Se o corpo não vier
// (ou não for um JSON válido), ainda mostra algo em vez de falhar em silêncio.
self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (e) { /* não era JSON — segue com o padrão */ }
  const titulo = dados.titulo || 'Vôlei de Terça';
  event.waitUntil(self.registration.showNotification(titulo, { body: dados.corpo || '', tag: 'volei-terca' }));
});

// toque na notificação: foca uma aba já aberta do app, ou abre uma nova
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('.');
    })
  );
});
