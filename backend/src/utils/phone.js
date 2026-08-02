/** Normalize phone to +7XXXXXXXXXX when possible; keep digits with leading +. */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Phone is required');
  }

  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Phone must contain digits');
  }

  let normalized = digits;

  if (normalized.length === 11 && (normalized.startsWith('8') || normalized.startsWith('7'))) {
    normalized = `7${normalized.slice(1)}`;
  } else if (normalized.length === 10) {
    normalized = `7${normalized}`;
  }

  return `+${normalized}`;
}
