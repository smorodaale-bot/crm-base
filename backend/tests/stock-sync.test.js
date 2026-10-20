import test from 'node:test';
import assert from 'node:assert/strict';
import { findActiveStockCredential, resolveSyncSalon, stockTokenHash } from '../src/services/stockSync.js';
import { hasFeature } from '../src/services/plans.js';
import { isDemoCompleteEnabled, yookassaAmountMatches } from '../src/services/yookassa.js';

test('a token from another organization is rejected', async () => {
  const raw = 'org-a-token';
  const db = {
    stockSyncCredential: {
      findFirst: async ({ where }) =>
        where.tokenHash === stockTokenHash(raw) && where.revokedAt === null
          ? { id: 1, organizationId: 4 }
          : null,
    },
  };
  const row = await findActiveStockCredential(db, raw);
  assert.equal(row.organizationId, 4);
  await assert.rejects(
    () => findActiveStockCredential(db, 'org-b-token'),
    (err) => err.status === 401 && err.code === 'INVALID_TOKEN'
  );
  await assert.rejects(
    () => findActiveStockCredential(db, ''),
    (err) => err.status === 401 && err.code === 'INVALID_TOKEN'
  );
});

test('a salon from another organization is forbidden', () => {
  assert.throws(
    () =>
      resolveSyncSalon({
        organizationId: 4,
        salonSlug: 'other-salon',
        ownSalon: null,
        foreignSalon: { id: 9, organizationId: 8, slug: 'other-salon' },
      }),
    (err) => err.status === 403
  );
});

test('sync without salonSlug is rejected', () => {
  assert.throws(
    () =>
      resolveSyncSalon({
        organizationId: 4,
        salonSlug: '   ',
        ownSalon: { id: 1, organizationId: 4, slug: 'only' },
        foreignSalon: null,
      }),
    (err) => err.status === 400
  );
});

test('stock_1c and stock_sync resolve to stock_api', () => {
  assert.equal(hasFeature('ADVANCED', 'stock_api'), true);
  assert.equal(hasFeature('ADVANCED', 'stock_1c'), true);
  assert.equal(hasFeature('ADVANCED', 'stock_sync'), true);
  assert.equal(hasFeature('START', 'stock_api'), false);
  assert.equal(hasFeature('START', 'stock_1c'), false);
  assert.equal(hasFeature('BASIC', 'stock_api'), false);
  assert.equal(hasFeature('ULTRA', 'stock_sync'), true);
});

test('demo-complete is mounted only outside production with YOOKASSA_DEMO=true', () => {
  assert.equal(isDemoCompleteEnabled({ NODE_ENV: 'production', YOOKASSA_DEMO: 'true' }), false);
  assert.equal(isDemoCompleteEnabled({ NODE_ENV: 'development', YOOKASSA_DEMO: 'false' }), false);
  assert.equal(isDemoCompleteEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(isDemoCompleteEnabled({ NODE_ENV: 'development', YOOKASSA_DEMO: 'true' }), true);
});

test('webhook amount must match the stored payment', () => {
  assert.equal(yookassaAmountMatches({ amount: { value: '1490.00' } }, 1490), true);
  assert.equal(yookassaAmountMatches({ amount: { value: '1.00' } }, 1490), false);
  assert.equal(yookassaAmountMatches({}, 1490), false);
});
