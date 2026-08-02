import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';

const empty = {
  name: '',
  phone: '',
  email: '',
  source: '',
  sourceId: '',
  comment: '',
  responsibleManagerId: '',
};

export default function ClientFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { isSupervisor, user, canWrite } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [users, setUsers] = useState([]);
  const [sources, setSources] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canWrite) navigate('/clients');
    api('/sources').then((d) => setSources(d.sources)).catch(() => {});
    if (isSupervisor) api('/users').then((d) => setUsers(d.users)).catch(() => {});
    if (isEdit) {
      api(`/clients/${id}`)
        .then((d) => {
          setForm({
            name: d.client.name || '',
            phone: d.client.phone || '',
            email: d.client.email || '',
            source: d.client.source || '',
            sourceId: d.client.sourceId ? String(d.client.sourceId) : '',
            comment: d.client.comment || '',
            responsibleManagerId: d.client.responsibleManagerId
              ? String(d.client.responsibleManagerId)
              : '',
          });
        })
        .catch((err) => setError(err.message));
    } else if (!isSupervisor && user) {
      setForm((f) => ({ ...f, responsibleManagerId: String(user.id) }));
    }
  }, [id, isEdit, isSupervisor, user?.id, canWrite]);

  useEffect(() => {
    if (!form.phone && !form.email && !form.name) {
      setDuplicates([]);
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (form.phone) params.set('phone', form.phone);
      if (form.email) params.set('email', form.email);
      if (form.name) params.set('name', form.name);
      if (isEdit) params.set('excludeId', id);
      api(`/clients/duplicates?${params}`)
        .then((d) => setDuplicates(d.duplicates || []))
        .catch(() => setDuplicates([]));
    }, 300);
    return () => clearTimeout(t);
  }, [form.phone, form.email, form.name, isEdit, id]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const body = {
        name: form.name,
        phone: form.phone,
        email: form.email || null,
        source: form.source || null,
        sourceId: form.sourceId ? Number(form.sourceId) : null,
        comment: form.comment || null,
        responsibleManagerId: form.responsibleManagerId
          ? Number(form.responsibleManagerId)
          : null,
      };

      if (isEdit) {
        await api(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success('Клиент сохранён');
        navigate(`/clients/${id}`);
      } else {
        const data = await api('/clients', { method: 'POST', body: JSON.stringify(body) });
        toast.success('Клиент создан');
        navigate(`/clients/${data.client.id}`);
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/clients" className="muted">
            ← К клиентам
          </Link>
          <h1>{isEdit ? 'Редактирование клиента' : 'Новый клиент'}</h1>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {duplicates.length > 0 && (
        <div className="error">
          Возможные дубли:{' '}
          {duplicates.map((d) => (
            <Link key={d.id} to={`/clients/${d.id}`} style={{ marginRight: 8 }}>
              {d.name} ({d.phone})
            </Link>
          ))}
        </div>
      )}

      <form className="panel stack narrow" onSubmit={onSubmit}>
        <label>
          Имя
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Телефон
          <input
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+79001234567"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Источник
          <select
            value={form.sourceId}
            onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
          >
            <option value="">Не выбран</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Комментарий
          <textarea
            rows={4}
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />
        </label>
        {isSupervisor && (
          <label>
            Ответственный менеджер
            <select
              value={form.responsibleManagerId}
              onChange={(e) => setForm({ ...form, responsibleManagerId: e.target.value })}
            >
              <option value="">Не назначен</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn primary">{isEdit ? 'Сохранить' : 'Создать'}</button>
      </form>
    </div>
  );
}
