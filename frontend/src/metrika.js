const COUNTER_ID = Number(import.meta.env.VITE_YANDEX_METRIKA_ID || 0);

const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot',
  '/reset',
  '/pricing',
  '/offer',
  '/privacy',
  '/contacts',
  '/payment/cancel',
]);

let scriptReady = null;
let inited = false;

function ensureStub() {
  if (typeof window.ym === 'function') return;
  window.ym = function ym() {
    (window.ym.a = window.ym.a || []).push(arguments);
  };
  window.ym.l = Date.now();
}

function loadScript() {
  if (!COUNTER_ID) return Promise.resolve(false);
  if (scriptReady) return scriptReady;
  ensureStub();
  scriptReady = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://mc.yandex.ru/metrika/tag.js"]');
    if (existing) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return scriptReady;
}

export function isPublicMetrikaPath(pathname) {
  return PUBLIC_PATHS.has(pathname);
}

export async function trackPublicPage(pathname, search = '') {
  if (!COUNTER_ID || !isPublicMetrikaPath(pathname)) return;
  const ok = await loadScript();
  if (!ok || typeof window.ym !== 'function') return;
  if (!inited) {
    window.ym(COUNTER_ID, 'init', {
      defer: true,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
    inited = true;
  }
  window.ym(COUNTER_ID, 'hit', `${pathname}${search || ''}`, { title: document.title });
}

export function reachGoal(name) {
  if (!COUNTER_ID || typeof window.ym !== 'function') return;
  window.ym(COUNTER_ID, 'reachGoal', name);
}
