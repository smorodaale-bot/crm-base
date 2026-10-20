# Production deploy — nova-crm.online

Домен: **https://nova-crm.online** → VPS `155.212.175.33`

## Порядок (один раз)

### 0. Перед стартом
- DNS A `@` и `www` → `155.212.175.33` (уже сделано)
- Подтверждена почта в reg.ru
- Есть SSH на сервер

### 1. Залить свежий код на сервер
С вашего ПК (Git) или на сервере:

```bash
ssh root@155.212.175.33
cd /var/www/www-root/data/www/155.212.175.33
git pull
# если репо ещё нет — клонируйте crm-base в этот каталог
```

Либо скопируйте папку `deploy/` и обновлённый код через scp/sftp.

### 2. Backend .env на сервере
В `/var/www/www-root/data/www/155.212.175.33/backend/.env` добавьте/замените:

```env
PUBLIC_APP_URL=https://nova-crm.online
YOOKASSA_RETURN_URL=https://nova-crm.online/org/billing?payment=success
CORS_ORIGIN=https://nova-crm.online
COOKIE_SECURE=true
AUTH_EMAIL_OTP=false
```

`AUTH_EMAIL_OTP` по умолчанию включён (`true`): вход и регистрация просят код из письма. Значение `false` — временный режим без почты: пароль сразу открывает сессию, регистрация создаёт салон без кода, сброс пароля просит написать в поддержку, а приглашение сотрудника возвращает ссылку администратору (её нужно переслать вручную). Секреты и `devCode` в этом режиме в ответ не попадают. После правки `.env`: `pm2 restart backend --update-env`.

SMTP и остальные ключи оставьте как есть (или скопируйте с локальной машины, **не коммитьте** `.env`).

### 3. Сборка и миграции

```bash
cd /var/www/www-root/data/www/155.212.175.33
npm run install:all
npm run build --prefix frontend
cd backend && npx prisma migrate deploy && npx prisma generate
pm2 restart backend || pm2 start src/index.js --name backend
```

### 4. Nginx (HTTP) + SSL

```bash
mkdir -p /var/www/certbot
cp deploy/nginx-nova-crm.online.http.conf /etc/nginx/sites-available/nova-crm.online
ln -sfn /etc/nginx/sites-available/nova-crm.online /etc/nginx/sites-enabled/nova-crm.online
nginx -t && systemctl reload nginx

apt update && apt install -y certbot python3-certbot-nginx
certbot --nginx -d nova-crm.online -d www.nova-crm.online \
  --agree-tos -m support@nova-crm.online --redirect
```

После успешного certbot можно поставить полный конфиг:

```bash
cp deploy/nginx-nova-crm.online.conf /etc/nginx/sites-available/nova-crm.online
nginx -t && systemctl reload nginx
```

### 5. Проверка
- https://nova-crm.online — логин
- https://nova-crm.online/pricing — тарифы
- https://nova-crm.online/offer — оферта
- https://nova-crm.online/contacts — реквизиты

Webhook ЮKassa: `https://nova-crm.online/api/billing/yookassa/webhook`

### Автоскрипт
На сервере из корня проекта:

```bash
bash deploy/deploy-nova-crm.sh
```

## Шаг 9 — бэкап БД и автозапуск PM2

Один раз на сервере (после заливки папки `deploy/`):

```bash
cd /var/www/www-root/data/www/155.212.175.33
chmod +x deploy/backup-db.sh deploy/setup-ops.sh
bash deploy/setup-ops.sh
```

Что делает:
- создаёт дамп PostgreSQL в `/var/backups/nova-crm/` (gzip);
- ставит cron каждый день в **03:15**;
- хранит бэкапы **14 дней**;
- `pm2 save` + подсказка для `pm2 startup` (автозапуск после перезагрузки VPS).

Ручная проверка:

```bash
bash deploy/backup-db.sh
ls -lh /var/backups/nova-crm/
pm2 status
pm2 startup
pm2 save
```

Восстановление (осторожно, перезапишет БД):

```bash
gunzip -c /var/backups/nova-crm/crm_base_latest.sql.gz | sudo -u postgres psql -d crm_base
```

## Шаг 10 — SEO, отмена оплаты, напоминания

После деплоя frontend (`npm run build`) проверьте:
- https://nova-crm.online/robots.txt
- https://nova-crm.online/sitemap.xml
- https://nova-crm.online/payment/cancel

Миграция + cron напоминаний:

```bash
cd /var/www/www-root/data/www/155.212.175.33/backend
npx prisma migrate deploy
pm2 restart backend

# cron напоминаний (или перезапустите setup-ops.sh)
crontab -e
# добавьте строку:
# 30 9 * * * cd /var/www/www-root/data/www/155.212.175.33/backend && /usr/bin/node scripts/subscription-reminders.js >> /var/log/nova-crm-reminders.log 2>&1
```

Ручной тест напоминаний:
```bash
cd /var/www/www-root/data/www/155.212.175.33/backend
node scripts/subscription-reminders.js
```

## Файлы в репозитории
| Файл | Назначение |
|------|------------|
| `deploy/nginx-nova-crm.online.http.conf` | HTTP до получения сертификата |
| `deploy/nginx-nova-crm.online.conf` | HTTPS после certbot |
| `deploy/deploy-nova-crm.sh` | Автоматизация шагов 2–5 |
| `deploy/backup-db.sh` | Ежедневный бэкап PostgreSQL |
| `deploy/setup-ops.sh` | Установка cron + pm2 startup |
| `deploy/nginx-crm.conf` | Старый конфиг по IP (можно оставить для совместимости) |
| `backend/scripts/subscription-reminders.js` | Письма за ~3 дня до конца подписки |
