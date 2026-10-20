/** Parse a stock spreadsheet exported from Excel (CSV or pasted cells). */

const HEADER_ALIASES = {
  марка: 'brand',
  бренд: 'brand',
  brand: 'brand',
  модель: 'model',
  model: 'model',
  год: 'year',
  year: 'year',
  vin: 'vin',
  вин: 'vin',
  лот: 'lotNumber',
  'номер лота': 'lotNumber',
  lot: 'lotNumber',
  цена: 'price',
  'цена продажи': 'price',
  price: 'price',
  закуп: 'purchasePrice',
  себестоимость: 'purchasePrice',
  purchase: 'purchasePrice',
  purchaseprice: 'purchasePrice',
  предпродажка: 'prepCost',
  'предпродажная подготовка': 'prepCost',
  prepcost: 'prepCost',
  'дата поступления': 'stockedAt',
  'дата на складе': 'stockedAt',
  дата: 'stockedAt',
  stockedat: 'stockedAt',
  пробег: 'mileageKm',
  mileage: 'mileageKm',
  цвет: 'color',
  color: 'color',
  тип: 'kind',
  kind: 'kind',
  статус: 'status',
  status: 'status',
  avito: 'avitoUrl',
  'avito url': 'avitoUrl',
  'ссылка avito': 'avitoUrl',
  avitourl: 'avitoUrl',
};

export const TEMPLATE_CSV =
  'Марка;Модель;Год;VIN;Цена;Закуп;Предпродажка;Дата поступления;Пробег;Цвет\n';

const MAX_ROWS = 500;

function detectDelimiter(headerLine) {
  const counts = {
    ';': (headerLine.match(/;/g) || []).length,
    ',': (headerLine.match(/,/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function headerKey(label) {
  const key = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return HEADER_ALIASES[key] || null;
}

export function parseMoney(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/руб\.?/gi, '')
    .replace(/₽/g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseStockDate(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const dotted = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date;
    }
    return null;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseKind(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (['new', 'новый', 'новая', 'новое'].includes(raw)) return 'NEW';
  if (['used', 'б/у', 'бу', 'б у', 'с пробегом'].includes(raw)) return 'USED';
  return undefined;
}

function parseStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (['in_stock', 'склад', 'на складе', 'в наличии'].includes(raw)) return 'IN_STOCK';
  if (['in_transit', 'в пути'].includes(raw)) return 'IN_TRANSIT';
  return undefined;
}

function normalizeVin(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return raw || null;
}

/**
 * @returns {{ rows: object[], errors: { line: number, message: string }[] }}
 */
export function parseVehicleSheet(text) {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return { rows: [], errors: [{ line: 1, message: 'Файл пустой' }] };
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const delimiter = detectDelimiter(firstLine);
  const table = parseDelimited(trimmed, delimiter).filter((row) => row.some((cell) => String(cell).trim()));
  if (!table.length) {
    return { rows: [], errors: [{ line: 1, message: 'Файл пустой' }] };
  }

  const mapped = table[0].map(headerKey);
  if (!mapped.includes('brand') || !mapped.includes('model') || !mapped.includes('price')) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: 'Нужны колонки «Марка», «Модель» и «Цена». Скачайте шаблон и не меняйте первую строку.',
        },
      ],
    };
  }

  const rows = [];
  const errors = [];
  const body = table.slice(1, MAX_ROWS + 1);
  if (table.length - 1 > MAX_ROWS) {
    errors.push({ line: MAX_ROWS + 2, message: `Импорт ограничен ${MAX_ROWS} строками` });
  }

  body.forEach((cells, index) => {
    const line = index + 2;
    const record = {};
    mapped.forEach((field, col) => {
      if (!field) return;
      record[field] = cells[col] != null ? String(cells[col]).trim() : '';
    });
    if (!record.brand && !record.model && !record.vin && !record.price) return;

    if (!record.brand || !record.model) {
      errors.push({ line, message: 'Укажите марку и модель' });
      return;
    }
    const price = parseMoney(record.price);
    if (price == null || price < 0) {
      errors.push({ line, message: 'Некорректная цена продажи' });
      return;
    }
    const purchasePrice = parseMoney(record.purchasePrice);
    if (record.purchasePrice && purchasePrice == null) {
      errors.push({ line, message: 'Некорректный закуп' });
      return;
    }
    const prepCost = parseMoney(record.prepCost);
    if (record.prepCost && (prepCost == null || prepCost < 0)) {
      errors.push({ line, message: 'Некорректная предпродажка' });
      return;
    }
    const year = record.year ? Number(String(record.year).replace(/\s/g, '')) : null;
    if (record.year && (!Number.isInteger(year) || year < 1950 || year > 2100)) {
      errors.push({ line, message: 'Некорректный год' });
      return;
    }
    const mileageKm = record.mileageKm ? Number(String(record.mileageKm).replace(/\s/g, '')) : null;
    if (record.mileageKm && (!Number.isInteger(mileageKm) || mileageKm < 0)) {
      errors.push({ line, message: 'Некорректный пробег' });
      return;
    }
    let stockedAt;
    if (record.stockedAt) {
      stockedAt = parseStockDate(record.stockedAt);
      if (!stockedAt) {
        errors.push({ line, message: 'Дата поступления: ДД.ММ.ГГГГ' });
        return;
      }
    }

    rows.push({
      line,
      brand: record.brand,
      model: record.model,
      year: record.year ? year : undefined,
      vin: normalizeVin(record.vin),
      lotNumber: record.lotNumber || undefined,
      price,
      purchasePrice: record.purchasePrice ? purchasePrice : undefined,
      prepCost: record.prepCost ? prepCost : undefined,
      stockedAt,
      mileageKm: record.mileageKm ? mileageKm : undefined,
      color: record.color || undefined,
      kind: parseKind(record.kind),
      status: parseStatus(record.status),
      avitoUrl: record.avitoUrl || undefined,
    });
  });

  return { rows, errors };
}

export function decodeSpreadsheet(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const utf8 = buf.toString('utf8');
  const cp1251 = new TextDecoder('windows-1251').decode(buf);
  const utf8ok = parseVehicleSheet(utf8).errors.every((e) => e.line !== 1);
  if (utf8ok) return utf8.replace(/^\uFEFF/, '');
  const cpOk = parseVehicleSheet(cp1251).errors.every((e) => e.line !== 1);
  if (cpOk) return cp1251;
  return utf8.replace(/^\uFEFF/, '');
}
