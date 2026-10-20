import { useEffect } from 'react';

const DEFAULTS = {
  title: 'Nova CRM — заявки автосалона не теряются',
  description:
    'Nova CRM — заявки автосалона из Telegram, MAX и сайта на рабочем столе менеджера. Чат, воронка и визиты в одной системе.',
  robots: 'index, follow',
  canonical: 'https://nova-crm.online/',
};

function setMetaName(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/** Page SEO for SPA routes (helps Googlebot after JS render). */
export function useDocumentMeta({ title, description, robots, canonical } = {}) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title || DEFAULTS.title;
    setMetaName('description', description || DEFAULTS.description);
    setMetaName('robots', robots || DEFAULTS.robots);
    setCanonical(canonical || DEFAULTS.canonical);

    return () => {
      document.title = prevTitle;
      setMetaName('description', DEFAULTS.description);
      setMetaName('robots', DEFAULTS.robots);
      setCanonical(DEFAULTS.canonical);
    };
  }, [title, description, robots, canonical]);
}
