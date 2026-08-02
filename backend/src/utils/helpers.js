export const DEAL_STAGES = [
  'NEW_LEAD',
  'FIRST_CONTACT',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
];

export const STAGE_LABELS = {
  NEW_LEAD: 'Новая заявка',
  FIRST_CONTACT: 'Первичный контакт',
  QUALIFICATION: 'Квалификация',
  PROPOSAL: 'Предложение',
  NEGOTIATION: 'Переговоры',
  WON: 'Успешно реализовано',
  LOST: 'Отказ',
};

export const ROLE_LABELS = {
  ADMIN: 'Администратор',
  SUPERVISOR: 'Руководитель',
  MANAGER: 'Менеджер',
  READONLY: 'Только чтение',
};

export function isAdmin(user) {
  return user?.role === 'ADMIN';
}

export function isSupervisor(user) {
  return user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
}

export function isManager(user) {
  return user?.role === 'MANAGER';
}

export function isReadonly(user) {
  return user?.role === 'READONLY';
}

export function canWrite(user) {
  return !isReadonly(user);
}

export function serializeDeal(deal) {
  if (!deal) return deal;
  return {
    ...deal,
    amount: deal.amount != null ? Number(deal.amount) : deal.amount,
  };
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function parseSort(query, allowed, fallback) {
  const sortBy = allowed.includes(query.sortBy) ? query.sortBy : fallback.field;
  const sortDir = query.sortDir === 'asc' ? 'asc' : fallback.dir || 'desc';
  return { [sortBy]: sortDir };
}

export function daysBetween(from, to = new Date()) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function toCsv(rows, columns) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => escape(c.header)).join(';');
  const lines = rows.map((row) => columns.map((c) => escape(c.value(row))).join(';'));
  return '\uFEFF' + [header, ...lines].join('\n');
}
