import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import DealChat from '../components/DealChat.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import { useHeavyLoad } from '../context/LoadingContext.jsx';

export default function DealChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/deals/${id}`)
      .then((d) => setDeal(d.deal))
      .catch((err) => {
        setError(err.message);
        if (err.status === 403 || err.status === 404) {
          setTimeout(() => navigate('/deals'), 1000);
        }
      });
  }, [id, navigate]);

  useHeavyLoad(!deal && !error);
  if (error) return <div className="error">{error}</div>;
  if (!deal) return <Skeleton />;

  return (
    <div className="deal-chat-page">
      <div className="page-header">
        <div>
          <Link to={`/deals/${id}`} className="muted">
            ← Сделка #{id}
          </Link>
          <h1>{deal.client?.name || deal.title}</h1>
          <p className="muted">{deal.client?.phone || deal.title}</p>
        </div>
      </div>
      <DealChat
        dealId={id}
        canWrite={canWrite}
        clientName={deal.client?.name || 'Клиент'}
        variant="full"
        showExpandLink={false}
      />
    </div>
  );
}
