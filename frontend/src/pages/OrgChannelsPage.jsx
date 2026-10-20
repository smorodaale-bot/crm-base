import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate } from '../constants.js';
import OrgAdminShell from '../components/OrgAdminShell.jsx';
import { Skeleton } from '../components/Skeleton.jsx';

export default function OrgChannelsPage() {
  const { isSupervisor } = useAuth();
  const toast = useToast();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [leadIntake, setLeadIntake] = useState(null);
  const [websiteOriginsText, setWebsiteOriginsText] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);
  const [showLeadToken, setShowLeadToken] = useState(false);
  const [telegram, setTelegram] = useState(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [botConfig, setBotConfig] = useState(null);
  const [maxBot, setMaxBot] = useState(null);
  const [maxToken, setMaxToken] = useState('');
  const [maxBusy, setMaxBusy] = useState(false);
  const [maxBotConfig, setMaxBotConfig] = useState(null);
  const [channelHub, setChannelHub] = useState([]);
  const [avito, setAvito] = useState(null);
  const [avitoBusy, setAvitoBusy] = useState(false);
  const [avitoTokenPlain, setAvitoTokenPlain] = useState('');
  const [whatsapp, setWhatsapp] = useState(null);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [waForm, setWaForm] = useState({ greenIdInstance: '', greenApiToken: '', verifyToken: '' });
  const [waTokenPlain, setWaTokenPlain] = useState('');
  const [waVerifyPlain, setWaVerifyPlain] = useState('');

  async function load() {
    setError('');
    try {
      const [leadData, tgData, maxData, channelsData, avitoData, waData] = await Promise.all([
        isSupervisor ? api('/org/lead-intake') : Promise.resolve(null),
        isSupervisor ? api('/org/telegram') : Promise.resolve(null),
        isSupervisor ? api('/org/max') : Promise.resolve(null),
        isSupervisor ? api('/org/channels') : Promise.resolve({ channels: [] }),
        isSupervisor ? api('/org/avito') : Promise.resolve(null),
        isSupervisor ? api('/org/whatsapp') : Promise.resolve(null),
      ]);
      if (leadData) {
        setLeadIntake(leadData);
        setWebsiteOriginsText((leadData.websiteOrigins || []).join('\n'));
      }
      if (tgData) {
        setTelegram(tgData);
        setBotConfig(tgData.botConfig || null);
      }
      if (maxData) {
        setMaxBot(maxData);
        setMaxBotConfig(maxData.botConfig || null);
      }
      setChannelHub(channelsData.channels || []);
      if (avitoData) setAvito(avitoData);
      if (waData) {
        setWhatsapp(waData);
        setWaForm({
          greenIdInstance: waData.greenIdInstance || '',
          greenApiToken: '',
          verifyToken: '',
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [isSupervisor]);

  if (error) return <div className="error">{error}</div>;
  if (loading) return <Skeleton />;

  return (
    <OrgAdminShell title="Каналы" lead="Подключение источников заявок">
      {isSupervisor && channelHub.length > 0 && (
        <section className="org-admin-panel stack" style={{ marginBottom: '1rem' }}>
          <div>
            <h2>Каналы заявок</h2>
            <p className="muted">Статус подключений. Нажмите «Настроить», чтобы открыть блок ниже.</p>
          </div>
          <div className="stats-grid">
            {channelHub.map((ch) => (
              <div key={ch.id} className="stat-card" id={`hub-${ch.id}`}>
                <div className="muted">{ch.name}</div>
                <div style={{ marginTop: 4 }}>
                  {ch.connected ? (
                    <span className="badge channel">Подключён</span>
                  ) : (
                    <span className="badge muted">Не подключён</span>
                  )}
                </div>
                <div className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
                  {ch.detail}
                </div>
                <a
                  className="btn"
                  href={`#${ch.anchor}`}
                  style={{ marginTop: 10, display: 'inline-block' }}
                >
                  Настроить
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {isSupervisor && (
        <section className="org-admin-panel stack" id="channel-website">
          <div>
            <h2>Каналы заявок · Сайт</h2>
            <p className="muted">
              Подключите сайт автосалона: заявки будут попадать только в вашу организацию.
              Настройки доступны администратору и руководителю.
            </p>
          </div>

          {!leadIntake ? (
            <Skeleton />
          ) : (
            <>
              <div>
                <div className="muted">Ключ для формы (X-Lead-Token)</div>
                <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ wordBreak: 'break-all', flex: 1 }}>
                    {leadIntake.leadPublicToken
                      ? showLeadToken
                        ? leadIntake.leadPublicToken
                        : `••••${String(leadIntake.leadPublicToken).slice(-4)}`
                      : '— ключ ещё не создан —'}
                  </code>
                  {leadIntake.leadPublicToken && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setShowLeadToken((v) => !v)}
                      >
                        {showLeadToken ? 'Скрыть' : 'Показать'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(leadIntake.leadPublicToken);
                            toast.success('Ключ скопирован');
                          } catch {
                            toast.error('Не удалось скопировать');
                          }
                        }}
                      >
                        Копировать
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={leadBusy}
                    onClick={async () => {
                      if (
                        leadIntake.leadPublicToken &&
                        !window.confirm(
                          'Создать новый ключ? Старый код на сайте перестанет работать.'
                        )
                      ) {
                        return;
                      }
                      setLeadBusy(true);
                      try {
                        const data = await api('/org/lead-intake/token', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        });
                        setLeadIntake(data);
                        setWebsiteOriginsText((data.websiteOrigins || []).join('\n'));
                        toast.success(data.message || 'Ключ создан');
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setLeadBusy(false);
                      }
                    }}
                  >
                    {leadIntake.leadPublicToken ? 'Обновить ключ' : 'Создать ключ'}
                  </button>
                </div>
              </div>

              <form
                className="stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLeadBusy(true);
                  try {
                    const data = await api('/org/lead-intake', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        websiteOrigins: websiteOriginsText
                          .split(/[\n,]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      }),
                    });
                    setLeadIntake(data);
                    setWebsiteOriginsText((data.websiteOrigins || []).join('\n'));
                    toast.success(data.message || 'Сохранено');
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setLeadBusy(false);
                  }
                }}
              >
                <label>
                  Домены сайта автосалона
                  <span className="muted" style={{ display: 'block', fontWeight: 400 }}>
                    По одному на строку, например https://мой-салон.ru — нужно, чтобы форма с
                    сайта могла отправлять заявки
                  </span>
                  <textarea
                    rows={3}
                    value={websiteOriginsText}
                    onChange={(e) => setWebsiteOriginsText(e.target.value)}
                    placeholder={'https://example-auto.ru\nhttps://www.example-auto.ru'}
                  />
                </label>
                <button className="btn primary" type="submit" disabled={leadBusy}>
                  Сохранить домены
                </button>
              </form>

              {leadIntake.formSnippet && (
                <div>
                  <div className="muted">Код для вставки на сайт</div>
                  <textarea
                    readOnly
                    rows={12}
                    value={leadIntake.formSnippet}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: '0.5rem' }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(leadIntake.formSnippet);
                        toast.success('Код формы скопирован');
                      } catch {
                        toast.error('Не удалось скопировать');
                      }
                    }}
                  >
                    Копировать код формы
                  </button>
                  <p className="muted" style={{ marginTop: '0.5rem' }}>
                    Вставьте код в HTML-блок на сайте (Tilda / WordPress / свой сайт). Затем
                    отправьте тестовую заявку и проверьте Рабочий стол.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {isSupervisor && (
        <section className="org-admin-panel stack" id="channel-telegram">
          <div>
            <h2>Каналы заявок · Telegram</h2>
            <p className="muted">
              Один бот на салон: клиенты пишут заявки, а руководителю и менеджерам тот же бот
              шлёт уведомления о новых лидах (после Chat ID в профиле и «Старт»).
            </p>
          </div>

          {!telegram ? (
            <Skeleton />
          ) : (
            <>
              <ol className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                <li>
                  Откройте Telegram →{' '}
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                    @BotFather
                  </a>
                </li>
                <li>Команда /newbot — создайте бота и скопируйте токен</li>
                <li>Вставьте токен ниже и нажмите «Подключить»</li>
                <li>Напишите боту в личку (лучше с номером телефона в тексте)</li>
                <li>
                  Себе и менеджерам: профиль → Chat ID → «Старт» у этого бота → «Тест в Telegram»
                </li>
              </ol>

              <div>
                <div className="muted">Статус</div>
                {telegram.connected ? (
                  <div>
                    <span className="badge channel channel-telegram">Подключён</span>
                    {telegram.botUsername ? (
                      <>
                        {' '}
                        <a href={telegram.botLink} target="_blank" rel="noreferrer">
                          @{telegram.botUsername}
                        </a>
                      </>
                    ) : null}
                    {telegram.botTokenMasked ? (
                      <div className="muted" style={{ marginTop: 4 }}>
                        Токен: {telegram.botTokenMasked}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="badge muted">Не подключён</span>
                )}
              </div>

              <label>
                Токен бота
                <input
                  type="password"
                  autoComplete="off"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                />
              </label>

              <div className="row gap" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={telegramBusy || !telegramToken.trim()}
                  onClick={async () => {
                    setTelegramBusy(true);
                    try {
                      const data = await api('/org/telegram/connect', {
                        method: 'POST',
                        body: JSON.stringify({ botToken: telegramToken.trim() }),
                      });
                      setTelegram(data);
                      setBotConfig(data.botConfig || null);
                      setTelegramToken('');
                      if (data.manualWebhookRequired && data.setWebhookPhoneUrl) {
                        toast.success('Нужна ссылка setWebhook на телефоне');
                      } else {
                        toast.success(data.message || 'Telegram подключён');
                      }
                      api('/org/channels')
                        .then((c) => setChannelHub(c.channels || []))
                        .catch(() => {});
                    } catch (err) {
                      toast.error(err.message);
                    } finally {
                      setTelegramBusy(false);
                    }
                  }}
                >
                  {telegram.connected ? 'Переподключить' : 'Подключить'}
                </button>
                {telegram.connected && (
                  <button
                    type="button"
                    className="btn"
                    disabled={telegramBusy}
                    onClick={async () => {
                      if (!window.confirm('Отключить Telegram-бота от CRM?')) return;
                      setTelegramBusy(true);
                      try {
                        const data = await api('/org/telegram/disconnect', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        });
                        setTelegram(data);
                        toast.success(data.message || 'Отключено');
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setTelegramBusy(false);
                      }
                    }}
                  >
                    Отключить
                  </button>
                )}
                {telegram.botLink && (
                  <a className="btn" href={telegram.botLink} target="_blank" rel="noreferrer">
                    Открыть бота
                  </a>
                )}
              </div>

              {telegram.connected && (
                <p className="muted">
                  Webhook CRM: <code style={{ wordBreak: 'break-all' }}>{telegram.webhookUrl}</code>
                  {telegram.workerHint ? (
                    <>
                      <br />
                      {telegram.workerHint}
                    </>
                  ) : null}
                </p>
              )}

              {telegram.manualWebhookRequired && (
                <div className="stack">
                  <div className="muted">
                    Автоподключение не сработало. Откройте ссылку на <b>телефоне</b> (мобильный
                    интернет или VPN) — секрет уже внутри, вручную ничего чистить не нужно:
                  </div>
                  {telegram.setWebhookPhoneUrl && (
                    <a
                      className="btn primary"
                      href={telegram.setWebhookPhoneUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть setWebhook на телефоне
                    </a>
                  )}
                  {telegram.setWebhookCurl && (
                    <details>
                      <summary className="muted">Команда для ПК (если телефон не открывает)</summary>
                      <textarea
                        readOnly
                        rows={3}
                        value={telegram.setWebhookCurl}
                        style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', width: '100%' }}
                      />
                    </details>
                  )}
                </div>
              )}
              {telegram.connected && botConfig && (
                <div className="stack" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                  <h3 style={{ margin: 0 }}>Сценарий бота</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    Клиент пишет боту → бот задаёт ваши вопросы → в CRM приходит готовый лид.
                    Ответы бота уходят через Cloudflare Worker (если настроен).
                  </p>

                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(botConfig.enabled)}
                      onChange={(e) => setBotConfig({ ...botConfig, enabled: e.target.checked })}
                    />
                    Включить опрос перед созданием лида
                  </label>

                  <label>
                    Приветствие
                    <textarea
                      rows={2}
                      value={botConfig.welcome || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, welcome: e.target.value })}
                    />
                  </label>

                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(botConfig.askPhone)}
                      onChange={(e) => setBotConfig({ ...botConfig, askPhone: e.target.checked })}
                    />
                    Спрашивать телефон
                  </label>

                  {botConfig.askPhone && (
                    <label>
                      Текст запроса телефона
                      <textarea
                        rows={2}
                        value={botConfig.phonePrompt || ''}
                        onChange={(e) => setBotConfig({ ...botConfig, phonePrompt: e.target.value })}
                      />
                    </label>
                  )}

                  <div>
                    <div className="muted">Вопросы (до 5)</div>
                    {(botConfig.questions || []).map((q, idx) => (
                      <div
                        key={q.id || idx}
                        className="stack"
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.75rem',
                          background: 'var(--bg)',
                          borderRadius: 'var(--radius)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <label>
                          Вопрос {idx + 1}
                          <input
                            value={q.text || ''}
                            onChange={(e) => {
                              const questions = [...botConfig.questions];
                              questions[idx] = { ...questions[idx], text: e.target.value };
                              setBotConfig({ ...botConfig, questions });
                            }}
                          />
                        </label>
                        <label>
                          Варианты кнопок (через запятую, можно пусто)
                          <input
                            value={(q.options || []).join(', ')}
                            onChange={(e) => {
                              const questions = [...botConfig.questions];
                              questions[idx] = {
                                ...questions[idx],
                                options: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              };
                              setBotConfig({ ...botConfig, questions });
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            const questions = botConfig.questions.filter((_, i) => i !== idx);
                            setBotConfig({ ...botConfig, questions });
                          }}
                        >
                          Удалить вопрос
                        </button>
                      </div>
                    ))}
                    {(botConfig.questions || []).length < 5 && (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginTop: '0.5rem' }}
                        onClick={() =>
                          setBotConfig({
                            ...botConfig,
                            questions: [
                              ...(botConfig.questions || []),
                              { id: `q${Date.now()}`, text: 'Новый вопрос', options: [] },
                            ],
                          })
                        }
                      >
                        + Добавить вопрос
                      </button>
                    )}
                  </div>

                  <label>
                    Сообщение после заявки
                    <textarea
                      rows={2}
                      value={botConfig.doneMessage || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, doneMessage: e.target.value })}
                    />
                  </label>

                  <div className="row gap" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={telegramBusy}
                      onClick={async () => {
                        setTelegramBusy(true);
                        try {
                          const data = await api('/org/telegram/bot-config', {
                            method: 'PATCH',
                            body: JSON.stringify({ botConfig }),
                          });
                          setTelegram(data);
                          setBotConfig(data.botConfig);
                          toast.success(data.message || 'Сценарий сохранён');
                        } catch (err) {
                          toast.error(err.message);
                        } finally {
                          setTelegramBusy(false);
                        }
                      }}
                    >
                      Сохранить сценарий
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={telegramBusy}
                      onClick={async () => {
                        setTelegramBusy(true);
                        try {
                          const data = await api('/org/telegram/bot-config/reset', {
                            method: 'POST',
                            body: JSON.stringify({}),
                          });
                          setTelegram(data);
                          setBotConfig(data.botConfig);
                          toast.success(data.message || 'Сброшено');
                        } catch (err) {
                          toast.error(err.message);
                        } finally {
                          setTelegramBusy(false);
                        }
                      }}
                    >
                      Сбросить к шаблону
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {isSupervisor && (
        <section className="org-admin-panel stack" id="channel-max">
          <div>
            <h2>Каналы заявок · MAX</h2>
            <p className="muted">
              Бот мессенджера MAX работает как Telegram: клиент пишет боту, проходит опрос, заявка
              попадает в вашу организацию. Нужен HTTPS (уже есть на nova-crm.online).
            </p>
          </div>

          {!maxBot ? (
            <Skeleton />
          ) : (
            <>
              <ol className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                <li>
                  Откройте{' '}
                  <a href="https://dev.max.ru" target="_blank" rel="noreferrer">
                    платформу MAX
                  </a>{' '}
                  → Чат-боты
                </li>
                <li>Создайте бота (или «MAX для бизнеса») и скопируйте токен</li>
                <li>Вставьте токен ниже и нажмите «Подключить»</li>
                <li>Напишите боту в MAX</li>
              </ol>

              <div>
                <div className="muted">Статус</div>
                {maxBot.connected ? (
                  <div>
                    <span className="badge channel">Подключён</span>
                    {maxBot.botUsername ? <> @{maxBot.botUsername}</> : null}
                    {maxBot.botLink ? (
                      <div style={{ marginTop: 4 }}>
                        <a href={maxBot.botLink} target="_blank" rel="noreferrer">
                          Открыть бота в MAX
                        </a>
                      </div>
                    ) : null}
                    {maxBot.botTokenMasked ? (
                      <div className="muted" style={{ marginTop: 4 }}>
                        Токен: {maxBot.botTokenMasked}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="badge muted">Не подключён</span>
                )}
              </div>

              <label>
                Токен бота MAX
                <input
                  type="password"
                  autoComplete="off"
                  value={maxToken}
                  onChange={(e) => setMaxToken(e.target.value)}
                  placeholder="Токен из настроек чат-бота"
                />
              </label>

              <div className="row gap" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={maxBusy || !maxToken.trim()}
                  onClick={async () => {
                    setMaxBusy(true);
                    try {
                      const data = await api('/org/max/connect', {
                        method: 'POST',
                        body: JSON.stringify({ botToken: maxToken.trim() }),
                      });
                      setMaxBot(data);
                      setMaxBotConfig(data.botConfig || null);
                      setMaxToken('');
                      toast.success(data.message || 'MAX подключён');
                      api('/org/channels')
                        .then((c) => setChannelHub(c.channels || []))
                        .catch(() => {});
                    } catch (err) {
                      toast.error(err.message);
                    } finally {
                      setMaxBusy(false);
                    }
                  }}
                >
                  {maxBot.connected ? 'Переподключить' : 'Подключить'}
                </button>
                {maxBot.connected && (
                  <button
                    type="button"
                    className="btn"
                    disabled={maxBusy}
                    onClick={async () => {
                      if (!window.confirm('Отключить бота MAX от CRM?')) return;
                      setMaxBusy(true);
                      try {
                        const data = await api('/org/max/disconnect', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        });
                        setMaxBot(data);
                        toast.success(data.message || 'Отключено');
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setMaxBusy(false);
                      }
                    }}
                  >
                    Отключить
                  </button>
                )}
              </div>

              {maxBot.connected && (
                <p className="muted">
                  Webhook: <code style={{ wordBreak: 'break-all' }}>{maxBot.webhookUrl}</code>
                </p>
              )}

              {maxBot.connected && maxBotConfig && (
                <div
                  className="stack"
                  style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}
                >
                  <h3 style={{ margin: 0 }}>Сценарий бота MAX</h3>
                  <label>
                    Приветствие
                    <textarea
                      rows={2}
                      value={maxBotConfig.welcome || ''}
                      onChange={(e) => setMaxBotConfig({ ...maxBotConfig, welcome: e.target.value })}
                    />
                  </label>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(maxBotConfig.askPhone)}
                      onChange={(e) =>
                        setMaxBotConfig({ ...maxBotConfig, askPhone: e.target.checked })
                      }
                    />
                    Спрашивать телефон
                  </label>
                  <label>
                    Сообщение после заявки
                    <textarea
                      rows={2}
                      value={maxBotConfig.doneMessage || ''}
                      onChange={(e) =>
                        setMaxBotConfig({ ...maxBotConfig, doneMessage: e.target.value })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={maxBusy}
                    onClick={async () => {
                      setMaxBusy(true);
                      try {
                        const data = await api('/org/max/bot-config', {
                          method: 'PATCH',
                          body: JSON.stringify({ botConfig: maxBotConfig }),
                        });
                        setMaxBot(data);
                        setMaxBotConfig(data.botConfig);
                        toast.success(data.message || 'Сценарий сохранён');
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setMaxBusy(false);
                      }
                    }}
                  >
                    Сохранить сценарий MAX
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {isSupervisor && (
        <section className="org-admin-panel stack" id="channel-avito">
          <div>
            <h2>Каналы заявок · Авито</h2>
            <p className="muted">
              Webhook для Zapier / Make / посредника Авито. Лиды попадут в вашу организацию.
            </p>
          </div>
          {avito?.connected ? (
            <>
              <p>
                <span className="badge channel">Подключён</span>
                {avito.connectedAt ? (
                  <span className="muted"> · с {formatDate(avito.connectedAt)}</span>
                ) : null}
              </p>
              <label>
                Webhook URL
                <input readOnly value={avito.webhookUrl || ''} onFocus={(e) => e.target.select()} />
              </label>
              <label>
                Заголовок {avito.headerName || 'X-Avito-Token'}
                <input
                  readOnly
                  value={avitoTokenPlain || avito.tokenMasked || ''}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              {avitoTokenPlain && (
                <p className="muted">Скопируйте токен сейчас — полный ключ показывается один раз.</p>
              )}
              <button
                type="button"
                className="btn"
                disabled={avitoBusy}
                onClick={async () => {
                  setAvitoBusy(true);
                  try {
                    await api('/org/avito/disconnect', { method: 'POST', body: '{}' });
                    setAvito({ connected: false });
                    setAvitoTokenPlain('');
                    toast.success('Авито отключён');
                    api('/org/channels')
                      .then((c) => setChannelHub(c.channels || []))
                      .catch(() => {});
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setAvitoBusy(false);
                  }
                }}
              >
                Отключить
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={avitoBusy}
              onClick={async () => {
                setAvitoBusy(true);
                try {
                  const data = await api('/org/avito/connect', { method: 'POST', body: '{}' });
                  setAvito(data);
                  setAvitoTokenPlain(data.token || '');
                  toast.success(data.message || 'Токен создан');
                  api('/org/channels')
                    .then((c) => setChannelHub(c.channels || []))
                    .catch(() => {});
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setAvitoBusy(false);
                }
              }}
            >
              Создать токен Авито
            </button>
          )}
        </section>
      )}

      {isSupervisor && (
        <section className="org-admin-panel stack" id="channel-whatsapp" style={{ marginTop: '1rem' }}>
          <div>
            <h2>Каналы заявок · WhatsApp</h2>
            <p className="muted">
              Входящие через Green-API или Meta Cloud. Укажите webhook URL и токен в кабинете провайдера.
            </p>
          </div>
          {whatsapp?.connected ? (
            <>
              <p>
                <span className="badge channel">Подключён</span>
                {whatsapp.connectedAt ? (
                  <span className="muted"> · с {formatDate(whatsapp.connectedAt)}</span>
                ) : null}
              </p>
              <label>
                Webhook URL
                <input readOnly value={whatsapp.webhookUrl || ''} onFocus={(e) => e.target.select()} />
              </label>
              <label>
                {whatsapp.headerName || 'X-WhatsApp-Token'}
                <input
                  readOnly
                  value={waTokenPlain || whatsapp.tokenMasked || ''}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <label>
                Verify token (Meta)
                <input
                  readOnly
                  value={waVerifyPlain || whatsapp.verifyTokenMasked || ''}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              {whatsapp.greenIdInstance ? (
                <p className="muted">Green-API instance: {whatsapp.greenIdInstance}</p>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={whatsappBusy}
                onClick={async () => {
                  setWhatsappBusy(true);
                  try {
                    await api('/org/whatsapp/disconnect', { method: 'POST', body: '{}' });
                    setWhatsapp({ connected: false });
                    setWaTokenPlain('');
                    setWaVerifyPlain('');
                    toast.success('WhatsApp отключён');
                    api('/org/channels')
                      .then((c) => setChannelHub(c.channels || []))
                      .catch(() => {});
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setWhatsappBusy(false);
                  }
                }}
              >
                Отключить
              </button>
            </>
          ) : (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setWhatsappBusy(true);
                try {
                  const data = await api('/org/whatsapp/connect', {
                    method: 'POST',
                    body: JSON.stringify({
                      greenIdInstance: waForm.greenIdInstance || null,
                      greenApiToken: waForm.greenApiToken || null,
                      verifyToken: waForm.verifyToken || null,
                    }),
                  });
                  setWhatsapp(data);
                  setWaTokenPlain(data.token || '');
                  setWaVerifyPlain(data.verifyToken || '');
                  toast.success(data.message || 'WhatsApp подключён');
                  api('/org/channels')
                    .then((c) => setChannelHub(c.channels || []))
                    .catch(() => {});
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setWhatsappBusy(false);
                }
              }}
            >
              <label>
                Green-API idInstance (опц.)
                <input
                  value={waForm.greenIdInstance}
                  onChange={(e) => setWaForm({ ...waForm, greenIdInstance: e.target.value })}
                  placeholder="1101…"
                />
              </label>
              <label>
                Green-API apiToken (опц.)
                <input
                  type="password"
                  value={waForm.greenApiToken}
                  onChange={(e) => setWaForm({ ...waForm, greenApiToken: e.target.value })}
                />
              </label>
              <label>
                Meta verify token (опц., сгенерируем сами)
                <input
                  value={waForm.verifyToken}
                  onChange={(e) => setWaForm({ ...waForm, verifyToken: e.target.value })}
                />
              </label>
              <button className="btn primary" type="submit" disabled={whatsappBusy}>
                Подключить WhatsApp
              </button>
            </form>
          )}
        </section>
      )}

      {!isSupervisor && (
        <p className="muted">
          Настройка каналов доступна руководителю. Перейдите в{' '}
          <Link to="/inbox">Рабочий стол</Link>.
        </p>
      )}
    </OrgAdminShell>
  );
}
