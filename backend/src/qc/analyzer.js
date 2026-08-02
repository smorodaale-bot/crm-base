import { POSITIVE_CRITERIA, NEGATIVE_CRITERIA, CRITERION_LABELS } from './criteria.js';

/**
 * Правило-ориентированный анализатор транскрибаций (русский язык).
 * Ищет маркеры по репликам менеджера, извлекает подтверждающие фрагменты,
 * считает баллы 0–100 и формирует ошибки / рекомендации / резюме.
 *
 * При наличии OPENAI_API_KEY можно подключить LLM-слой (см. llmEnhancer.js),
 * но базовый движок всегда детерминирован и пригоден для golden-set тестов.
 */

const MANAGER_RE = /^(?:менеджер|manager|м|mgr)\s*[:\-–]\s*/i;
const CLIENT_RE = /^(?:клиент|client|к|покупатель)\s*[:\-–]\s*/i;

function splitLines(transcript) {
  return String(transcript || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseUtterances(transcript) {
  const lines = splitLines(transcript);
  const utterances = [];

  for (const line of lines) {
    let speaker = 'unknown';
    let text = line;

    if (MANAGER_RE.test(line)) {
      speaker = 'manager';
      text = line.replace(MANAGER_RE, '').trim();
    } else if (CLIENT_RE.test(line)) {
      speaker = 'client';
      text = line.replace(CLIENT_RE, '').trim();
    }

    utterances.push({ speaker, text, raw: line });
  }

  // Если роли не размечены — считаем чередование: первая реплика менеджера
  const hasRoles = utterances.some((u) => u.speaker !== 'unknown');
  if (!hasRoles && utterances.length) {
    utterances.forEach((u, i) => {
      u.speaker = i % 2 === 0 ? 'manager' : 'client';
    });
  }

  return utterances;
}

function findMatches(utterances, patterns, { speaker = 'manager', limit = 3 } = {}) {
  const hits = [];
  for (const u of utterances) {
    if (speaker && u.speaker !== speaker && speaker !== 'any') continue;
    for (const pattern of patterns) {
      if (pattern.test(u.text)) {
        hits.push({
          text: u.raw || `${u.speaker}: ${u.text}`,
          speaker: u.speaker,
          pattern: String(pattern),
        });
        break;
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

function scoreFromHits(hits, { partial = 85, full = 98, none = 8 } = {}) {
  if (hits.length >= 2) return full;
  if (hits.length === 1) return partial;
  return none;
}

const PATTERNS = {
  introduction: [
    /меня\s+зовут/i,
    /это\s+[А-ЯЁA-Z][а-яёa-z]+/i,
    /я\s+[А-ЯЁA-Z][а-яёa-z]+[,.]?\s*(менеджер|из|компани)/i,
    /компани[яи]\s+/i,
    /автосалон/i,
    /skay\s*avto|скай\s*авто/i,
    /представляюсь/i,
  ],
  needs: [
    /что\s+(для\s+вас\s+)?важно/i,
    /какая\s+(у\s+вас\s+)?(задача|цель|потребность|машина|модель)/i,
    /что\s+вас\s+интересует/i,
    /для\s+каких\s+целей/i,
    /какие\s+требования/i,
    /расскажите[, ]?\s*что\s+ищете/i,
    /какой\s+автомобиль/i,
    /нужен\s+(ли\s+)?вам/i,
  ],
  budget: [
    /бюджет/i,
    /ценовой\s+диапазон/i,
    /на\s+какую\s+сумму/i,
    /сколько\s+планируете/i,
    /до\s+\d[\d\s]*\s*(тыс|млн|руб)/i,
    /\d[\d\s]*\s*(тысяч|тыс\.?|миллион)/i,
    /по\s+деньгам/i,
    /стоимость/i,
  ],
  timeline: [
    /срок/i,
    /когда\s+(планируете|нужно|хотите|готовы)/i,
    /в\s+какие\s+сроки/i,
    /на\s+этой\s+недел/i,
    /в\s+этом\s+месяц/i,
    /как\s+срочно/i,
    /дата\s+(покупки|сделки)/i,
    /к\s+(сентябр|октябр|ноябр|декабр|январ|феврал|март|апрел|ма[йю]|июн|июл|август)/i,
  ],
  presentation: [
    /предлагаю/i,
    /рекомендую/i,
    /у\s+нас\s+есть/i,
    /модель/i,
    /комплектаци/i,
    /преимуществ/i,
    /гарантия\s+\d/i,
    /включает/i,
    /опци/i,
    /характеристик/i,
    /кроссовер|седан|электромобил/i,
  ],
  objections: [
    /понимаю\s+ваше/i,
    /да[, ]?\s*согласен/i,
    /с\s+одной\s+сторон/i,
    /можем\s+(предложить|рассмотреть)/i,
    /альтернатив/i,
    /скидк/i,
    /рассрочк/i,
    /сравним/i,
    /trade-?in/i,
  ],
  next_step: [
    /следующ(ий|им)\s+шаг/i,
    /давайте\s+(запишем|согласуем|назначим|созвонимся)/i,
    /перезвоню\s+(вам\s+)?(завтра|в\s+\d|послезавтра|в\s+понедельник|во\s+вторник)/i,
    /отправлю\s+(КП|коммерческ|презентац|каталог)/i,
    /встреча\s+(в|на)/i,
    /завтра\s+в/i,
    /запишу\s+вас/i,
    /тест[-\s]?драйв/i,
    /договорились/i,
  ],
  false_promises: [
    /гарантирую\s+(100|сто\s+процент)/i,
    /точно\s+одобр/i,
    /без\s+отказа/i,
    /самая\s+низкая\s+цена\s+в\s+городе/i,
    /бесплатно\s+навсегда/i,
    /банк\s+обязательно/i,
    /100%\s*(гарантия|одобрение)/i,
  ],
  rudeness: [
    /вы\s+что[, ]?\s*глуп/i,
    /не\s+слушаете/i,
    /хватит\s+ныть/i,
    /сами\s+виноваты/i,
    /как\s+хотите[, ]?\s*мне\s+вс[её]\s+равно/i,
    /дурак|идиот|туп(ой|ые)/i,
    /отстаньте/i,
    /не\s+тратьте\s+мо[её]\s+время/i,
  ],
  incorrectness: [
    /только\s+сегодня\s+и\s+больше\s+никогда/i,
    /если\s+сейчас\s+не\s+купите[, ]?\s*потом\s+пожалеете/i,
    /всем\s+так\s+говорим/i,
    /подпишите\s+не\s+читая/i,
    /скрываем\s+от\s+руководства/i,
  ],
  conflict: [
    /я\s+на\s+вас\s+пожалуюсь/i,
    /вызывайте\s+руководител/i,
    /это\s+развод/i,
    /судиться/i,
    /хамство/i,
    /перестаньте\s+кричать/i,
    /не\s+буду\s+с\s+вами\s+говорить/i,
    /положите\s+трубку/i,
  ],
};

/** Клиентские маркеры возражений — усиливают критерий objections */
const CLIENT_OBJECTION = [
  /дорого/i,
  /подумаю/i,
  /у\s+других\s+дешевле/i,
  /не\s+уверен/i,
  /надо\s+посоветоваться/i,
  /кредит\s+не\s+одобр/i,
];

function evaluateCriterion(key, utterances) {
  const patterns = PATTERNS[key] || [];
  const isNegative = NEGATIVE_CRITERIA.some((c) => c.key === key);

  // Бюджет/сроки: достаточно, что тема выявлена в диалоге (менеджер или клиент)
  const discoveryAnySpeaker = ['budget', 'timeline'].includes(key);

  if (key === 'objections') {
    const clientObj = findMatches(utterances, CLIENT_OBJECTION, { speaker: 'client', limit: 2 });
    const managerHandle = findMatches(utterances, PATTERNS.objections, {
      speaker: 'manager',
      limit: 3,
    });
    if (clientObj.length && managerHandle.length) {
      return {
        score: 92,
        evidence: [...clientObj.slice(0, 1), ...managerHandle.slice(0, 2)],
        passed: true,
      };
    }
    if (managerHandle.length) {
      return { score: 70, evidence: managerHandle, passed: true };
    }
    if (clientObj.length) {
      return {
        score: 25,
        evidence: clientObj,
        passed: false,
        note: 'Возражение клиента есть, отработки менеджера не видно',
      };
    }
    return {
      score: 50,
      evidence: [],
      passed: true,
      note: 'Явных возражений в разговоре не было',
    };
  }

  const hits = findMatches(utterances, patterns, {
    speaker: isNegative ? 'any' : discoveryAnySpeaker ? 'any' : 'manager',
    limit: 3,
  });

  if (isNegative) {
    if (!hits.length) return { score: 0, evidence: [], passed: true };
    const intensity = Math.min(100, 55 + hits.length * 20);
    return { score: intensity, evidence: hits, passed: false };
  }

  const score = scoreFromHits(hits);
  return { score, evidence: hits, passed: score >= 60 };
}

function buildErrors(criterionResults) {
  const errors = [];
  for (const c of POSITIVE_CRITERIA) {
    const r = criterionResults[c.key];
    if (!r.passed) {
      errors.push({
        code: `missing_${c.key}`,
        severity: r.score < 30 ? 'high' : 'medium',
        criterion: c.key,
        message: `Не выполнен критерий «${c.label}»`,
      });
    }
  }
  for (const c of NEGATIVE_CRITERIA) {
    const r = criterionResults[c.key];
    if (r.score >= 40) {
      errors.push({
        code: c.key,
        severity: r.score >= c.criticalThreshold ? 'critical' : 'high',
        criterion: c.key,
        message: `Обнаружено: ${c.label}`,
      });
    }
  }
  return errors;
}

function buildRecommendations(criterionResults, errors) {
  const recs = [];
  const tips = {
    introduction: 'В начале звонка чётко представьтесь: имя, должность, компания.',
    needs: 'Задайте 2–3 открытых вопроса о целях и сценарии использования.',
    budget: 'Мягко уточните бюджетный коридор до презентации конкретных опций.',
    timeline: 'Спросите, к какому сроку клиенту нужно решение или автомобиль.',
    presentation: 'Свяжите преимущества продукта с озвученной потребностью клиента.',
    objections: 'Используйте схему: принять → уточнить → аргумент / альтернатива.',
    next_step: 'Всегда фиксируйте следующий шаг: дату, канал и ответственного.',
    false_promises: 'Не давайте гарантий, которые не можете подтвердить документами.',
    rudeness: 'Сохраняйте спокойный тон; при эскалации предложите перевод на руководителя.',
    incorrectness: 'Избегайте давления и манипулятивных формулировок.',
    conflict: 'Признайте эмоции клиента и переведите разговор в конструктив.',
  };

  for (const e of errors) {
    if (tips[e.criterion]) recs.push(tips[e.criterion]);
  }

  if (!recs.length) {
    recs.push('Разговор в целом соответствует стандарту. Зафиксируйте результат в CRM.');
  }

  return [...new Set(recs)].slice(0, 6);
}

function computeOverall(criterionResults) {
  let positive = 0;
  for (const c of POSITIVE_CRITERIA) {
    positive += (criterionResults[c.key].score / 100) * c.weight;
  }
  const positiveScore = Math.round(positive * 100);

  let penalty = 0;
  for (const c of NEGATIVE_CRITERIA) {
    const s = criterionResults[c.key].score;
    if (s > 0) {
      penalty += (s / 100) * c.maxPenalty;
    }
  }

  return Math.max(0, Math.min(100, Math.round(positiveScore - penalty)));
}

function isCriticalReview(overall, criterionResults, errors) {
  if (errors.some((e) => e.severity === 'critical')) return true;
  for (const c of NEGATIVE_CRITERIA) {
    if (criterionResults[c.key].score >= c.criticalThreshold) return true;
  }
  // Крайне низкий балл без негативных маркеров — тоже эскалация
  if (overall < 25) return true;
  return false;
}

function buildSummary(overall, criterionResults, errors, managerLabel) {
  const passed = POSITIVE_CRITERIA.filter((c) => criterionResults[c.key].passed).map(
    (c) => c.label
  );
  const failed = POSITIVE_CRITERIA.filter((c) => !criterionResults[c.key].passed).map(
    (c) => c.label
  );
  const critical = errors.filter((e) => e.severity === 'critical' || e.severity === 'high');

  const parts = [
    `${managerLabel || 'Менеджер'}: итоговая оценка ${overall}/100.`,
  ];
  if (passed.length) parts.push(`Сильные стороны: ${passed.join(', ')}.`);
  if (failed.length) parts.push(`Пробелы: ${failed.join(', ')}.`);
  if (critical.length) {
    parts.push(
      `Риски: ${critical.map((e) => CRITERION_LABELS[e.criterion] || e.message).join(', ')}.`
    );
  } else {
    parts.push('Критических нарушений не выявлено.');
  }
  return parts.join(' ');
}

export function analyzeTranscript(transcript, { managerName } = {}) {
  const utterances = parseUtterances(transcript);
  const criterionResults = {};
  const evidence = {};
  const scores = {};

  for (const c of [...POSITIVE_CRITERIA, ...NEGATIVE_CRITERIA]) {
    const result = evaluateCriterion(c.key, utterances);
    criterionResults[c.key] = result;
    scores[c.key] = result.score;
    evidence[c.key] = result.evidence.map((h) => h.text);
  }

  const errors = buildErrors(criterionResults);
  const recommendations = buildRecommendations(criterionResults, errors);
  const overallScore = computeOverall(criterionResults);
  const critical = isCriticalReview(overallScore, criterionResults, errors);
  const summary = buildSummary(overallScore, criterionResults, errors, managerName);

  return {
    overallScore,
    isCritical: critical,
    criterionScores: scores,
    evidence,
    errors,
    recommendations,
    summary,
    analyzerVersion: 'rules-v1',
    meta: {
      utteranceCount: utterances.length,
      managerLines: utterances.filter((u) => u.speaker === 'manager').length,
      clientLines: utterances.filter((u) => u.speaker === 'client').length,
    },
  };
}

export function effectiveScore(review) {
  return review.manualScore != null ? review.manualScore : review.overallScore;
}
