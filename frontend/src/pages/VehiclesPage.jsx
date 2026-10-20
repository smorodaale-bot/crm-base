import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { formatDate, formatMoney } from '../constants.js';
import { EmptyState } from '../components/EmptyState.jsx';

const KIND = { NEW: 'Новый', USED: 'Б/у' };
const STATUS = {
  IN_STOCK: 'На складе',
  RESERVED: 'Резерв',
  SOLD: 'Продан',
  IN_TRANSIT: 'В пути',
};

export default function VehiclesPage() {
  const { canWrite } = useAuth();
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [search, setSearch] = useState('');
  const [onlyNeedsUnlist, setOnlyNeedsUnlist] = useState(false);
  const [error, setError] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [form, setForm] = useState({
    brand: '',
    model: '',
    year: '',
    vin: '',
    price: '',
    purchasePrice: '',
    kind: 'USED',
    status: 'IN_STOCK',
  });
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState(null);

  async function load() {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      if (onlyNeedsUnlist) params.set('listingStatus', 'NEEDS_UNLIST');
      const data = await api(`/vehicles?${params}`);
      setVehicles(data.vehicles);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [onlyNeedsUnlist]);

  async function createVehicle(e) {
    e.preventDefault();
    try {
      const data = await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          brand: form.brand,
          model: form.model,
          year: form.year ? Number(form.year) : null,
          vin: form.vin || null,
          price: Number(form.price),
          purchasePrice: form.purchasePrice !== '' ? Number(form.purchasePrice) : null,
          kind: form.kind,
          status: form.status,
        }),
      });
      setForm({
        brand: '',
        model: '',
        year: '',
        vin: '',
        price: '',
        purchasePrice: '',
        kind: 'USED',
        status: 'IN_STOCK',
      });
      toast.success('Авто добавлено');
      await load();
      if (data.vehicle?.id) {
        // stay on list; user can open card
      }
    } catch (err) {
      if (err.code === 'VEHICLE_LIMIT') setUpgradeMsg(err.message);
      else toast.error(err.message);
    }
  }

  async function importStock(e) {
    e.preventDefault();
    if (!importFile && !importText.trim()) {
      toast.error('Выберите CSV или вставьте таблицу из Excel');
      return;
    }
    setImportBusy(true);
    try {
      const data = importFile
        ? await api('/vehicles/import', {
            method: 'POST',
            body: (() => {
              const fd = new FormData();
              fd.append('file', importFile);
              return fd;
            })(),
          })
        : await api('/vehicles/import', {
            method: 'POST',
            body: JSON.stringify({ text: importText }),
          });
      setImportReport(data);
      const limitLine = (data.errors || []).find((row) => /Повысьте тариф/.test(row.message || ''));
      if (limitLine) setUpgradeMsg(limitLine.message);
      toast.success(`Добавлено ${data.created}, обновлено ${data.updated}`);
      setImportText('');
      setImportFile(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImportBusy(false);
    }
  }

  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Склад авто</h1>
          <p className="muted">VIN, бронь и карточка автомобиля</p>
        </div>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input
            placeholder="Поиск: бренд, VIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="row gap" style={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={onlyNeedsUnlist}
              onChange={(e) => setOnlyNeedsUnlist(e.target.checked)}
            />
            Снять с Avito
          </label>
          <button className="btn" type="submit">
            Найти
          </button>
        </form>
      </div>

      {canWrite && (
        <form className="panel form-grid" onSubmit={createVehicle}>
          <h2>Добавить авто</h2>
          {upgradeMsg ? (
            <div className="error" style={{ gridColumn: '1 / -1' }}>
              {upgradeMsg}{' '}
              <Link className="btn" to="/org/billing">
                Повысить тариф
              </Link>
            </div>
          ) : null}
          <label>
            Бренд
            <input required value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </label>
          <label>
            Модель
            <input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
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
            Цена продажи
            <input required type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
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
            Тип
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="USED">Б/у</option>
              <option value="NEW">Новый</option>
            </select>
          </label>
          <button className="btn primary" type="submit">
            Сохранить
          </button>
        </form>
      )}

      {canWrite && (
        <form className="panel stack" style={{ marginTop: 16 }} onSubmit={importStock}>
          <div>
            <h2>Загрузить из Excel</h2>
            <p className="muted" style={{ margin: 0 }}>
              Скачайте шаблон, заполните в Excel и сохраните как CSV UTF-8. Либо скопируйте ячейки и вставьте ниже.
              Повторный VIN обновляет цену, закуп и дату поступления.
            </p>
          </div>
          <div className="row gap">
            <button
              className="btn"
              type="button"
              onClick={() =>
                downloadCsv('/vehicles/import/template', 'sklad-shablon.csv').catch((err) => toast.error(err.message))
              }
            >
              Скачать шаблон
            </button>
            <button className="btn" type="button" onClick={() => document.getElementById('stock-csv').click()}>
              {importFile ? importFile.name : 'Выбрать CSV'}
            </button>
            <input
              id="stock-csv"
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            <button className="btn primary" type="submit" disabled={importBusy}>
              {importBusy ? 'Загрузка…' : 'Загрузить'}
            </button>
          </div>
          <label>
            Или вставка из Excel
            <textarea
              rows={4}
              placeholder="Марка, модель, цена…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </label>
          {importReport ? (
            <p className="muted" style={{ margin: 0 }}>
              Добавлено {importReport.created}, обновлено {importReport.updated}
              {importReport.failed ? `, ошибок ${importReport.failed}` : ''}.
              {(importReport.errors || []).slice(0, 5).map((err) => (
                <span key={`${err.line}-${err.message}`}>
                  {' '}
                  Строка {err.line}: {err.message}.
                </span>
              ))}
            </p>
          ) : null}
        </form>
      )}

      <section className="panel" style={{ marginTop: 16 }}>
        {!vehicles.length ? (
          <EmptyState title="Склад пуст" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Авто</th>
                  <th>VIN / лот</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Дней</th>
                  <th>Цена</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/vehicles/${v.id}`}>
                        {v.brand} {v.model}
                        {v.year ? ` (${v.year})` : ''}
                      </Link>
                    </td>
                    <td>
                      {v.vin || '—'}
                      {v.lotNumber ? <div className="muted">{v.lotNumber}</div> : null}
                    </td>
                    <td>{KIND[v.kind] || v.kind}</td>
                    <td>
                      <span className={`badge vehicle-status vehicle-status-${v.status}`}>
                        {STATUS[v.status] || v.status}
                      </span>
                      {v.listingStatus === 'NEEDS_UNLIST' ? (
                        <div>
                          <span className="badge listing-status listing-status-NEEDS_UNLIST">
                            Снять с Avito
                          </span>
                        </div>
                      ) : v.listingStatus === 'LISTED' ? (
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          Avito
                        </div>
                      ) : null}
                      {v.status === 'RESERVED' && v.reservedBy?.name ? (
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {v.reservedBy.name}
                          {v.reservedUntil ? ` · до ${formatDate(v.reservedUntil)}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{v.daysInStock != null ? v.daysInStock : '—'}</td>
                    <td>{formatMoney(v.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
