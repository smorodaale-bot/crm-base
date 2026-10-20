import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';
import { CHAT_CHANNEL_LABELS, formatDate } from '../constants.js';
import { EmptyState } from './EmptyState.jsx';

const POLL_MS = 3000;

function timeShort(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return formatDate(value);
  }
}

/**
 * Live deal chat: bubbles + polling. variant "full" = page-height messenger.
 */
export default function DealChat({
  dealId,
  canWrite = false,
  clientName = 'Клиент',
  variant = 'embedded',
  showExpandLink = true,
}) {
  const toast = useToast();
  const listRef = useRef(null);
  const stickBottom = useRef(true);
  const [messages, setMessages] = useState([]);
  const [replyTargets, setReplyTargets] = useState(null);
  const [channel, setChannel] = useState('INTERNAL');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const scrollToBottom = useCallback((force = false) => {
    const el = listRef.current;
    if (!el) return;
    if (force || stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const loadChat = useCallback(
    async ({ silent = false } = {}) => {
      if (!dealId) return;
      try {
        const data = await api(`/deals/${dealId}/chat`);
        const next = data.messages || [];
        setMessages((prev) => {
          if (prev.length && next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id) {
            return prev;
          }
          return next;
        });
        setReplyTargets(data.replyTargets || null);
        setChannel((c) => {
          if (c !== 'INTERNAL') return c;
          if (data.replyTargets?.telegram) return 'TELEGRAM';
          if (data.replyTargets?.max) return 'MAX';
          return c;
        });
        setError('');
        requestAnimationFrame(() => scrollToBottom());
      } catch (err) {
        if (!silent) setError(err.message);
      }
    },
    [dealId, scrollToBottom]
  );

  useEffect(() => {
    loadChat();
    const timer = setInterval(() => loadChat({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [loadChat]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottom.current = gap < 80;
  }

  async function send(e) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await api(`/deals/${dealId}/chat`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim(), channel }),
      });
      setBody('');
      stickBottom.current = true;
      await loadChat();
      toast.success(
        channel === 'TELEGRAM'
          ? 'Отправлено в Telegram'
          : channel === 'MAX'
            ? 'Отправлено в MAX'
            : 'Сохранено'
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  const rootClass = variant === 'full' ? 'deal-chat deal-chat-full' : 'deal-chat deal-chat-embed';

  return (
    <div className={rootClass}>
      <div className="deal-chat-head">
        <div>
          <h2>{variant === 'full' ? `Чат · ${clientName}` : 'Чат по сделке'}</h2>
          <p className="muted">
            {replyTargets?.linkedChannel
              ? `Канал: ${CHAT_CHANNEL_LABELS[replyTargets.linkedChannel] || replyTargets.linkedChannel}`
              : 'Обновляется автоматически'}
          </p>
        </div>
        <div className="row gap">
          {showExpandLink && variant === 'embedded' && (
            <Link className="btn" to={`/deals/${dealId}/chat`}>
              Полный чат
            </Link>
          )}
          {variant === 'full' && (
            <Link className="btn" to={`/deals/${dealId}`}>
              ← К сделке
            </Link>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="deal-chat-list" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <EmptyState title="Сообщений пока нет" text="Напишите клиенту или дождитесь ответа" />
        ) : (
          messages.map((m) => {
            const incoming = m.direction === 'in';
            return (
              <div
                key={m.id}
                className={`deal-chat-bubble ${incoming ? 'is-in' : 'is-out'}`}
              >
                <div className="deal-chat-meta">
                  <strong>{m.author?.name || (incoming ? clientName : 'Вы')}</strong>
                  <span>
                    {timeShort(m.createdAt)} · {CHAT_CHANNEL_LABELS[m.channel] || m.channel}
                  </span>
                </div>
                <div className="deal-chat-text">{m.body}</div>
              </div>
            );
          })
        )}
      </div>

      {canWrite ? (
        <form className="deal-chat-composer" onSubmit={send}>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Канал">
            <option value="INTERNAL">Заметка</option>
            <option value="TELEGRAM" disabled={!replyTargets?.telegram}>
              Telegram{replyTargets?.telegram ? '' : ' · нет'}
            </option>
            <option value="MAX" disabled={!replyTargets?.max}>
              MAX{replyTargets?.max ? '' : ' · нет'}
            </option>
          </select>
          <textarea
            rows={variant === 'full' ? 3 : 2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              channel === 'TELEGRAM'
                ? 'Ответ в Telegram…'
                : channel === 'MAX'
                  ? 'Ответ в MAX…'
                  : 'Заметка только в CRM…'
            }
            required
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
            }}
          />
          <button className="btn primary" type="submit" disabled={sending}>
            {sending ? '…' : 'Отправить'}
          </button>
        </form>
      ) : (
        <p className="muted deal-chat-readonly">Только просмотр</p>
      )}
    </div>
  );
}
