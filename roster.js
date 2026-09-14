// Leitura do roster de SBCLs a partir do CSV publicado do Google Sheets.
// O link e estatico; o conteudo e lido a cada execucao.

export const ROSTER_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSEyhnUtQrnRFlPXDAEJDpNhm4yoLdpVLOtvI5fVb4LrwWNmEJKefwdSkYplIfn8r3c2pNcnlQ8byhv/pub?gid=965047178&single=true&output=csv';

const BUILDER_ID_HEADER = /builder\s*id/i;

// RFC 4180: aspas duplas escapam virgulas e quebras de linha dentro do campo.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Aceita "@alias", "alias" ou a URL do perfil colada inteira.
export function normalizeAlias(raw) {
  let value = String(raw || '').trim();
  if (!value) return null;

  const urlMatch = value.match(/builder\.aws\.com\/(?:community\/)?@?([^/?#\s]+)/i);
  if (urlMatch) value = urlMatch[1];

  value = value.replace(/^@+/, '').trim().toLowerCase();

  // A API rejeita o lote inteiro se um alias nao casar com este formato.
  return /^[a-z0-9]{1,64}$/.test(value) ? value : null;
}

export async function fetchRoster(url = ROSTER_CSV_URL) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Nao consegui ler a planilha (HTTP ${response.status})`);
  }

  const rows = parseCsv(await response.text()).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return { aliases: [], invalid: [] };

  const header = rows[0];
  const columnIndex = header.findIndex((c) => BUILDER_ID_HEADER.test(c));
  const column = columnIndex === -1 ? header.length - 1 : columnIndex;

  const aliases = [];
  const invalid = [];
  const seen = new Set();

  for (const row of rows.slice(1)) {
    const raw = (row[column] || '').trim();
    if (!raw) continue;

    const alias = normalizeAlias(raw);
    if (!alias) {
      invalid.push(raw);
    } else if (!seen.has(alias)) {
      seen.add(alias);
      aliases.push(alias);
    }
  }

  return { aliases, invalid };
}
