import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate } from '../constants.js';
import { useAuth } from '../auth.jsx';
import { AppLoader } from '../components/AppLoader.jsx';

const POSITIVE = [
  'introduction',
  'needs',
  'budget',
  'timeline',
  'presentation',
  'objections',
  'next_step',
];

export default function QcDetailPage() {
  const { id } = useParams();
  const { isSupervisor, canWrite } = useAuth();
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [manualScore, setManualScore] = useState('');
  const [supervisorComment, setSupervisorComment] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);

  const load = () =>
    api(`/qc/reviews/${id}`)
      .then((res) => {
        setReview(res.review);
        setManualScore(
          res.review.manualScore != null ? String(res.review.manualScore) : String(res.review.overallScore)
        );
        setSupervisorComment(res.review.supervisorComment || '');
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, [id]);

  const save = async (e) => {
    e.preventDefault();
    if (!isSupervisor && !comment.trim()) return;
    setSaving(true);
    setError('');
    try {
      const body = {};
      if (isSupervisor) {
        body.manualScore = Number(manualScore);
        body.supervisorComment = supervisorComment;
      }
      if (comment.trim()) body.comment = comment.trim();
      const res = await api(`/qc/reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setReview(res.review);
      setComment('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !review) return <div className="error">{error}</div>;
  if (!review) return <AppLoader />;

  const labels = review.criterionLabels || {};
  const scores = review.criterionScores || {};
  const evidence = review.evidence || {};
  const errors = Array.isArray(review.errors) ? review.errors : [];
  const recommendations = Array.isArray(review.recommendations) ? review.recommendations : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/qc" className="muted">
            ← К списку
          </Link>
          <h1>{review.title}</h1>
          <p className="muted">
            {review.manager?.name}
            {review.clientName ? ` · ${review.clientName}` : ''} · {formatDate(review.createdAt)}
          </p>
        </div>
        <div className="score-hero">
          <div className="muted">Итоговая оценка</div>
          <div className={`score-big ${review.isCritical ? 'bad' : review.effectiveScore >= 70 ? 'ok' : 'mid'}`}>
            {review.effectiveScore}
          </div>
          {review.manualScore != null && (
            <div className="muted">Автооценка ИИ: {review.overallScore}</div>
          )}
          {review.isCritical && <span className="badge danger">Критическое нарушение</span>}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <h2>Резюме для руководителя</h2>
        <p>{review.summary}</p>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>Критерии</h2>
          <div className="criteria-list">
            {Object.keys(scores).map((key) => (
              <div key={key} className="criterion-row">
                <div className="criterion-head">
                  <strong>{labels[key] || key}</strong>
                  <span
                    className={`score-badge ${
                      POSITIVE.includes(key)
                        ? scores[key] >= 70
                          ? 'score-ok'
                          : scores[key] >= 40
                            ? 'score-mid'
                            : 'score-bad'
                        : scores[key] >= 50
                          ? 'score-bad'
                          : 'score-ok'
                    }`}
                  >
                    {scores[key]}
                  </span>
                </div>
                {(evidence[key] || []).length > 0 && (
                  <ul className="evidence">
                    {evidence[key].map((frag, i) => (
                      <li key={i}>«{frag}»</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        <div>
          <section className="panel" style={{ marginBottom: '1rem' }}>
            <h2>Ошибки</h2>
            {!errors.length ? (
              <p className="muted">Ошибок не найдено</p>
            ) : (
              <ul>
                {errors.map((e, i) => (
                  <li key={i}>
                    <span className={`badge ${e.severity === 'critical' ? 'danger' : 'muted'}`}>
                      {e.severity}
                    </span>{' '}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" style={{ marginBottom: '1rem' }}>
            <h2>Рекомендации</h2>
            <ul>
              {recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <div className="page-header" style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Транскрибация</h2>
          <button className="btn ghost" type="button" onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? 'Скрыть' : 'Открыть'}
          </button>
        </div>
        {showTranscript && <pre className="transcript">{review.transcript}</pre>}
        {review.sourceType === 'AUDIO' && (
          <p className="muted">Источник: аудио «{review.audioOriginalName}»</p>
        )}
      </section>

      {canWrite && (
        <section className="panel" style={{ marginTop: '1rem' }}>
          <h2>{isSupervisor ? 'Ручная корректировка' : 'Комментарий'}</h2>
          <form onSubmit={save} className="form-grid">
            {isSupervisor && (
              <>
                <label>
                  Оценка (0–100)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={manualScore}
                    onChange={(e) => setManualScore(e.target.value)}
                    required
                  />
                </label>
                <label className="full">
                  Комментарий руководителя
                  <textarea
                    rows={3}
                    value={supervisorComment}
                    onChange={(e) => setSupervisorComment(e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="full">
              Добавить комментарий в ленту
              <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            <div className="full">
              <button className="btn primary" disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </form>

          {review.comments?.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3>Лента комментариев</h3>
              <ul className="comment-feed">
                {review.comments.map((c) => (
                  <li key={c.id}>
                    <strong>{c.author?.name}</strong>
                    <span className="muted"> · {formatDate(c.createdAt)}</span>
                    <div>{c.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
