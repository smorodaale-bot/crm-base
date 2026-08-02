import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTranscript } from '../src/qc/analyzer.js';
import { TEST_CONVERSATIONS } from '../src/qc/fixtures.js';

function checkExpected(name, result, expected) {
  assert.ok(
    result.overallScore >= expected.overallMin && result.overallScore <= expected.overallMax,
    `${name}: overall ${result.overallScore} not in [${expected.overallMin}, ${expected.overallMax}]`
  );

  if (expected.isCritical != null) {
    assert.equal(result.isCritical, expected.isCritical, `${name}: isCritical`);
  }

  for (const key of expected.mustPass || []) {
    assert.ok(
      result.criterionScores[key] >= 60,
      `${name}: expected pass ${key}, got ${result.criterionScores[key]}`
    );
  }

  for (const key of expected.mustFail || []) {
    assert.ok(
      result.criterionScores[key] < 60,
      `${name}: expected fail ${key}, got ${result.criterionScores[key]}`
    );
  }

  for (const key of expected.mustBeHigh || []) {
    assert.ok(
      result.criterionScores[key] >= 50,
      `${name}: expected high risk ${key}, got ${result.criterionScores[key]}`
    );
  }

  for (const key of expected.mustBeLow || []) {
    assert.ok(
      result.criterionScores[key] < 40,
      `${name}: expected low risk ${key}, got ${result.criterionScores[key]}`
    );
  }
}

test('golden set: all 5 conversations match expected quality bands', () => {
  const report = [];

  for (const fixture of TEST_CONVERSATIONS) {
    const result = analyzeTranscript(fixture.transcript, { managerName: 'Тест' });
    checkExpected(fixture.id, result, fixture.expected);

    // У каждого положительного/негативного вывода с баллом должен быть evidence или осознанный note
    for (const [key, score] of Object.entries(result.criterionScores)) {
      if (score >= 60 || (['false_promises', 'rudeness', 'incorrectness', 'conflict'].includes(key) && score >= 40)) {
        const ev = result.evidence[key] || [];
        // objections без возражений может быть 50 без evidence — ок
        if (key !== 'objections' || score >= 60) {
          assert.ok(
            ev.length > 0 || key === 'objections',
            `${fixture.id}: ${key}=${score} without evidence`
          );
        }
      }
    }

    report.push({
      id: fixture.id,
      overall: result.overallScore,
      critical: result.isCritical,
      scores: result.criterionScores,
    });
  }

  console.log('QC golden-set report:', JSON.stringify(report, null, 2));
});

test('evidence fragments are taken from transcript text', () => {
  const fixture = TEST_CONVERSATIONS[0];
  const result = analyzeTranscript(fixture.transcript);
  const flat = Object.values(result.evidence).flat().join('\n');
  assert.match(flat, /Анна|SkayAvto|бюджет|тест-драйв/i);
});
