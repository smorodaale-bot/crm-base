import { prisma } from '../db.js';
import { config } from '../config.js';
import { parseWebsiteOrigins } from './leads.js';

let cache = { at: 0, set: new Set() };

export function clearCorsOriginsCache() {
  cache = { at: 0, set: new Set() };
}

function envOrigins() {
  return String(config.corsOrigin || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getAllowedCorsOrigins() {
  const now = Date.now();
  if (now - cache.at < 60_000 && cache.set.size) return cache.set;

  const set = new Set(envOrigins());
  const publicApp = process.env.PUBLIC_APP_URL;
  if (publicApp) {
    try {
      set.add(new URL(publicApp).origin);
    } catch {
      /* ignore */
    }
  }

  const orgs = await prisma.organization.findMany({
    select: { leadWebsiteOrigins: true },
    take: 500,
  });
  for (const org of orgs) {
    for (const origin of parseWebsiteOrigins(org.leadWebsiteOrigins)) {
      set.add(origin);
    }
  }

  cache = { at: now, set };
  return set;
}

/** Express cors `origin` callback (supports credentials). */
export async function corsOriginDelegate(origin, callback) {
  try {
    // Non-browser / same-origin tools (curl, server-to-server)
    if (!origin) return callback(null, true);

    const allowed = await getAllowedCorsOrigins();
    if (allowed.has(origin) || allowed.has('*')) {
      return callback(null, true);
    }
    return callback(null, false);
  } catch (err) {
    return callback(err);
  }
}
