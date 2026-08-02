import bcrypt from 'bcryptjs';
import pkg from '@prisma/client';

const { PrismaClient, Role, DealStage } = pkg;
const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const sources = ['Сайт', 'Реклама', 'Рекомендация', 'Холодный звонок', 'Выставка'];
  for (const name of sources) {
    await prisma.leadSource.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const admin = await prisma.user.upsert({
    where: { email: 'admin@crm.local' },
    update: { role: Role.ADMIN },
    create: {
      email: 'admin@crm.local',
      name: 'Администратор',
      role: Role.ADMIN,
      passwordHash,
    },
  });

  const supervisor = await prisma.user.upsert({
    where: { email: 'boss@crm.local' },
    update: {},
    create: {
      email: 'boss@crm.local',
      name: 'Руководитель Иван',
      role: Role.SUPERVISOR,
      passwordHash,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@crm.local' },
    update: {},
    create: {
      email: 'manager@crm.local',
      name: 'Менеджер Анна',
      role: Role.MANAGER,
      passwordHash,
    },
  });

  const manager2 = await prisma.user.upsert({
    where: { email: 'manager2@crm.local' },
    update: {},
    create: {
      email: 'manager2@crm.local',
      name: 'Менеджер Пётр',
      role: Role.MANAGER,
      passwordHash,
    },
  });

  const vovaPasswordHash = await bcrypt.hash('admin', 10);
  const managerVova = await prisma.user.upsert({
    where: { email: 'vovabycode@crm.local' },
    update: {
      name: 'Менеджер Vova',
      role: Role.MANAGER,
      passwordHash: vovaPasswordHash,
      deletedAt: null,
    },
    create: {
      email: 'vovabycode@crm.local',
      name: 'Менеджер Vova',
      role: Role.MANAGER,
      passwordHash: vovaPasswordHash,
    },
  });

  await prisma.user.upsert({
    where: { email: 'viewer@crm.local' },
    update: {},
    create: {
      email: 'viewer@crm.local',
      name: 'Наблюдатель Оля',
      role: Role.READONLY,
      passwordHash,
    },
  });

  const site = await prisma.leadSource.findUnique({ where: { name: 'Сайт' } });
  const ads = await prisma.leadSource.findUnique({ where: { name: 'Реклама' } });

  const client1 = await prisma.client.upsert({
    where: { phone: '+79001112233' },
    update: {},
    create: {
      name: 'ООО Ромашка',
      phone: '+79001112233',
      email: 'info@romashka.ru',
      source: 'Сайт',
      sourceId: site?.id,
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'brand',
      comment: 'Интересуются корпоративным тарифом',
      responsibleManagerId: manager.id,
    },
  });

  const client2 = await prisma.client.upsert({
    where: { phone: '+79005556677' },
    update: {},
    create: {
      name: 'ИП Сидоров',
      phone: '+79005556677',
      email: 'sidorov@mail.ru',
      source: 'Реклама',
      sourceId: ads?.id,
      utmSource: 'yandex',
      utmMedium: 'cpc',
      comment: 'Нужна консультация',
      responsibleManagerId: manager2.id,
    },
  });

  const templates = [
    { title: 'Договорились созвониться', text: 'Согласовали повторный звонок.' },
    { title: 'Отправили КП', text: 'Коммерческое предложение отправлено на email.' },
    { title: 'Ждём решение', text: 'Клиент думает, follo-up через 3 дня.' },
  ];
  for (const t of templates) {
    const exists = await prisma.commentTemplate.findFirst({ where: { title: t.title } });
    if (!exists) {
      await prisma.commentTemplate.create({
        data: { ...t, createdBy: supervisor.id },
      });
    }
  }

  let deal = await prisma.deal.findFirst({
    where: { title: 'Поставка ПО для ООО Ромашка', deletedAt: null },
  });
  if (!deal) {
    deal = await prisma.deal.create({
      data: {
        clientId: client1.id,
        title: 'Поставка ПО для ООО Ромашка',
        amount: 250000,
        stage: DealStage.QUALIFICATION,
        stageChangedAt: new Date(Date.now() - 5 * 86400000),
        responsibleId: manager.id,
        nextContactAt: new Date(Date.now() - 1 * 86400000),
      },
    });
    await prisma.activityLog.create({
      data: {
        userId: manager.id,
        action: 'deal_created',
        entityType: 'deal',
        entityId: deal.id,
        metadata: { title: deal.title },
      },
    });
  }

  let deal2 = await prisma.deal.findFirst({
    where: { title: 'Консультация ИП Сидоров', deletedAt: null },
  });
  if (!deal2) {
    deal2 = await prisma.deal.create({
      data: {
        clientId: client2.id,
        title: 'Консультация ИП Сидоров',
        amount: 45000,
        stage: DealStage.FIRST_CONTACT,
        responsibleId: manager2.id,
        nextContactAt: new Date(),
      },
    });
  }

  const taskExists = await prisma.task.findFirst({
    where: { title: 'Перезвонить по КП', deletedAt: null },
  });
  if (!taskExists) {
    await prisma.task.create({
      data: {
        title: 'Перезвонить по КП',
        description: 'Уточнить решение по коммерческому предложению',
        dueAt: new Date(Date.now() - 2 * 3600000),
        dealId: deal.id,
        clientId: client1.id,
        assigneeId: manager.id,
        createdById: manager.id,
      },
    });
  }

  // --- QC: 5 тестовых разговоров ---
  const { analyzeTranscript } = await import('../src/qc/analyzer.js');
  const { TEST_CONVERSATIONS } = await import('../src/qc/fixtures.js');

  const managerByFixture = {
    ideal: manager,
    weak_discovery: manager2,
    rude_conflict: manager2,
    false_promises: manager,
    good_with_objection: manager2,
  };

  let dayOffset = 14;
  for (const fixture of TEST_CONVERSATIONS) {
    const exists = await prisma.qcReview.findFirst({
      where: { title: fixture.title },
    });
    if (exists) continue;

    const mgr = managerByFixture[fixture.id] || manager;
    const analysis = analyzeTranscript(fixture.transcript, { managerName: mgr.name });

    await prisma.qcReview.create({
      data: {
        managerId: mgr.id,
        createdById: supervisor.id,
        title: fixture.title,
        clientName: fixture.clientName,
        sourceType: 'TEXT',
        transcript: fixture.transcript,
        overallScore: analysis.overallScore,
        isCritical: analysis.isCritical,
        criterionScores: analysis.criterionScores,
        evidence: analysis.evidence,
        errors: analysis.errors,
        recommendations: analysis.recommendations,
        summary: analysis.summary,
        analyzerVersion: analysis.analyzerVersion,
        createdAt: new Date(Date.now() - dayOffset * 86400000),
      },
    });
    dayOffset -= 2;
  }

  console.log('Seed completed.');
  console.log('Accounts (password: Password123!):');
  console.log(`- Admin: ${admin.email}`);
  console.log(`- Supervisor: ${supervisor.email}`);
  console.log(`- Manager: ${manager.email}`);
  console.log(`- Manager 2: ${manager2.email}`);
  console.log(`- Manager Vova: ${managerVova.email} (password: admin)`);
  console.log('- Readonly: viewer@crm.local');
  console.log('QC: 5 тестовых разговоров загружены (см. /qc)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
