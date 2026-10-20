/** Legal / company details for YooKassa moderation pages.
 *  Fill before submitting the site to YooKassa review.
 *  Can override via Vite env: VITE_LEGAL_NAME, VITE_LEGAL_INN, etc.
 */
const fromEnv = (key, fallback) => {
  const v = import.meta.env?.[key];
  return v && String(v).trim() ? String(v).trim() : fallback;
};

/** Support inbox. Runtime value comes from GET /api/auth/config (SUPPORT_EMAIL). */
export const SUPPORT_EMAIL = 'support@nova-crm.online';

export const COMPANY = {
  productName: fromEnv('VITE_APP_NAME', 'Nova CRM'),
  legalName: fromEnv('VITE_LEGAL_NAME', 'Коваленко Евгений Николаевич'),
  inn: fromEnv('VITE_LEGAL_INN', '325200800124'),
  email: SUPPORT_EMAIL,
  phone: fromEnv('VITE_LEGAL_PHONE', '+7 (952) 961-02-38'),
  telegram: fromEnv('VITE_SUPPORT_TELEGRAM', ''),
  address: fromEnv('VITE_LEGAL_ADDRESS', 'Россия, г. Москва'),
  /** Self-employed / IP / OOO */
  form: fromEnv('VITE_LEGAL_FORM', 'самозанятый'),
};

export const LEGAL_LINKS = [
  { to: '/pricing', label: 'Тарифы' },
  { to: '/offer', label: 'Оферта' },
  { to: '/privacy', label: 'Политика ПДн' },
  { to: '/contacts', label: 'Контакты' },
];
