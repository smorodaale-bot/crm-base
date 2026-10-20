import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { COMPANY } from '../legal/company.js';
import { SupportEmailLink } from '../legal/SupportEmail.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';

function rub(n) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

function LandingHeroMock() {
  return (
    <div className="lp-hero-visual" aria-hidden="true">
      <div className="lp-mock">
        <div className="lp-mock-rail">
          <span className="lp-mock-dot" />
          <span className="lp-mock-line" />
          <span className="lp-mock-line short" />
          <span className="lp-mock-line" />
          <span className="lp-mock-line short" />
        </div>
        <div className="lp-mock-main">
          <div className="lp-mock-top">
            <span>Рабочий стол</span>
            <span className="lp-mock-pill">3 новых</span>
          </div>
          <div className="lp-mock-cols">
            <div className="lp-mock-col">
              <div className="lp-mock-col-h">Новый лид</div>
              <div className="lp-mock-card">
                <strong>Ирина · Telegram</strong>
                <span>Купить авто · до 1 млн</span>
              </div>
              <div className="lp-mock-card dim">
                <strong>Алексей · сайт</strong>
                <span>Trade-in</span>
              </div>
            </div>
            <div className="lp-mock-col accent">
              <div className="lp-mock-col-h">Чат</div>
              <div className="lp-mock-chat">
                <div className="lp-mock-bubble in">Нужен седан до миллиона</div>
                <div className="lp-mock-bubble out">Здравствуйте! Подберём варианты на сегодня</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { user, loading } = useAuth();
  const [plans, setPlans] = useState([]);
  const [interval, setInterval] = useState('month');

  useEffect(() => {
    fetch('/api/org/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plans?.length) setPlans(data.plans);
      })
      .catch(() => {});
  }, []);
  useDocumentMeta({
    title: 'Nova CRM — заявки автосалона не теряются',
    description:
      'Telegram, MAX и сайт → рабочий стол менеджера за минуты. CRM для автосалона: лиды, чат, воронка и визиты.',
    robots: 'index, follow',
    canonical: 'https://nova-crm.online/',
  });

  if (loading) return <div className="centered">Загрузка...</div>;
  if (user) return <Navigate to="/inbox" replace />;

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label={COMPANY.productName}>
            <img className="lp-wordmark" src="/wordmark.svg" alt={COMPANY.productName} />
          </Link>
          <nav className="lp-nav-links" aria-label="Разделы">
            <a href="#how">Как работает</a>
            <a href="#channels">Каналы</a>
            <a href="#director">Директору</a>
            <Link to="/pricing">Тарифы</Link>
            <Link to="/contacts">Контакты</Link>
          </nav>
          <div className="lp-nav-actions">
            <Link className="lp-btn ghost" to="/login">
              Войти
            </Link>
            <Link className="lp-btn solid" to="/register">
              Создать салон
            </Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy lp-reveal">
          <p className="lp-brand-mark">
            <img className="lp-wordmark" src="/wordmark.svg" alt="" />
          </p>
          <h1>Заявки автосалона не теряются</h1>
          <p className="lp-hero-lead">
            Telegram, MAX и сайт → рабочий стол менеджера за минуты. Ответ из CRM уходит клиенту в
            мессенджер.
          </p>
          <div className="lp-hero-cta">
            <Link className="lp-btn solid lg" to="/register">
              Создать салон
            </Link>
            <Link className="lp-btn ghost lg" to="/login">
              Войти
            </Link>
          </div>
        </div>
        <LandingHeroMock />
      </section>

      <section className="lp-section" id="how">
        <div className="lp-section-inner">
          <h2>От заявки до визита</h2>
          <p className="lp-section-lead">Один поток вместо разрозненных чатов и таблиц.</p>
          <ol className="lp-flow">
            <li>
              <strong>Лид</strong>
              <span>Клиент пишет боту или оставляет заявку на сайте</span>
            </li>
            <li>
              <strong>Входящие</strong>
              <span>Менеджер берёт в работу одним кликом</span>
            </li>
            <li>
              <strong>Чат</strong>
              <span>Переписка в сделке, ответ уходит в Telegram или MAX</span>
            </li>
            <li>
              <strong>Визит</strong>
              <span>Запись в салон прямо из карточки</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="channels">
        <div className="lp-section-inner">
          <h2>Каналы, которые подключаете сами</h2>
          <p className="lp-section-lead">
            Сайт, Telegram и MAX — в кабинете организации. Без отдельного IT-отдела.
          </p>
          <ul className="lp-channels">
            <li>Сайт — ключ формы и встраиваемый виджет</li>
            <li>Telegram — бот салона и сценарий квалификации</li>
            <li>MAX — тот же сценарий для аудитории мессенджера</li>
            <li>Авито и WhatsApp — входящие webhook в настройках</li>
          </ul>
        </div>
      </section>

      <section className="lp-section" id="director">
        <div className="lp-section-inner lp-director">
          <div>
            <h2>Контроль для директора</h2>
            <p className="lp-section-lead">
              Видно, кто не ответил, где просрочен контакт и сколько визитов сегодня — без обхода
              менеджеров.
            </p>
          </div>
          <ul className="lp-director-list">
            <li>Пульт: воронка, SLA, нагрузка менеджеров</li>
            <li>Рабочий стол: новые лиды и просрочки</li>
            <li>Изоляция салонов: данные только своей организации</li>
          </ul>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="pricing">
        <div className="lp-section-inner">
          <h2>Тарифы</h2>
          <p className="lp-section-lead">14 дней бесплатно на любом тарифе. Год — со скидкой 20%.</p>
          <div className="bill-interval" role="group" aria-label="Период оплаты">
            <button type="button" className={interval === 'month' ? 'is-on' : ''} onClick={() => setInterval('month')}>
              Месяц
            </button>
            <button type="button" className={interval === 'year' ? 'is-on' : ''} onClick={() => setInterval('year')}>
              Год −20%
            </button>
          </div>
          <div className="lp-plans">
            {plans.map((p) => {
              const perMonth = interval === 'year' ? p.priceYearPerMonthRub : p.priceRub;
              return (
              <article key={p.id} className={`lp-plan${p.popular ? ' is-featured' : ''}`}>
                <h3>{p.name}</h3>
                <p className="lp-plan-price">
                  {rub(perMonth)} ₽
                  <span>/ мес</span>
                </p>
                <p className="lp-plan-blurb">{(p.points || []).join(' · ') || p.description}</p>
                <Link className="lp-btn solid" to="/register">
                  Начать
                </Link>
              </article>
              );
            })}
          </div>
          <p className="lp-plans-more">
            Подробнее — на странице <Link to="/pricing">тарифов</Link>.
          </p>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-final-inner">
          <h2>Запустите салон в Nova CRM</h2>
          <p>Регистрация организации, пробный период и подключение каналов за вечер.</p>
          <div className="lp-hero-cta">
            <Link className="lp-btn solid lg" to="/register">
              Создать салон
            </Link>
            <Link className="lp-btn ghost lg" to="/contacts">
              Связаться
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-brand">
            <img className="lp-wordmark" src="/wordmark-dark.svg" alt={COMPANY.productName} />
            <span>{COMPANY.legalName}</span>
          </span>
          <nav>
            <SupportEmailLink />
            <Link to="/offer">Оферта</Link>
            <Link to="/privacy">ПДн</Link>
            <Link to="/contacts">Контакты</Link>
            <Link to="/login">Вход</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
