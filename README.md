# CRM Base

Базовая CRM на стеке **Express.js + React + PostgreSQL** с расширенным функционалом.

## Возможности

- Авторизация: short-lived JWT + httpOnly refresh cookie, rate-limit на login
- Роли: `ADMIN`, `SUPERVISOR`, `MANAGER`, `READONLY`
- Клиенты, сделки, воронка (drag-and-drop), задачи, файлы, уведомления
- Напоминания о контактах, дашборд, SLA, причины отказа, UTM/источники
- Антидубли (телефон/email/имя) + merge клиентов
- Пагинация, сортировка, CSV-экспорт, глобальный поиск
- Журнал действий с фильтрами, soft delete, шаблоны комментариев
- Менеджер не видит чужие сделки (API/UI)
- **Контроль качества разговоров менеджеров** (транскрипт/аудио → оценка 0–100, отчёт руководителя)

## Быстрый старт

```bash
npm run install:all
cd backend
npx prisma migrate deploy
npm run db:seed
cd ..
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:4001/api/health
- QC: http://localhost:5173/qc (после входа)

Материалы сдачи (п. 1–10 + шпаргалка к защите): [docs/SUBMISSION.md](docs/SUBMISSION.md)  
Подробности модуля QC: [docs/QC_MODULE.md](docs/QC_MODULE.md)

## Демо-аккаунты

Пароль: `Password123!`

| Роль | Email |
|------|-------|
| Admin | `admin@crm.local` |
| Руководитель | `boss@crm.local` |
| Менеджер | `manager@crm.local` |
| Менеджер 2 | `manager2@crm.local` |
| Менеджер 3 | `vovabycode@crm.local` (пароль: `admin`) |
| Read-only | `viewer@crm.local` |

## Тесты

```bash
cd backend
npm test
```

Включает RBAC и **golden-set проверку QC-анализатора** (5 эталонных диалогов).

## Безопасность

- Пароли: bcrypt
- Access token в памяти фронта, refresh в httpOnly cookie
- Секреты только в `.env`
