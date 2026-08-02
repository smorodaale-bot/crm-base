/**
 * Опциональное LLM-усиление QC.
 * Приоритет: YandexGPT (YANDEX_API_KEY + YANDEX_FOLDER_ID), иначе OpenAI.
 * Без ключей модуль полностью работает на rules-v1.
 */

const SYSTEM_PROMPT =
  'Ты аудитор качества продаж. Верни ТОЛЬКО валидный JSON без markdown: {criterionScores:{...}, errors:[{code,severity,criterion,message}], recommendations:[string], summary:string, isCritical:boolean}. Баллы 0-100. Критерии: introduction,needs,budget,timeline,presentation,objections,next_step,false_promises,rudeness,incorrectness,conflict.';

function buildUserPrompt(transcript, baseResult) {
  return `Транскрипт:\n${transcript}\n\nБазовый анализ (можно скорректировать):\n${JSON.stringify(baseResult.criterionScores)}`;
}

function mergeLlmResult(baseResult, parsed, version) {
  return {
    ...baseResult,
    criterionScores: { ...baseResult.criterionScores, ...(parsed.criterionScores || {}) },
    errors: parsed.errors || baseResult.errors,
    recommendations: parsed.recommendations || baseResult.recommendations,
    summary: parsed.summary || baseResult.summary,
    isCritical:
      typeof parsed.isCritical === 'boolean' ? parsed.isCritical : baseResult.isCritical,
    overallScore: baseResult.overallScore,
    analyzerVersion: version,
    llmRaw: parsed,
  };
}

function extractJson(text) {
  if (!text) throw new Error('empty llm response');
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('invalid json from llm');
  }
}

async function enhanceWithYandex(transcript, baseResult) {
  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId) return null;

  const model = process.env.YANDEX_GPT_MODEL || 'yandexgpt-lite';
  const modelUri = process.env.YANDEX_MODEL_URI || `gpt://${folderId}/${model}`;

  const res = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method: 'POST',
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      'Content-Type': 'application/json',
      'x-folder-id': folderId,
    },
    body: JSON.stringify({
      modelUri,
      completionOptions: {
        stream: false,
        temperature: 0.1,
        maxTokens: 2000,
      },
      messages: [
        { role: 'system', text: SYSTEM_PROMPT },
        { role: 'user', text: buildUserPrompt(transcript, baseResult) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('YandexGPT error', res.status, errText.slice(0, 300));
    return { ...baseResult, analyzerVersion: 'rules-v1+yandex-fallback' };
  }

  const data = await res.json();
  const content = data?.result?.alternatives?.[0]?.message?.text;
  const parsed = extractJson(content);
  return mergeLlmResult(baseResult, parsed, 'rules-v1+yandexgpt');
}

async function enhanceWithOpenAI(transcript, baseResult) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(transcript, baseResult) },
      ],
    }),
  });

  if (!res.ok) return { ...baseResult, analyzerVersion: 'rules-v1+llm-fallback' };

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  return mergeLlmResult(baseResult, parsed, 'rules-v1+llm');
}

export function llmConfigured() {
  return Boolean(
    (process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID) || process.env.OPENAI_API_KEY
  );
}

export async function maybeEnhanceWithLlm(transcript, baseResult) {
  if (!llmConfigured()) {
    return { ...baseResult, analyzerVersion: baseResult.analyzerVersion };
  }

  try {
    const yandex = await enhanceWithYandex(transcript, baseResult);
    if (yandex) return yandex;

    const openai = await enhanceWithOpenAI(transcript, baseResult);
    if (openai) return openai;

    return { ...baseResult, analyzerVersion: baseResult.analyzerVersion };
  } catch (err) {
    console.error('LLM enhance failed', err.message);
    return { ...baseResult, analyzerVersion: 'rules-v1+llm-error' };
  }
}

/** Транскрибация аудио через OpenAI Whisper (если есть OPENAI_API_KEY). */
export async function transcribeAudioFile(filePath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const fs = await import('fs');
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(filePath)]);
    form.append('file', blob, 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'ru');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.text || null;
  } catch {
    return null;
  }
}
