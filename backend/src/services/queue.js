/**
 * Lightweight in-process job queue (Redis optional later).
 * Used for SpeechKit / QC heavy work so API stays responsive.
 */

const queue = [];
let running = false;

export function enqueueJob(type, payload) {
  return new Promise((resolve, reject) => {
    queue.push({ type, payload, resolve, reject, createdAt: Date.now() });
    pump();
  });
}

export function queueSize() {
  return queue.length + (running ? 1 : 0);
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    const result = await handlers[job.type]?.(job.payload);
    job.resolve(result ?? { ok: true });
  } catch (err) {
    job.reject(err);
  } finally {
    running = false;
    if (queue.length) setImmediate(pump);
  }
}

const handlers = {
  async qc_analyze({ reviewId, transcript, managerName }) {
    const { analyzeTranscript } = await import('../qc/analyzer.js');
    const { maybeEnhanceWithLlm } = await import('../qc/llm.js');
    const { prisma } = await import('../db.js');
    let result = analyzeTranscript(transcript, { managerName });
    result = await maybeEnhanceWithLlm(transcript, result);
    await prisma.qcReview.update({
      where: { id: reviewId },
      data: {
        overallScore: result.overallScore,
        isCritical: result.isCritical,
        criterionScores: result.criterionScores,
        evidence: result.evidence,
        errors: result.errors,
        recommendations: result.recommendations,
        summary: result.summary,
        analyzerVersion: result.analyzerVersion,
      },
    });
    return result;
  },

  async speechkit_transcribe({ filePath }) {
    const { transcribeAudioFile } = await import('../qc/llm.js');
    return transcribeAudioFile(filePath);
  },
};

export function registerQueueHandler(type, fn) {
  handlers[type] = fn;
}
