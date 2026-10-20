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

/** Colors for funnel columns (B&W + status accents). */
export const STAGE_COLORS = {
  NEW_LEAD: { bg: '#f0f0f0', border: '#cfcfcf', accent: '#111111' },
  FIRST_CONTACT: { bg: '#f5f5f5', border: '#d4d4d4', accent: '#404040' },
  QUALIFICATION: { bg: '#faf4e6', border: '#e0c878', accent: '#c7921a' },
  PROPOSAL: { bg: '#eeeeee', border: '#c8c8c8', accent: '#2a2a2a' },
  NEGOTIATION: { bg: '#f7f7f7', border: '#d0d0d0', accent: '#555555' },
  WON: { bg: '#e9fff3', border: '#16c098', accent: '#008767' },
  LOST: { bg: '#ffe8e8', border: '#ffc5c5', accent: '#df0404' },
};

/** Days on stage after which deal is "нужно проработать". */
export const NEEDS_WORK_DAYS = 3;

export const PLAN_LABELS = {
  START: 'Старт',
  BASIC: 'Базовый',
  ADVANCED: 'Продвинутый',
  ULTRA: 'Ultra',
};

export const ROLE_LABELS = {
  ADMIN: 'Администратор',
  SUPERVISOR: 'Руководитель',
  MANAGER: 'Менеджер',
  READONLY: 'Только чтение',
};

export function roleLabel(user) {
  if (!user) return '';
  if (user.positionLabel) return user.positionLabel;
  return ROLE_LABELS[user.role] || user.role || '';
}

export const LOST_REASONS = [
  'Дорого',
  'Выбрали конкурента',
  'Нет бюджета',
  'Не актуально',
  'Нет ответа',
  'Другое',
];

export const LEAD_TYPE_LABELS = {
  PURCHASE: 'Покупка',
  CREDIT: 'Кредит',
  TRADE_IN: 'Trade-in',
  BUYOUT: 'Выкуп',
};

export const CHAT_CHANNEL_LABELS = {
  INTERNAL: 'Внутренний',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  SITE_WIDGET: 'Сайт',
  MAX: 'MAX',
};

/** Infer lead intake channel for UI badge. */
export function leadChannelLabel(deal) {
  if (!deal) return null;
  const src = (deal.client?.source || '').toLowerCase();
  if (src.includes('whatsapp') || src.includes('wa')) return 'WhatsApp';
  if (src.includes('telegram') || src.includes('tg')) return 'Telegram';
  if (src.includes('max') || src.includes('макс')) return 'MAX';
  if (src.includes('авито') || src.includes('avito')) return 'Авито';
  if (src.includes('сайт') || src.includes('site') || src.includes('website')) return 'Сайт';
  if (deal.client?.source) return deal.client.source;
  if (deal.sourceUrl) return 'Сайт';
  return null;
}

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

export function formatDay(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ru-RU');
}

export const TASK_STATUS_LABELS = {
  OPEN: 'Открыта',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
};

export const SUBSCRIPTION_STATUS_LABELS = {
  TRIAL: 'Пробный период',
  ACTIVE: 'Активна',
  CANCELED: 'Отменён',
  CANCELLED: 'Отменён',
  PENDING: 'Ожидает оплаты',
  PAST_DUE: 'Просрочена',
};

export const PAYMENT_STATUS_LABELS = {
  SUCCEEDED: 'Оплачен',
  PENDING: 'Ожидает оплаты',
  CANCELED: 'Отменён',
  CANCELLED: 'Отменён',
};

export function formatQuota(used, limit) {
  if (limit == null) return `${used} · без ограничений`;
  return `${used} / ${limit}`;
}

/** Age or overdue span. Input is a minute count (sign ignored). */
export function formatDurationMinutes(mins) {
  const n = Math.abs(Math.round(Number(mins) || 0));
  if (n < 60) return `${n} мин`;
  if (n < 24 * 60) {
    const h = Math.floor(n / 60);
    const m = n % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${Math.floor(n / (24 * 60))} дн`;
}

export function formatOverdue(nextContactAt) {
  if (!nextContactAt) return null;
  const mins = Math.round((new Date(nextContactAt).getTime() - Date.now()) / 60000);
  if (mins < 0) return `просрочен ${formatDurationMinutes(mins)}`;
  if (Math.abs(mins) < 24 * 60) return formatDurationMinutes(mins);
  return formatDate(nextContactAt);
}

export function formatRuDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseRuDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

export function formatDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
