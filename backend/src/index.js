import { createApp } from './app.js';
import { config } from './config.js';

if (!process.env.NODE_ENV) {
  console.warn('[crm] NODE_ENV не задан. В продакшене задайте NODE_ENV=production, иначе демо-оплата может остаться доступной.');
}

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  console.log(`CRM API listening on http://0.0.0.0:${config.port}`);
});
