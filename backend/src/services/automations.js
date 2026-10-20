import { prisma } from '../db.js';
import { notifyUser } from './notify.js';

/** Automations on new public lead. */
export async function runLeadAutomations(deal) {
  await prisma.task.create({
    data: {
      title: `Связаться с лидом: ${deal.title}`,
      description: 'Автозадача: первый контакт в рамках SLA',
      assigneeId: deal.responsibleId,
      createdById: deal.responsibleId,
      dealId: deal.id,
      clientId: deal.clientId,
      dueAt: deal.nextContactAt || new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

/** When deal stage changes — create follow-up task for key transitions. */
export async function runStageAutomations(deal, oldStage, newStage, actorId) {
  if (oldStage === newStage) return;

  if (newStage === 'NEGOTIATION') {
    await prisma.task.create({
      data: {
        title: 'Подготовить коммерческое предложение',
        assigneeId: deal.responsibleId,
        createdById: actorId || deal.responsibleId,
        dealId: deal.id,
        clientId: deal.clientId,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  if (newStage === 'WON') {
    await notifyUser(deal.responsibleId, {
      title: 'Сделка выиграна',
      body: deal.title,
      link: `/deals/${deal.id}`,
    });
  }
}

/** Visit no-show → callback task. */
export async function runVisitNoShowAutomation(visit) {
  await prisma.task.create({
    data: {
      title: 'Перезвонить после no-show',
      description: visit.note || 'Клиент не пришёл на визит',
      assigneeId: visit.managerId,
      createdById: visit.managerId,
      dealId: visit.dealId || undefined,
      clientId: visit.clientId,
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  await notifyUser(visit.managerId, {
    title: 'No-show визита',
    body: 'Создана задача на перезвон',
    link: visit.dealId ? `/deals/${visit.dealId}` : '/visits',
  });
}
