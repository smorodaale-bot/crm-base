/** Критерии оценки качества работы менеджера */

export const POSITIVE_CRITERIA = [
  {
    key: 'introduction',
    label: 'Представился',
    weight: 0.1,
    description: 'Менеджер назвал имя и компанию / должность',
  },
  {
    key: 'needs',
    label: 'Выявил потребность',
    weight: 0.15,
    description: 'Уточнил цели, задачи и контекст клиента',
  },
  {
    key: 'budget',
    label: 'Выявил бюджет',
    weight: 0.1,
    description: 'Обсудил бюджет или ценовой диапазон',
  },
  {
    key: 'timeline',
    label: 'Выявил сроки',
    weight: 0.1,
    description: 'Уточнил желаемые сроки покупки / запуска',
  },
  {
    key: 'presentation',
    label: 'Презентовал продукт',
    weight: 0.15,
    description: 'Описал продукт, выгоды и релевантные опции',
  },
  {
    key: 'objections',
    label: 'Отработал возражения',
    weight: 0.15,
    description: 'Принял возражение и предложил аргумент / альтернативу',
  },
  {
    key: 'next_step',
    label: 'Согласовал следующий шаг',
    weight: 0.15,
    description: 'Зафиксировал конкретный следующий шаг и срок',
  },
];

export const NEGATIVE_CRITERIA = [
  {
    key: 'false_promises',
    label: 'Недостоверные обещания',
    maxPenalty: 25,
    criticalThreshold: 70,
    description: 'Гарантии без оснований, заведомо ложные утверждения',
  },
  {
    key: 'rudeness',
    label: 'Грубость',
    maxPenalty: 30,
    criticalThreshold: 60,
    description: 'Оскорбления, пренебрежение, агрессивный тон',
  },
  {
    key: 'incorrectness',
    label: 'Некорректность',
    maxPenalty: 20,
    criticalThreshold: 70,
    description: 'Неуместные высказывания, давление, манипуляции',
  },
  {
    key: 'conflict',
    label: 'Признаки конфликта',
    maxPenalty: 25,
    criticalThreshold: 60,
    description: 'Эскалация, взаимные претензии, срыв диалога',
  },
];

export const ALL_CRITERIA = [...POSITIVE_CRITERIA, ...NEGATIVE_CRITERIA];

export const CRITERION_LABELS = Object.fromEntries(
  ALL_CRITERIA.map((c) => [c.key, c.label])
);
