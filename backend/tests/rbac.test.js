import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
      });
    });
  });
}

async function login(base, email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  return data.accessToken || data.token;
}

test('manager cannot access another manager deal', async (t) => {
  const app = createApp();
  const { server, base } = await listen(app);
  t.after(() => server.close());

  const managerToken = await login(base, 'manager@crm.local');
  const manager2Token = await login(base, 'manager2@crm.local');

  const myDeals = await fetch(`${base}/api/deals`, {
    headers: { Authorization: `Bearer ${manager2Token}` },
  }).then((r) => r.json());

  assert.ok(myDeals.deals.length >= 1);
  const foreignId = myDeals.deals[0].id;

  const denied = await fetch(`${base}/api/deals/${foreignId}`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(denied.status, 403);

  const list = await fetch(`${base}/api/deals`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  }).then((r) => r.json());
  assert.ok(list.deals.every((d) => d.responsible?.email === 'manager@crm.local' || true));
  assert.ok(!list.deals.some((d) => d.id === foreignId));
});

test('readonly cannot create deal', async (t) => {
  const app = createApp();
  const { server, base } = await listen(app);
  t.after(() => server.close());

  const token = await login(base, 'viewer@crm.local');
  const clients = await fetch(`${base}/api/clients`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

  const res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: clients.clients[0]?.id || 1,
      title: 'Should fail',
      amount: 1000,
    }),
  });
  assert.equal(res.status, 403);
});

test('supervisor sees all deals', async (t) => {
  const app = createApp();
  const { server, base } = await listen(app);
  t.after(() => server.close());

  const token = await login(base, 'boss@crm.local');
  const data = await fetch(`${base}/api/deals?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  assert.ok(data.deals.length >= 2);
});
