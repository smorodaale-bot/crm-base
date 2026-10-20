import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, setToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AuthShell } from '../components/AuthShell.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useDocumentMeta } from '../hooks/useDocumentMeta.js';
import { reachGoal } from '../metrika.js';

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function registrationSteps(emailOtp) {
  const total = emailOtp ? 4 : 3;
  const steps = [
    { id: 1, label: 'Аккаунт', title: 'Создание салона', sub: `Шаг 1 из ${total} — аккаунт владельца` },
    { id: 2, label: 'Салон', title: 'Ваш салон', sub: `Шаг 2 из ${total} — данные автосалона` },
    { id: 3, label: 'Тариф', title: 'Выбор тарифа', sub: `Шаг 3 из ${total} — подписка Nova` },
  ];
  if (emailOtp) {
    steps.push({ id: 4, label: 'Код', title: 'Подтверждение email', sub: 'Шаг 4 из 4 — код из письма' });
  }
  return steps;
}

const CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Краснодар', 'Нижний Новгород'];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .split('')
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export default function RegisterOrgPage() {
  const { user, setUser } = useAuth();
  useDocumentMeta({
    title: 'Регистрация салона — Nova CRM',
    description: 'Создайте организацию в Nova CRM и начните пробный период.',
    robots: 'noindex, nofollow',
    canonical: 'https://nova-crm.online/',
  });
  const [step, setStep] = useState(1);
  const [slugManual, setSlugManual] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
    agree: false,
    organizationName: '',
    organizationSlug: '',
    city: '',
    ownerRole: 'owner',
    plan: 'START',
  });
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState(true);
  const [plans, setPlans] = useState([]);
  const [trialNote, setTrialNote] = useState('14 дней бесплатно на любом тарифе');
  const [interval, setInterval] = useState('month');

  useEffect(() => {
    api('/auth/config')
      .then((data) => setEmailOtp(data.emailOtp !== false))
      .catch(() => setEmailOtp(true));
    api('/org/plans')
      .then((data) => {
        setPlans(data.plans || []);
        if (data.trialNote) setTrialNote(data.trialNote);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!emailOtp && step > 3) setStep(3);
  }, [emailOtp, step]);

  if (user) return <Navigate to="/org" replace />;

  const steps = registrationSteps(emailOtp);
  const meta = steps[step - 1] || steps[0];

  function setField(field, value) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
    setError('');
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'organizationName' && !slugManual) next.organizationSlug = slugify(value);
      return next;
    });
  }

  function validate(current) {
    const next = {};
    if (current === 1) {
      if (!form.name.trim()) next.name = 'Укажите имя';
      if (!form.email.includes('@')) next.email = 'Укажите email';
      if (form.password.length < 8) next.password = 'Пароль должен быть не короче 8 символов';
      if (!form.agree) next.agree = 'Нужно согласие с офертой и политикой ПДн';
    }
    if (current === 2) {
      if (form.organizationName.trim().length < 2) next.organizationName = 'Укажите название организации';
      if (!/^[a-z0-9-]{2,60}$/.test(form.organizationSlug)) next.organizationSlug = 'Slug: латиница, цифры и дефис';
    }
    return next;
  }

  async function sendCode() {
    const data = await api('/auth/register/start', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim(),
        password: form.password,
        organizationName: form.organizationName.trim(),
        organizationSlug: form.organizationSlug,
        city: form.city.trim() || null,
        plan: form.plan,
        ownerRole: form.ownerRole,
      }),
    });
    setHint(data.devCode ? `Код для разработки: ${data.devCode}` : '');
    if (data.devCode) setCode(String(data.devCode).slice(0, 6).split(''));
  }

  async function goNext(next) {
    const problems = validate(step);
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      return;
    }
    setFieldErrors({});
    setError('');
    if (step === 1) {
      setLoading(true);
      try {
        await api('/auth/check-email', {
          method: 'POST',
          body: JSON.stringify({ email: form.email.trim() }),
        });
      } catch (err) {
        setFieldErrors({ email: err.message || 'Email уже зарегистрирован' });
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    if (next === 4) {
      setLoading(true);
      try {
        await sendCode();
        setStep(4);
      } catch (err) {
        setError(err.data?.hint || err.message || 'Не удалось отправить код');
        if (err.data?.suggestedSlug) setField('organizationSlug', err.data.suggestedSlug);
      } finally {
        setLoading(false);
      }
      return;
    }
    setStep(next);
  }

  function onCodeChange(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < 5) {
      document.getElementById(`reg-code-${index + 1}`)?.focus();
    }
  }

  async function createSalon() {
    setError('');
    setLoading(true);
    try {
      const data = await api('/auth/register/start', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim(),
          password: form.password,
          organizationName: form.organizationName.trim(),
          organizationSlug: form.organizationSlug,
          city: form.city.trim() || null,
          plan: form.plan,
          ownerRole: form.ownerRole,
        }),
      });
      if (!(data.accessToken || data.token)) {
        setError('Не удалось создать салон');
        return;
      }
      setToken(data.accessToken || data.token);
      if (setUser) setUser(data.user);
      reachGoal('register');
      window.location.assign('/org');
    } catch (err) {
      setError(err.data?.hint || err.message || 'Не удалось создать салон');
      if (err.data?.suggestedSlug) setField('organizationSlug', err.data.suggestedSlug);
    } finally {
      setLoading(false);
    }
  }

  async function finish(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/auth/register/confirm', {
        method: 'POST',
        body: JSON.stringify({ email: form.email.trim(), code: code.join('') }),
      });
      setToken(data.accessToken || data.token);
      if (setUser) setUser(data.user);
      reachGoal('register');
      window.location.assign('/org');
    } catch (err) {
      setError(err.message || 'Неверный код');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell mode="register" title={meta.title} subtitle={meta.sub}>
          <div className="auth-steps" aria-label="Шаги регистрации">
            {steps.map((item) => (
          <div key={item.id} className={`auth-step ${item.id === step ? 'is-active' : ''} ${item.id < step ? 'is-done' : ''}`}>
            <span className="auth-step-dot">{item.id}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <form className="auth-form auth-form-register" onSubmit={step === 4 ? finish : (e) => e.preventDefault()}>
        {step === 1 && (
          <>
            <div className="auth-field-row">
              <label className="auth-field">
                <span className="auth-field-label">Имя</span>
                <input className="auth-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Алексей" autoComplete="name" />
                <span className="auth-field-error">{fieldErrors.name || ''}</span>
              </label>
              <label className="auth-field">
                <span className="auth-field-label">Телефон</span>
                <input className="auth-input" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+7 (999) 000-00-00" autoComplete="tel" />
              </label>
            </div>
            <label className="auth-field">
              <span className="auth-field-label">Email</span>
              <input className="auth-input" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="you@company.ru" autoComplete="email" />
              <span className="auth-field-error">{fieldErrors.email || ''}</span>
            </label>
            <PasswordField label="Пароль" value={form.password} onChange={(v) => setField('password', v)} autoComplete="new-password" placeholder="минимум 8 символов" minLength={8} required={false} error={fieldErrors.password || ''} />
            <p className="auth-hint">Минимум 8 символов, лучше с цифрой и буквой</p>
            <label className="auth-check">
              <input type="checkbox" checked={form.agree} onChange={(e) => setField('agree', e.target.checked)} />
              <span>
                Согласен с <Link to="/offer">офертой</Link> и <Link to="/privacy">политикой ПДн</Link>
              </span>
            </label>
            <span className="auth-field-error">{fieldErrors.agree || ''}</span>
            <button className="btn primary auth-submit" type="button" onClick={() => goNext(2)}>Продолжить</button>
          </>
        )}
        {step === 2 && (
          <>
            <label className="auth-field">
              <span className="auth-field-label">Название организации</span>
              <input className="auth-input" value={form.organizationName} onChange={(e) => setField('organizationName', e.target.value)} placeholder="Автосалон Север" />
              <span className="auth-field-error">{fieldErrors.organizationName || ''}</span>
            </label>
            <label className="auth-field">
              <span className="auth-field-label">URL-slug</span>
              <input
                className="auth-input"
                value={form.organizationSlug}
                onChange={(e) => {
                  setSlugManual(true);
                  setField('organizationSlug', slugify(e.target.value));
                }}
                placeholder="avtosalon-sever"
              />
              <span className="auth-field-error">{fieldErrors.organizationSlug || ''}</span>
            </label>
            <p className="auth-hint">Будет частью адреса кабинета</p>
            <label className="auth-field">
              <span className="auth-field-label">Город</span>
              <input className="auth-input" value={form.city} onChange={(e) => setField('city', e.target.value)} placeholder="Москва" list="auth-cities" />
              <datalist id="auth-cities">
                {CITIES.map((city) => <option key={city} value={city} />)}
              </datalist>
            </label>
            <label className="auth-field">
              <span className="auth-field-label">Ваша роль</span>
              <select className="auth-input" value={form.ownerRole} onChange={(e) => setField('ownerRole', e.target.value)}>
                <option value="owner">Владелец</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
            <div className="auth-btn-row">
              <button className="btn auth-submit" type="button" onClick={() => setStep(1)}>Назад</button>
              <button className="btn primary auth-submit" type="button" onClick={() => goNext(3)}>Продолжить</button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <div className="bill-interval" role="group" aria-label="Период оплаты">
              <button type="button" className={interval === 'month' ? 'is-on' : ''} onClick={() => setInterval('month')}>
                Месяц
              </button>
              <button type="button" className={interval === 'year' ? 'is-on' : ''} onClick={() => setInterval('year')}>
                Год −20%
              </button>
            </div>
            <div className="auth-tariffs" role="radiogroup" aria-label="Выбор тарифа">
              {plans.map((plan) => {
                const perMonth = interval === 'year' ? plan.priceYearPerMonthRub : plan.priceRub;
                const yearTotal = (plan.priceYearPerMonthRub || 0) * 12;
                return (
                <button
                  key={plan.id}
                  type="button"
                  role="radio"
                  aria-checked={form.plan === plan.id}
                  className={`auth-tariff ${form.plan === plan.id ? 'is-selected' : ''}`}
                  onClick={() => setField('plan', plan.id)}
                >
                  {plan.popular ? <span className="auth-tariff-badge">Популярный</span> : null}
                  <span className="auth-tariff-top">
                    <strong>{plan.name}</strong>
                    <span>
                      {new Intl.NumberFormat('ru-RU').format(perMonth)} <small>₽/мес</small>
                    </span>
                  </span>
                  {interval === 'year' ? (
                    <span className="auth-hint">К оплате {new Intl.NumberFormat('ru-RU').format(yearTotal)} ₽ за год</span>
                  ) : null}
                  <span className="auth-hint">{plan.description}</span>
                  <span className="auth-tariff-feats">{(plan.points || []).join(' · ')}</span>
                </button>
                );
              })}
            </div>
            <p className="auth-hint">{trialNote}</p>
            <div className="auth-btn-row">
              <button className="btn auth-submit" type="button" onClick={() => setStep(2)}>Назад</button>
              <button
                className="btn primary auth-submit"
                type="button"
                disabled={loading}
                onClick={() => (emailOtp ? goNext(4) : createSalon())}
              >
                {loading ? 'Отправка...' : emailOtp ? 'Продолжить' : 'Создать салон'}
              </button>
            </div>
          </>
        )}
        {emailOtp && step === 4 && (
          <>
            <p className="auth-verify-email">{form.email}</p>
            <p className="auth-hint">Мы отправили код подтверждения на ваш email. Введите его ниже, чтобы активировать салон.</p>
            <div className="auth-code-row">
              {code.map((digit, index) => (
                <input
                  key={index}
                  id={`reg-code-${index}`}
                  className="auth-input auth-code"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={`Цифра ${index + 1}`}
                  onChange={(e) => onCodeChange(index, e.target.value)}
                />
              ))}
            </div>
            <p className="auth-switch">
              Не пришло?{' '}
              <button type="button" className="auth-text-btn" disabled={loading} onClick={() => sendCode().catch((err) => setError(err.message))}>
                Отправить ещё раз
              </button>
            </p>
            {hint ? <p className="auth-hint">{hint}</p> : null}
            <div className="auth-btn-row">
              <button className="btn auth-submit" type="button" onClick={() => setStep(3)}>Назад</button>
              <button className="btn primary auth-submit" type="submit" disabled={loading}>
                {loading ? 'Проверка...' : 'Подтвердить'}
              </button>
            </div>
          </>
        )}
        {error ? <div className="error">{error}</div> : null}
      </form>
      <p className="auth-switch">
        Уже есть аккаунт? <Link to="/login">Войти</Link>
      </p>
    </AuthShell>
  );
}
