export const STAGE_LABELS = {
  NEW_LEAD: 'Новая заявка',
  FIRST_CONTACT: 'Первичный контакт',
  QUALIFICATION: 'Квалификация',
  PROPOSAL: 'Предложение',
  NEGOTIATION: 'Переговоры',
  WON: 'Успешно реализовано',
  LOST: 'Отказ',
};

export const STAGES = Object.keys(STAGE_LABELS);

/** Colors for funnel columns (SaaS palette). */
export const STAGE_COLORS = {
  NEW_LEAD: { bg: '#f0ebff', border: '#c4b5fd', accent: '#5932ea' },
  FIRST_CONTACT: { bg: '#e0f7f1', border: '#7dd3c0', accent: '#16c098' },
  QUALIFICATION: { bg: '#fff8e1', border: '#ffd54f', accent: '#f9a825' },
  PROPOSAL: { bg: '#fce7f3', border: '#f9a8d4', accent: '#db2777' },
  NEGOTIATION: { bg: '#fff3e0', border: '#ffb74d', accent: '#ef6c00' },
  WON: { bg: '#e0f7f1', border: '#16c098', accent: '#008767' },
  LOST: { bg: '#ffe8e8', border: '#ffc5c5', accent: '#df0404' },
};

/** Days on stage after which deal is "нужно проработать". */
export const NEEDS_WORK_DAYS = 3;

export const ROLE_LABELS = {
  ADMIN: 'Администратор',
  SUPERVISOR: 'Руководитель',
  MANAGER: 'Менеджер',
  READONLY: 'Только чтение',
};

export const LOST_REASONS = [
  'Дорого',
  'Выбрали конкурента',
  'Нет бюджета',
  'Не актуально',
  'Нет ответа',
  'Другое',
];

export function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU');
}

export function formatDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
