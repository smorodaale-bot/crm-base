import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SUPPORT_EMAIL } from './company.js';

let pending = null;

function loadSupportEmail() {
  if (!pending) {
    pending = api('/auth/config')
      .then((data) => String(data?.supportEmail || '').trim() || SUPPORT_EMAIL)
      .catch(() => SUPPORT_EMAIL);
  }
  return pending;
}

function writeJsonLdEmail(email) {
  const node = document.querySelector('script[type="application/ld+json"]');
  if (!node || !email) return;
  try {
    const data = JSON.parse(node.textContent || '{}');
    if (data.email === email) return;
    data.email = email;
    node.textContent = JSON.stringify(data, null, 2);
  } catch {
    /* keep the static JSON-LD */
  }
}

/** Support address from GET /api/auth/config, with the frontend constant as fallback. */
export function useSupportEmail() {
  const [email, setEmail] = useState(SUPPORT_EMAIL);

  useEffect(() => {
    let cancelled = false;
    loadSupportEmail().then((next) => {
      if (cancelled) return;
      setEmail(next);
      writeJsonLdEmail(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return email;
}

export function SupportEmailLink() {
  const email = useSupportEmail();
  return <a href={`mailto:${email}`}>{email}</a>;
}
