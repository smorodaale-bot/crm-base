# Материалы сдачи тестового задания

Документ закрывает единый формат сдачи (п. 1–10) и служит шпаргалкой к защите.

> **Перед сдачей заполните:** ссылку на видео (п. 5). Пункты 1–2 уже заполнены.

---

## 1. Ссылка на работающую систему

| Среда | URL |
|-------|-----|
| Demo | http://155.212.175.33:5173 |
| Локально UI | http://localhost:5173 |
| Локально API health | http://localhost:4001/api/health |
| Модуль QC | `/qc` (после входа руководителем) |

---

## 2. Исходный код в Git-репозитории

| Поле | Значение |
|------|----------|
| Репозиторий | https://github.com/smorodaale-bot/crm-base |
| Ветка | `main` |

**Важно:** в репозитории нет рабочих секретов. Используются только `.env.example` и демо-пароли seed. Файлы `.env` в `.gitignore`.

---

## 3. Инструкция по запуску с нуля

### Требования

- Node.js 20+
- Docker (для PostgreSQL) **или** свой Postgres 16
- npm

### Шаги

```bash
# 1. Клонировать
git clone <URL-репозитория>
cd crm-base

# 2. Поднять БД
docker compose up -d

# 3. Переменные окружения
cp backend/.env.example backend/.env
# при необходимости поправьте DATABASE_URL / JWT_* / PORT

# 4. Зависимости
npm run install:all

# 5. Миграции и демо-данные
cd backend
npx prisma migrate deploy
npm run db:seed
cd ..

# 6. Запуск API + UI
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:4001 (см. `backend/.env`, поле `PORT`)

Опционально для LLM-резюме QC и Whisper: в `backend/.env` задать `YANDEX_API_KEY` + `YANDEX_FOLDER_ID` и/или `OPENAI_API_KEY` (см. `.env.example`). Без ключей QC работает на rules-движке.

Подробнее про QC: [QC_MODULE.md](./QC_MODULE.md).

---

## 4. Тестовые логины и пароли

Пароль для демо-аккаунтов: `Password123!`  
Исключение: `vovabycode@crm.local` — пароль `admin`

| Роль | Email | Для чего смотреть |
|------|-------|-------------------|
| Admin | `admin@crm.local` | Пользователи, полный доступ |
| Руководитель (SUPERVISOR) | `boss@crm.local` | QC, merge клиентов, все сделки |
| Менеджер | `manager@crm.local` | Свои сделки, создание клиентов |
| Менеджер 2 | `manager2@crm.local` | Проверка изоляции сделок |
| Менеджер 3 | `vovabycode@crm.local` | Доп. менеджер (пароль `admin`) |
| Read-only | `viewer@crm.local` | Только чтение (мутации → отказ) |

Это **демо-учётки из seed**, не продакшен-секреты.

---

## 5. Видео с демонстрацией основного сценария

| Поле | Значение |
|------|----------|
| Ссылка (заполнить) | `https://…` (до 10 мин) |

### Рекомендуемый сценарий ролика (~8–10 мин)

1. Вход как `boss@crm.local`
2. Воронка / сделки: смена этапа (drag-and-drop)
3. Клиент: создание с предупреждением о дубле (телефон/email)
4. Merge дублей (supervisor)
5. Ошибка: вход с неверным паролем / попытка менеджера открыть чужую сделку
6. QC: открыть seed-отзыв → оценка, evidence → отчёт руководителя
7. (опц.) Создание QC по тексту транскрипта

---

## 6. Архитектура простыми словами и список технологий

### Простыми словами

Система — CRM для менеджеров продаж.

1. Пользователь входит в веб-интерфейс (React).
2. Фронт ходит в REST API (Express).
3. API проверяет JWT и роль, пишет/читает PostgreSQL через Prisma.
4. Сделки привязаны к ответственному менеджеру: менеджер видит только свои, руководитель — все.
5. Клиенты проверяются на дубли по телефону/email/имени; руководитель может объединить карточки.
6. Модуль контроля качества (QC): текст или аудио разговора → правила `rules-v1` ставят балл 0–100; при наличии ключей ИИ может усилить резюме/рекомендации (баллы остаются на rules).

```
Браузер (React/Vite)
        │  HTTPS / HTTP
        ▼
   Express API  ── JWT + RBAC ──► PostgreSQL (Prisma)
        │
        ├── Клиенты / сделки / задачи / файлы / журнал
        └── QC: rules-v1 (+ опц. YandexGPT / OpenAI / Whisper)
```

### Технологии

| Слой | Стек |
|------|------|
| Frontend | React 19, React Router 7, Vite 6 |
| Backend | Node.js, Express 4, Zod, Multer, bcryptjs, jsonwebtoken, express-rate-limit |
| БД | PostgreSQL 16, Prisma 6 |
| Инфра (локально) | Docker Compose (только Postgres), concurrently |
| QC / ИИ | Собственный rules-движок; опционально YandexGPT, OpenAI Chat, Whisper |

Ключевые сущности БД: `User`, `Client`, `Deal`, `Task`, `Attachment`, `ActivityLog`, `QcReview`, `QcComment`, `RefreshToken`, `LeadSource`, `Notification`, `FunnelSnapshot`.

---

## 7. Использованные ИИ-модели и ориентировочная стоимость

| Компонент | Модель / движок | Когда включается | Ориентир стоимости* |
|-----------|-----------------|------------------|---------------------|
| Оценка QC | `rules-v1` (без LLM) | Всегда | **$0** |
| Резюме / рекомендации | YandexGPT Lite (приоритет) | Есть `YANDEX_API_KEY` + `YANDEX_FOLDER_ID` | ~0.2–1 ₽ за короткий разговор |
| Резюме / рекомендации | OpenAI `gpt-4o-mini` | Нет Yandex, есть `OPENAI_API_KEY` | ~$0.001–0.01 за разговор |
| Транскрипт аудио | OpenAI Whisper `whisper-1` | Загрузка аудио + `OPENAI_API_KEY` | ~$0.006 / минута аудио |

\*Грубые оценки на момент разработки; точные тарифы — у провайдеров.

**Эксплуатация демо без ключей:** QC полностью на rules → стоимость ИИ **≈ 0**.  
**При умеренной нагрузке** (например, 200 оценок/мес с LLM + 50 мин Whisper): порядка **$1–5 / мес** (или эквивалент в ₽ на Yandex).

Разработка: Cursor / ассистенты на базе LLM использовались для ускорения кода и документации (см. защиту, п. 6).

---

## 8. Известные ограничения и что не успели

- Нет полного Docker-образа приложения (в Compose только БД) и готового CI/CD.
- Страницы дашборда / задач / напоминаний есть в коде, но **не подключены** в роутинг и меню (API частично есть).
- Список клиентов общий для менеджеров (изоляция жёстче на уровне сделок).
- Whisper только через OpenAI; Yandex SpeechKit не подключён.
- Нет автоматических бэкапов БД «из коробки» (нужен cron/`pg_dump` на сервере).
- Нет фронтенд-тестов; автотесты — backend (RBAC + QC golden-set).
- CSRF/helmet и шифрование диска БД не настроены как production-hardening.
- Горизонтальное масштабирование API не развёрнуто (см. защиту, п. 7).

---

## 9. Автоматические тесты ключевой логики

```bash
cd backend
npm test
```

| Файл | Что проверяет |
|------|----------------|
| `backend/tests/rbac.test.js` | Менеджер не читает чужую сделку (403); READONLY не создаёт сделку; supervisor видит все |
| `backend/tests/qc.test.js` | Golden-set из 5 эталонных диалогов: диапазоны score, mustPass/mustFail, critical, evidence из текста |

Результаты rules-v1 зафиксированы в [QC_TEST_RESULTS.md](./QC_TEST_RESULTS.md).

RBAC-тесты рассчитаны на БД после `npm run db:seed`.

---

## 10. Безопасность и резервное копирование

### Безопасность

- Пароли: **bcrypt**
- Access JWT (короткий TTL, в памяти фронта) + **refresh в httpOnly cookie**, ротация и revoke
- Rate-limit на login (20 попыток / 15 мин)
- RBAC на API: менеджер — только свои сделки; WRITE запрещён для READONLY; QC — supervisor/admin
- Soft delete клиентов/сделок; журнал действий (`ActivityLog`)
- CORS с credentials; `COOKIE_SECURE` для HTTPS
- Секреты только в `.env` (не коммитятся); в репо — `.env.example`
- Загрузки файлов в `backend/uploads/` (в `.gitignore`)

### Резервное копирование

Скрипт: `scripts/backup.sh` — дамп PostgreSQL (`pg_dump -F c`) + архив `backend/uploads`, ротация **14 дней**.

На сервере (демо `155.212.175.33`):

```bash
# положить скрипт и сделать исполняемым
mkdir -p /root/bin /root/crm-backups
# (скопировать scripts/backup.sh → /root/bin/crm-backup.sh)
chmod +x /root/bin/crm-backup.sh

# ручной прогон
/root/bin/crm-backup.sh

# cron: каждый день в 03:15
crontab -e
# строка:
# 15 3 * * * /root/bin/crm-backup.sh >> /var/log/crm-backup.log 2>&1
```

Восстановление БД:

```bash
export PGPASSWORD=crm
pg_restore -h localhost -U crm -d crm_base --clean --if-exists /root/crm-backups/ДАТА/crm_base.dump
```

- Локально через Docker: `docker exec crm-base-db pg_dump -U crm crm_base | gzip > backup.sql.gz`
- Volume Postgres / файлы на диске **не заменяют** регулярный `pg_dump`
- Желательно копировать `/root/crm-backups` ещё и вне сервера (другой хост / облако)

---

# Защита на собеседовании — шпаргалка

| # | Что спросят | Где показать / что сказать |
|---|-------------|----------------------------|
| 1 | Запуск / демо | Ссылка из п. 1 или `npm run dev` |
| 2 | Основной сценарий + ошибка | Воронка → клиент → QC; 403 чужой сделки / неверный логин |
| 3 | Защита от дублей + БД | UI предупреждение + `POST …/merge`; схема Prisma: `Client.phone` unique, soft-delete суффиксы |
| 4 | Права доступа + ИИ | Роли в `middleware/auth.js`; ИИ в `backend/src/qc/llm.js`, баллы в `analyzer.js` |
| 5 | Маленькое изменение кода | Например: вес критерия в `criteria.js` или текст ошибки валидации |
| 6 | Что сделано с ИИ-инструментами | Каркас CRUD/UI ускорен ассистентом; rules-критерии и RBAC-тесты — осознанно; LLM в проде опционален |
| 7 | Рост нагрузки | Stateless API за балансировщиком; Postgres + индексы/пул; очередь на Whisper/LLM; кэш отчётов QC; CDN для фронта |

### Структура БД (кратко для устного ответа)

- **User** — сотрудник и роль  
- **Client** — контакт, unique phone  
- **Deal** — сделка на клиента + `responsibleId` + этап воронки  
- **QcReview** — разговор, баллы, evidence, версия анализатора  
- Связи: сделки/задачи/файлы → клиент или сделка; refresh-токены отдельно от пароля  

### Обработка ошибки (пример)

Менеджер `manager@crm.local` открывает сделку коллеги `manager2` → API **403**, UI показывает отказ в доступе. Это и есть демонстрация RBAC.
