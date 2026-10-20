/**
 * Extract Avito item id from URL or raw id string.
 * Examples:
 *  - https://www.avito.ru/moskva/avtomobili/ford_..._1234567890
 *  - 1234567890
 */
export function extractAvitoItemId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{5,}$/.test(raw)) return raw;
  const fromPath = raw.match(/_(\d{5,})(?:\?|#|$)/);
  if (fromPath) return fromPath[1];
  const digits = raw.match(/(\d{8,})/);
  return digits ? digits[1] : null;
}

/**
 * Find vehicle in organization by avito item id or listing URL.
 */
export async function findVehicleByAvitoListing(prisma, organizationId, { itemId, url } = {}) {
  if (!organizationId) return null;
  const id = extractAvitoItemId(itemId) || extractAvitoItemId(url);
  const salonFilter = { salon: { organizationId }, deletedAt: null };

  if (id) {
    const byId = await prisma.vehicle.findFirst({
      where: { ...salonFilter, avitoItemId: id },
    });
    if (byId) return byId;
  }

  if (url) {
    const byUrl = await prisma.vehicle.findFirst({
      where: { ...salonFilter, avitoUrl: String(url).trim() },
    });
    if (byUrl) return byUrl;
  }

  return null;
}

/** If vehicle was listed on Avito, mark for manual unlist. */
export function listingNeedsUnlistPatch(vehicle) {
  if (!vehicle) return {};
  if (vehicle.listingStatus === 'LISTED' || vehicle.listingStatus === 'NEEDS_UNLIST') {
    return { listingStatus: 'NEEDS_UNLIST' };
  }
  return {};
}
