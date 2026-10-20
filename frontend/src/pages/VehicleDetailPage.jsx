import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { STAGE_LABELS, formatDate, formatMoney } from '../constants.js';
import { Skeleton } from '../components/Skeleton.jsx';
import { useHeavyLoad } from '../context/LoadingContext.jsx';

const KIND = { NEW: 'Новый', USED: 'Б/у' };
const STATUS = {
  IN_STOCK: 'На складе',
  RESERVED: 'Резерв',
  SOLD: 'Продан',
  IN_TRANSIT: 'В пути',
};

const LISTING = {
  NONE: 'Не на Avito',
  LISTED: 'Выложено',
  NEEDS_UNLIST: 'Снять с Avito',
  UNLISTED: 'Снято',
};

const emptyForm = {
  brand: '',
  model: '',
  year: '',
  vin: '',
  lotNumber: '',
  kind: 'USED',
  price: '',
  purchasePrice: '',
  prepCost: '0',
  mileageKm: '',
  color: '',
  description: '',
  equipment: '',
  photoUrlsText: '',
  avitoUrl: '',
  avitoItemId: '',
};

export default function VehicleDetailPage() {
  const { id } = useParams();
  const { canWrite, user, isSupervisor } = useAuth();
  const toast = useToast();
  const [vehicle, setVehicle] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deals, setDeals] = useState([]);
  const [reserveDealId, setReserveDealId] = useState('');
  const [reserveHours, setReserveHours] = useState('24');

  async function load() {
    setError('');
    try {
      const data = await api(`/vehicles/${id}`);
      const v = data.vehicle;
      setVehicle(v);
      setForm({
        brand: v.brand || '',
        model: v.model || '',
        year: v.year != null ? String(v.year) : '',
        vin: v.vin || '',
        lotNumber: v.lotNumber || '',
        kind: v.kind || 'USED',
        price: v.price != null ? String(v.price) : '',
        purchasePrice: v.purchasePrice != null ? String(v.purchasePrice) : '',
        prepCost: v.prepCost != null ? String(v.prepCost) : '0',
        mileageKm: v.mileageKm != null ? String(v.mileageKm) : '',
        color: v.color || '',
        description: v.description || '',
        equipment: v.equipment || '',
        photoUrlsText: (v.photoUrls || []).join('\n'),
        avitoUrl: v.avitoUrl || '',
        avitoItemId: v.avitoItemId || '',
      });
      setReserveDealId(v.reservedDealId ? String(v.reservedDealId) : '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    api('/deals?limit=50')
      .then((d) => setDeals((d.deals || []).filter((x) => x.stage !== 'LOST' && x.stage !== 'WON')))
      .catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await api(`/vehicles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          brand: form.brand,
          model: form.model,
          year: form.year ? Number(form.year) : null,
          vin: form.vin || null,
          lotNumber: form.lotNumber || null,
          kind: form.kind,
          price: Number(form.price),
          purchasePrice: form.purchasePrice !== '' ? Number(form.purchasePrice) : null,
          prepCost: form.prepCost !== '' ? Number(form.prepCost) : 0,
          mileageKm: form.mileageKm !== '' ? Number(form.mileageKm) : null,
          color: form.color || null,
          description: form.description || null,
          equipment: form.equipment || null,
          photoUrls: form.photoUrlsText
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          avitoUrl: form.avitoUrl || null,
          avitoItemId: form.avitoItemId || null,
        }),
      });
      setVehicle(data.vehicle);
      toast.success('Сохранено');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function reserve() {
    setBusy(true);
    try {
      const data = await api(`/vehicles/${id}/reserve`, {
        method: 'POST',
        body: JSON.stringify({
          dealId: reserveDealId ? Number(reserveDealId) : null,
          hours: Number(reserveHours) || 24,
        }),
      });
      setVehicle(data.vehicle);
      toast.success(data.message || 'Забронировано');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setBusy(true);
    try {
      const data = await api(`/vehicles/${id}/release`, { method: 'POST', body: '{}' });
      setVehicle(data.vehicle);
      toast.success(data.message || 'Бронь снята');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markSold() {
    if (!window.confirm('Отметить авто как проданное?')) return;
    setBusy(true);
    try {
      const data = await api(`/vehicles/${id}/sold`, {
        method: 'POST',
        body: JSON.stringify({
          dealId: reserveDealId ? Number(reserveDealId) : vehicle?.reservedDealId || null,
        }),
      });
      setVehicle(data.vehicle);
      toast.success(data.message || 'Продано');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markListed() {
    setBusy(true);
    try {
      const data = await api(`/vehicles/${id}/listing-listed`, {
        method: 'POST',
        body: JSON.stringify({
          avitoUrl: form.avitoUrl || null,
          avitoItemId: form.avitoItemId || null,
        }),
      });
      setVehicle(data.vehicle);
      setForm((f) => ({
        ...f,
        avitoUrl: data.vehicle.avitoUrl || '',
        avitoItemId: data.vehicle.avitoItemId || '',
      }));
      toast.success(data.message || 'Выложено');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markUnlisted() {
    setBusy(true);
    try {
      const data = await api(`/vehicles/${id}/listing-unlisted`, { method: 'POST', body: '{}' });
      setVehicle(data.vehicle);
      toast.success(data.message || 'Снято');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  useHeavyLoad(!vehicle && !error);
  if (error) return <div className="error">{error}</div>;
  if (!vehicle) return <Skeleton />;

  const canRelease =
    vehicle.status === 'RESERVED' &&
    (isSupervisor || vehicle.reservedById === user?.id);

  return (
    <div className="vehicle-detail">
      <div className="page-header">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <Link to="/vehicles">← Склад</Link>
          </p>
          <h1>
            {vehicle.brand} {vehicle.model}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </h1>
          <p className="muted">
            {STATUS[vehicle.status] || vehicle.status}
            {vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
            {vehicle.daysInStock != null ? ` · на складе ${vehicle.daysInStock} дн.` : ''}
          </p>
        </div>
        <div className="row gap" style={{ flexWrap: 'wrap' }}>
          <span className={`badge vehicle-status vehicle-status-${vehicle.status}`}>
            {STATUS[vehicle.status] || vehicle.status}
          </span>
          {vehicle.marginHint != null && (
            <span className="badge">Маржа ~ {formatMoney(vehicle.marginHint)}</span>
          )}
          {vehicle.listingStatus && vehicle.listingStatus !== 'NONE' && (
            <span className={`badge listing-status listing-status-${vehicle.listingStatus}`}>
              {LISTING[vehicle.listingStatus] || vehicle.listingStatus}
            </span>
          )}
        </div>
      </div>

      {(vehicle.photoUrls || []).length > 0 && (
        <div className="vehicle-photos">
          {vehicle.photoUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="vehicle-photo">
              <img src={url} alt="" />
            </a>
          ))}
        </div>
      )}

      <div className="vehicle-grid">
        <section className="panel stack">
          <h2>Карточка</h2>
          {canWrite ? (
            <form className="form-grid" onSubmit={save}>
              <label>
                Бренд
                <input
                  required
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </label>
              <label>
                Модель
                <input
                  required
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </label>
              <label>
                Год
                <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </label>
              <label>
                VIN
                <input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </label>
              <label>
                Лот
                <input
                  value={form.lotNumber}
                  onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
                />
              </label>
              <label>
                Тип
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="USED">Б/у</option>
                  <option value="NEW">Новый</option>
                </select>
              </label>
              <label>
                Цена продажи
                <input
                  required
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
              <label>
                Себестоимость
                <input
                  type="number"
                  value={form.purchasePrice}
                  onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                />
              </label>
              <label>
                Предпродажка
                <input
                  type="number"
                  value={form.prepCost}
                  onChange={(e) => setForm({ ...form, prepCost: e.target.value })}
                />
              </label>
              <label>
                Пробег, км
                <input
                  type="number"
                  value={form.mileageKm}
                  onChange={(e) => setForm({ ...form, mileageKm: e.target.value })}
                />
              </label>
              <label>
                Цвет
                <input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </label>
              <label className="form-span-2">
                Комплектация
                <textarea
                  rows={2}
                  value={form.equipment}
                  onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                />
              </label>
              <label className="form-span-2">
                Описание
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <label className="form-span-2">
                Фото (URL, по одному на строку)
                <textarea
                  rows={3}
                  value={form.photoUrlsText}
                  onChange={(e) => setForm({ ...form, photoUrlsText: e.target.value })}
                  placeholder="https://..."
                />
              </label>
              <label className="form-span-2">
                Ссылка Avito
                <input
                  value={form.avitoUrl}
                  onChange={(e) => setForm({ ...form, avitoUrl: e.target.value })}
                  placeholder="https://www.avito.ru/..."
                />
              </label>
              <label>
                ID объявления Avito
                <input
                  value={form.avitoItemId}
                  onChange={(e) => setForm({ ...form, avitoItemId: e.target.value })}
                  placeholder="из ссылки или вручную"
                />
              </label>
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </form>
          ) : (
            <dl className="vehicle-dl">
              <div>
                <dt>Тип</dt>
                <dd>{KIND[vehicle.kind] || vehicle.kind}</dd>
              </div>
              <div>
                <dt>Цена</dt>
                <dd>{formatMoney(vehicle.price)}</dd>
              </div>
              <div>
                <dt>Себестоимость</dt>
                <dd>{vehicle.purchasePrice != null ? formatMoney(vehicle.purchasePrice) : '—'}</dd>
              </div>
              <div>
                <dt>Предпродажка</dt>
                <dd>{formatMoney(vehicle.prepCost || 0)}</dd>
              </div>
              <div>
                <dt>Пробег</dt>
                <dd>{vehicle.mileageKm != null ? `${vehicle.mileageKm} км` : '—'}</dd>
              </div>
              <div>
                <dt>Цвет</dt>
                <dd>{vehicle.color || '—'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="panel stack">
          <h2>Бронь и продажа</h2>
          {vehicle.status === 'RESERVED' && (
            <div className="vehicle-reserve-box">
              <strong>В резерве</strong>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                {vehicle.reservedBy?.name || 'менеджер'}
                {vehicle.reservedUntil ? ` · до ${formatDate(vehicle.reservedUntil)}` : ''}
              </p>
              {vehicle.reservedDeal && (
                <p style={{ margin: '0.5rem 0 0' }}>
                  Сделка:{' '}
                  <Link to={`/deals/${vehicle.reservedDeal.id}`}>{vehicle.reservedDeal.title}</Link>
                </p>
              )}
            </div>
          )}

          {canWrite && vehicle.status !== 'SOLD' && (
            <>
              <label>
                Сделка (опц.)
                <select value={reserveDealId} onChange={(e) => setReserveDealId(e.target.value)}>
                  <option value="">— без сделки —</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      #{d.id} {d.title} · {STAGE_LABELS[d.stage] || d.stage}
                    </option>
                  ))}
                </select>
              </label>
              {vehicle.status === 'IN_STOCK' && (
                <>
                  <label>
                    Срок брони, часов
                    <input
                      type="number"
                      min="1"
                      max="720"
                      value={reserveHours}
                      onChange={(e) => setReserveHours(e.target.value)}
                    />
                  </label>
                  <button type="button" className="btn primary" disabled={busy} onClick={reserve}>
                    Забронировать VIN
                  </button>
                </>
              )}
              {vehicle.status === 'RESERVED' && vehicle.reservedById === user?.id && (
                <button type="button" className="btn" disabled={busy} onClick={reserve}>
                  Продлить бронь
                </button>
              )}
              {canRelease && (
                <button type="button" className="btn" disabled={busy} onClick={release}>
                  Снять бронь
                </button>
              )}
              <button type="button" className="btn" disabled={busy} onClick={markSold}>
                Отметить проданным
              </button>
            </>
          )}

          {vehicle.status === 'SOLD' && <p className="muted">Авто продано. Бронь недоступна.</p>}

          <h3 style={{ marginTop: '1rem' }}>Авито</h3>
          {vehicle.listingStatus === 'NEEDS_UNLIST' && (
            <div className="vehicle-unlist-warn">
              <strong>Снимите объявление с Avito</strong>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                Авто в резерве или продано — объявление ещё может висеть на площадке.
              </p>
            </div>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Статус: <strong>{LISTING[vehicle.listingStatus] || vehicle.listingStatus || 'NONE'}</strong>
          </p>
          {vehicle.avitoUrl ? (
            <p style={{ margin: '0.35rem 0 0' }}>
              <a href={vehicle.avitoUrl} target="_blank" rel="noreferrer">
                Открыть объявление
              </a>
              {vehicle.avitoItemId ? ` · id ${vehicle.avitoItemId}` : ''}
            </p>
          ) : (
            <p className="muted">Укажите ссылку в карточке и сохраните.</p>
          )}
          {canWrite && (
            <div className="row gap" style={{ flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {vehicle.listingStatus !== 'LISTED' && (
                <button type="button" className="btn primary" disabled={busy} onClick={markListed}>
                  Объявление выложено
                </button>
              )}
              {(vehicle.listingStatus === 'LISTED' || vehicle.listingStatus === 'NEEDS_UNLIST') && (
                <button type="button" className="btn" disabled={busy} onClick={markUnlisted}>
                  Снял с Avito
                </button>
              )}
            </div>
          )}

          <h3 style={{ marginTop: '1rem' }}>Сделки с этим авто</h3>
          {(vehicle.deals || []).length === 0 ? (
            <p className="muted">Пока нет</p>
          ) : (
            <ul className="list">
              {vehicle.deals.map((d) => (
                <li key={d.id}>
                  <Link to={`/deals/${d.id}`}>{d.title}</Link>
                  {' · '}
                  {STAGE_LABELS[d.stage] || d.stage}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
