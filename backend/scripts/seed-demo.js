import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

const { prisma } = await import('../src/db.js');

const DEMO_SLUG = 'demo-salon';
const SALON_SLUG = 'demo-showroom';
const OWNER_EMAIL = 'demo@nova-crm.online';
const SOURCES = ['avito', 'telegram', 'max', 'site'];
const PIPELINE = [
  'FIRST_CONTACT',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'FIRST_CONTACT',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'FIRST_CONTACT',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
];
const NAMES = [
  'Ирина Соколова', 'Алексей Морозов', 'Мария Кузнецова', 'Дмитрий Орлов', 'Ольга Белова',
  'Сергей Павлов', 'Анна Лебедева', 'Никита Егоров', 'Елена Воробьёва', 'Павел Никитин',
  'Татьяна Крылова', 'Игорь Савельев', 'Наталья Фролова', 'Роман Зайцев', 'Юлия Медведева',
  'Андрей Котов', 'Светлана Новикова', 'Максим Григорьев', 'Виктория Попова', 'Артём Волков',
  'Екатерина Седова', 'Кирилл Макаров', 'Дарья Тихонова', 'Владимир Соловьёв', 'Полина Орлова',
  'Григорий Фомин', 'Алина Чернова', 'Егор Денисов', 'Ксения Баранова', 'Илья Громов',
];
const CARS = [
  ['Toyota', 'Camry', 2021, 'USED', 'IN_STOCK', 2450000, 42000, 'Белый'],
  ['Kia', 'K5', 2023, 'USED', 'IN_STOCK', 2890000, 18000, 'Серый'],
  ['Hyundai', 'Solaris', 2020, 'USED', 'RESERVED', 1320000, 61000, 'Серебристый'],
  ['BMW', 'X5', 2019, 'USED', 'IN_STOCK', 4650000, 78000, 'Чёрный'],
  ['Mercedes-Benz', 'E 200', 2018, 'USED', 'SOLD', 3180000, 94000, 'Синий'],
  ['Lada', 'Vesta', 2024, 'NEW', 'IN_STOCK', 1490000, 0, 'Белый'],
  ['Volkswagen', 'Tiguan', 2022, 'USED', 'IN_STOCK', 3290000, 35000, 'Красный'],
  ['Skoda', 'Octavia', 2021, 'USED', 'IN_TRANSIT', 1980000, 47000, 'Серый'],
  ['Audi', 'Q5', 2020, 'USED', 'IN_STOCK', 3890000, 52000, 'Белый'],
  ['Nissan', 'Qashqai', 2019, 'USED', 'RESERVED', 1760000, 69000, 'Синий'],
  ['Mazda', 'CX-5', 2022, 'USED', 'IN_STOCK', 2740000, 29000, 'Красный'],
  ['Honda', 'CR-V', 2018, 'USED', 'IN_STOCK', 2190000, 88000, 'Чёрный'],
  ['Chery', 'Tiggo 7 Pro', 2024, 'NEW', 'IN_STOCK', 2390000, 15, 'Серый'],
  ['Haval', 'Jolion', 2023, 'USED', 'IN_STOCK', 1890000, 22000, 'Белый'],
  ['Geely', 'Coolray', 2024, 'NEW', 'IN_STOCK', 2140000, 0, 'Синий'],
  ['Toyota', 'RAV4', 2020, 'USED', 'IN_STOCK', 2980000, 56000, 'Чёрный'],
  ['Kia', 'Sportage', 2021, 'USED', 'SOLD', 2560000, 41000, 'Белый'],
  ['Hyundai', 'Tucson', 2022, 'USED', 'IN_STOCK', 2870000, 27000, 'Серый'],
  ['BMW', '3 Series', 2017, 'USED', 'IN_STOCK', 1980000, 112000, 'Чёрный'],
  ['Lada', 'Granta', 2023, 'USED', 'IN_STOCK', 890000, 24000, 'Белый'],
  ['Volkswagen', 'Polo', 2019, 'USED', 'IN_TRANSIT', 1180000, 73000, 'Серебристый'],
  ['Skoda', 'Kodiaq', 2021, 'USED', 'RESERVED', 3120000, 48000, 'Синий'],
  ['Audi', 'A4', 2018, 'USED', 'IN_STOCK', 2050000, 91000, 'Серый'],
  ['Nissan', 'X-Trail', 2020, 'USED', 'IN_STOCK', 2340000, 64000, 'Белый'],
  ['Mazda', '6', 2019, 'USED', 'IN_STOCK', 1760000, 82000, 'Красный'],
];
const MANAGERS = [
  { email: 'demo.manager1@nova-crm.online', name: 'Анна Лебедева' },
  { email: 'demo.manager2@nova-crm.online', name: 'Сергей Павлов' },
  { email: 'demo.manager3@nova-crm.online', name: 'Марина Крылова' },
];

function atDay(offset, hour = 11) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(hour, (Math.abs(offset) * 7) % 50, 0, 0);
  return date;
}

async function upsertDemoUser({ email, name, role, organizationId, salonId, passwordHash }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.organizationId && existing.organizationId !== organizationId) {
    throw new Error(`Пользователь ${email} принадлежит другой организации, демо-салон его не трогает`);
  }
  const data = {
    name,
    role,
    organizationId,
    salonId,
    passwordHash,
    deletedAt: null,
    positionLabel: role === 'ADMIN' ? 'Владелец' : 'Менеджер',
  };
  if (existing) return prisma.user.update({ where: { id: existing.id }, data });
  return prisma.user.create({ data: { email, ...data } });
}

async function wipeDemo(organizationId) {
  await prisma.visit.deleteMany({ where: { client: { organizationId } } });
  await prisma.task.deleteMany({
    where: {
      OR: [{ client: { organizationId } }, { assignee: { organizationId } }, { deal: { client: { organizationId } } }],
    },
  });
  await prisma.comment.deleteMany({ where: { deal: { client: { organizationId } } } });
  await prisma.dealHistory.deleteMany({ where: { deal: { client: { organizationId } } } });
  await prisma.chatMessage.deleteMany({ where: { deal: { client: { organizationId } } } });
  await prisma.vehicle.updateMany({
    where: { salon: { organizationId } },
    data: { reservedDealId: null, reservedById: null, reservedAt: null, reservedUntil: null },
  });
  await prisma.deal.deleteMany({ where: { client: { organizationId } } });
  await prisma.vehicle.deleteMany({ where: { salon: { organizationId } } });
  await prisma.client.deleteMany({ where: { organizationId } });
}

async function main() {
  const password = String(process.env.DEMO_PASSWORD || '');
  if (password.length < 8) {
    console.error('Задайте DEMO_PASSWORD в backend/.env (не короче 8 символов) и запустите скрипт снова.');
    process.exitCode = 1;
    return;
  }

  await prisma.organization.updateMany({
    where: { slug: 'test-salon' },
    data: { isTest: true },
  });

  let org = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Демо Автосалон', slug: DEMO_SLUG, city: 'Москва', isTest: true },
    });
  } else {
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { name: 'Демо Автосалон', city: 'Москва', isTest: true },
    });
  }

  const foreignSalon = await prisma.salon.findUnique({ where: { slug: SALON_SLUG } });
  if (foreignSalon && foreignSalon.organizationId && foreignSalon.organizationId !== org.id) {
    throw new Error(`Салон ${SALON_SLUG} принадлежит другой организации`);
  }

  await wipeDemo(org.id);

  const salon = foreignSalon
    ? await prisma.salon.update({
        where: { id: foreignSalon.id },
        data: { name: 'Демо Автосалон — шоурум', organizationId: org.id },
      })
    : await prisma.salon.create({
        data: { name: 'Демо Автосалон — шоурум', slug: SALON_SLUG, organizationId: org.id },
      });

  const passwordHash = await bcrypt.hash(password, 10);
  const owner = await upsertDemoUser({
    email: OWNER_EMAIL,
    name: 'Демо Администратор',
    role: 'ADMIN',
    organizationId: org.id,
    salonId: salon.id,
    passwordHash,
  });
  await prisma.organization.update({ where: { id: org.id }, data: { ownerId: owner.id } });
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      plan: 'ADVANCED',
      status: 'ACTIVE',
      billingInterval: 'month',
      currentPeriodEnd: null,
      trialEndsAt: null,
    },
    update: {
      plan: 'ADVANCED',
      status: 'ACTIVE',
      currentPeriodEnd: null,
      trialEndsAt: null,
    },
  });

  const managers = [];
  for (const person of MANAGERS) {
    managers.push(
      await upsertDemoUser({
        ...person,
        role: 'MANAGER',
        organizationId: org.id,
        salonId: salon.id,
        passwordHash,
      })
    );
  }

  const vehicles = [];
  for (let i = 0; i < CARS.length; i += 1) {
    const [brand, model, year, kind, status, price, mileageKm, color] = CARS[i];
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          salonId: salon.id,
          brand,
          model,
          year,
          kind,
          status,
          price,
          mileageKm,
          color,
          vin: `XDEMO${String(i + 1).padStart(11, '0')}`,
          externalId: `demo-veh-${String(i + 1).padStart(2, '0')}`,
          sourceSystem: 'demo',
          photoUrls: ['/logo-mark.png'],
          description: 'Фото-заглушка для демонстрации склада.',
          stockedAt: atDay(-((i % 20) + 1)),
        },
      })
    );
  }

  const deals = [];
  for (let i = 0; i < NAMES.length; i += 1) {
    const source = SOURCES[i % SOURCES.length];
    const createdAt = atDay(-((i % 14) + 1), 9 + (i % 8));
    const manager = managers[i % managers.length];
    const vehicle = vehicles[i % vehicles.length];
    const stage = i < PIPELINE.length ? PIPELINE[i] : 'NEW_LEAD';
    const client = await prisma.client.create({
      data: {
        name: NAMES[i],
        phone: `+7999100${String(i + 1).padStart(4, '0')}`,
        email: `lead${i + 1}@demo-salon.test`,
        source,
        comment: `Заявка с канала ${source}`,
        organizationId: org.id,
        salonId: salon.id,
        responsibleManagerId: manager.id,
        createdAt,
      },
    });
    const deal = await prisma.deal.create({
      data: {
        clientId: client.id,
        title: `${NAMES[i].split(' ')[0]} · ${vehicle.brand} ${vehicle.model}`,
        amount: vehicle.price,
        stage,
        stageChangedAt: createdAt,
        responsibleId: manager.id,
        leadType: i % 5 === 0 ? 'TRADE_IN' : 'PURCHASE',
        vehicleId: stage === 'LOST' ? null : vehicle.id,
        salonId: salon.id,
        sourceUrl: source,
        lostReason: stage === 'LOST' ? 'Купил в другом салоне' : null,
        idempotencyKey: `demo-deal-${org.id}-${i + 1}`,
        createdAt,
        firstRespondedAt: stage === 'NEW_LEAD' ? null : atDay(-((i % 14)), 12),
      },
    });
    deals.push({ deal, client, manager, vehicle, stage });
  }

  const visitDeals = deals.filter((item) => item.stage !== 'LOST').slice(0, 8);
  for (let i = 0; i < visitDeals.length; i += 1) {
    const item = visitDeals[i];
    await prisma.visit.create({
      data: {
        clientId: item.client.id,
        dealId: item.deal.id,
        managerId: item.manager.id,
        scheduledAt: atDay(i + 1, 12 + (i % 4)),
        status: 'SCHEDULED',
        note: i % 2 === 0 ? 'Просмотр автомобиля' : 'Тест-драйв',
      },
    });
  }

  for (let i = 0; i < 8; i += 1) {
    const item = deals[i];
    await prisma.task.create({
      data: {
        title: i % 2 === 0 ? 'Перезвонить клиенту' : 'Подготовить расчёт',
        description: 'Демо-задача, срок относительно сегодняшнего дня.',
        status: 'OPEN',
        dueAt: atDay(i < 3 ? 0 : i - 2, 18),
        dealId: item.deal.id,
        clientId: item.client.id,
        assigneeId: item.manager.id,
        createdById: owner.id,
      },
    });
  }

  for (let i = 0; i < 6; i += 1) {
    const item = deals[i + 2];
    await prisma.comment.create({
      data: {
        dealId: item.deal.id,
        authorId: item.manager.id,
        text: i % 2 === 0 ? 'Клиент смотрит этот автомобиль и аналог.' : 'Договорились о визите в салон.',
        createdAt: atDay(-((i % 5) + 1), 16),
      },
    });
  }

  console.log(`Демо-салон «${org.name}» готов. Вход: ${OWNER_EMAIL}`);
  console.log(`Менеджеры: ${managers.map((item) => item.email).join(', ')}`);
  console.log('Пароль берётся из DEMO_PASSWORD и в лог не пишется.');
  console.log(`Склад: ${vehicles.length}, заявки: ${deals.length}, из них сделки дальше «Новый лид»: ${PIPELINE.length}.`);
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
