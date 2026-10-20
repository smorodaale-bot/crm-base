import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LegalLayout } from '../components/LegalLayout.jsx';
import { COMPANY } from '../legal/company.js';

const FALLBACK_PLANS = [
  {
    id: 'START',
    name: 'Старт',
    priceRub: 1490,
    priceYearPerMonthRub: 1190,
    description: 'Авито и форма сайта, склад до 30 авто',
    points: ['До 2 пользователей', 'До 30 авто на складе', 'Заявки: Авито и форма сайта'],
  },
  {
    id: 'BASIC',
    name: 'Базовый',
    priceRub: 2990,
    priceYearPerMonthRub: 2390,
    description: 'Лиды, воронка и задачи для салона',
    points: ['До 5 пользователей', 'Без склада/1С'],
  },
  {
    id: 'ADVANCED',
    name: 'Продвинутый',
    priceRub: 6990,
    priceYearPerMonthRub: 5590,
    popular: true,
    description: 'QC, SpeechKit, склад/1С и полная аналитика',
    points: ['До 15 пользователей', 'Склад/1С'],
  },
  {
    id: 'ULTRA',
    name: 'Ultra',
    priceRub: 14990,
    priceYearPerMonthRub: 11990,
    description: 'Безлимит сотрудников, несколько салонов, приоритетная поддержка',
    points: ['Без ограничений', 'Приоритетная поддержка'],
  },
];

function formatRub(n) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function PricingPage() {
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [interval, setInterval] = useState('month');

  useEffect(() => {
    fetch('/api/org/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plans?.length) setPlans(data.plans);
      })
      .catch(() => {});
  }, []);

  return (
    <LegalLayout
      wide
      title="Тарифы"
      lead={`${COMPANY.productName} — облачная CRM для автосалонов: лиды, воронка, склад и контроль качества разговоров. Услуга в личном кабинете.`}
    >
      <div className="bill-interval" role="group" aria-label="Период оплаты">
        <button type="button" className={interval === 'month' ? 'is-on' : ''} onClick={() => setInterval('month')}>
          Месяц
        </button>
        <button type="button" className={interval === 'year' ? 'is-on' : ''} onClick={() => setInterval('year')}>
          Год −20%
        </button>
      </div>
      <div className="site-pricing-grid">
        {plans.map((p) => {
          const featured = Boolean(p.popular) || p.id === 'ADVANCED';
          const perMonth = interval === 'year' ? p.priceYearPerMonthRub : p.priceRub;
          const yearTotal = (p.priceYearPerMonthRub || 0) * 12;
          return (
            <article
              key={p.id}
              className={`site-plan${featured ? ' site-plan-featured' : ''}`}
            >
              {featured ? <span className="site-plan-badge">Популярный</span> : null}
              <h2 className="site-plan-name">{p.name}</h2>
              <div className="site-plan-price">
                {formatRub(perMonth)}
                <span>/мес</span>
              </div>
              {interval === 'year' ? <p className="site-plan-desc">К оплате {formatRub(yearTotal)} за год</p> : null}
              <p className="site-plan-desc">{p.description}</p>
              <ul className="site-plan-list">
                {(p.points || []).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Link className="btn primary" to="/register">
                Выбрать {p.name}
              </Link>
            </article>
          );
        })}
      </div>

      <h2 className="site-section-title">Как получить услугу после оплаты</h2>
      <div className="site-steps">
        <div className="site-step">
          <div className="site-step-num">1</div>
          <h3>Регистрация</h3>
          <p>Создайте организацию и учётную запись владельца на сайте.</p>
        </div>
        <div className="site-step">
          <div className="site-step-num">2</div>
          <h3>Оплата</h3>
          <p>Выберите тариф в разделе «Организация» и оплатите картой через ЮKassa.</p>
        </div>
        <div className="site-step">
          <div className="site-step-num">3</div>
          <h3>Доступ</h3>
          <p>
            После оплаты подписка активируется в кабинете. Физическая доставка не нужна — услуга цифровая.
          </p>
        </div>
      </div>

      <p className="site-note">
        14 дней бесплатно на любом тарифе. Год оплачивается сразу: цена месяца со скидкой 20%, умноженная на 12.
      </p>

      <div className="site-cta-row">
        <Link className="btn primary" to="/register">
          Зарегистрировать организацию
        </Link>
        <Link className="btn site-btn-ghost" to="/offer">
          Читать оферту
        </Link>
      </div>
    </LegalLayout>
  );
}
