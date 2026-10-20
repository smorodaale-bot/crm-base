import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { LegalLayout } from '../components/LegalLayout.jsx';

/** Landing after abandoned / canceled YooKassa checkout. */
export default function PaymentCancelPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (user) {
    return <Navigate to="/org/billing?payment=cancel" replace />;
  }

  return (
    <LegalLayout
      title="Оплата не завершена"
      lead="Платёж был отменён или прерван. Подписка не изменилась — можно войти и попробовать снова."
    >
      <div className="site-cta-row">
        <Link className="btn primary" to="/login">
          Войти и оплатить
        </Link>
        <Link className="btn site-btn-ghost" to="/pricing">
          Смотреть тарифы
        </Link>
        <button type="button" className="btn site-btn-ghost" onClick={() => navigate(-1)}>
          Назад
        </button>
      </div>
    </LegalLayout>
  );
}
