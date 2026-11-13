'use strict';
/* Разбор распознанного текста: дата, тип документа, показатели, заключение.
   Это эвристики — результат всегда показывается пользователю на проверку. */

const pNorm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
const isWordCh = c => !!c && /[a-zа-я0-9]/.test(c);
function findWord(hay, needle, from = 0) {
  let i = from;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    if (!isWordCh(hay[i - 1]) && !isWordCh(hay[i + needle.length])) return i;
    i++;
  }
  return -1;
}
// короткие слова ищем целиком, длинные — как корень
const findKw = (hay, kw) => (kw.length <= 4 ? findWord(hay, kw) : hay.indexOf(kw));
const NUM = '\\d+(?:[.,]\\d+)?';

// Распознавание путает похожие латинские и русские буквы (ТТГ → TTT, г/л → r/n),
// поэтому названия и единицы сравниваем в «свёрнутом» виде.
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', r: 'г', n: 'л', l: 'л' };
const fold = s => pNorm(s).replace(/[a-z]/g, ch => LOOKALIKE[ch] || ch);
const UNITS = ['г/л', 'г/дл', 'мг/л', 'мг/дл', 'мкг/л', 'мкг/дл', 'мкг/мл', 'нг/мл', 'нг/дл', 'пг/мл', 'ммоль/л', 'мкмоль/л', 'нмоль/л', 'пмоль/л',
  'Ед/л', 'Ед/мл', 'мЕд/л', 'мкЕд/мл', 'МЕ/л', 'МЕ/мл', 'мМЕ/л', 'мМЕ/мл', 'мкМЕ/мл', 'мм/ч', 'мм/час', 'сек', '%', 'фл', 'пг', 'тыс/мкл', 'млн/мкл', '10^9/л', '10^12/л'];
const UNIT_BY_FOLD = new Map(UNITS.map(u => [fold(u), u]));
let SYN_FOLDED = null;
const synFolded = () => (SYN_FOLDED = SYN_FOLDED || CATALOG.map(item => ({ item, syn: item.syn.map(fold) })));

// ---------- дата ----------
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
function parseDate(text, todayIso) {
  const t = pNorm(text);
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const found = [];
  const push = (y, m, d, idx) => {
    y = +y; m = +m; d = +d;
    if (y < 100) y += y > 50 ? 1900 : 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso > today) return;
    const ctx = t.slice(Math.max(0, idx - 40), idx);
    if (/рожд|д\.\s?р\./.test(ctx)) return;
    let score = 0;
    if (/взят|исследован|прием|осмотр|выполн|консультац|обследован/.test(ctx)) score = 5;
    else if (/дата/.test(ctx)) score = 3;
    else if (/печат|выдач|регистр|готов/.test(ctx)) score = 2;
    found.push({ iso, score, idx });
  };
  let m;
  const r1 = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4}|\d{2})(?!\d)/g;
  while ((m = r1.exec(t))) push(m[3], m[2], m[1], m.index);
  const r2 = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((m = r2.exec(t))) push(m[1], m[2], m[3], m.index);
  const r3 = /(\d{1,2})\s+([а-я]+)\s+(\d{4})/g;
  while ((m = r3.exec(t))) {
    const mi = MONTHS.findIndex(x => (x === 'ма' ? /^ма[яй]$/.test(m[2]) : m[2].startsWith(x)));
    if (mi >= 0) push(m[3], mi + 1, m[1], m.index);
  }
  if (!found.length) return '';
  found.sort((a, b) => b.score - a.score || (a.score ? a.idx - b.idx : b.iso.localeCompare(a.iso)));
  return found[0].iso;
}

// ---------- показатели анализов ----------
function matchIndicator(line) {
  let best = null;
  for (const { item, syn: syns } of synFolded()) {
    for (const syn of syns) {
      const pos = findWord(line, syn);
      if (pos < 0 || pos > 60) continue;
      const before = line.slice(0, pos);
      if (/[a-zа-я]{4,}/.test(before) && !/\($/.test(before)) continue;
      if (/^[\/]/.test(line.slice(pos + syn.length))) continue;
      if (!best || pos < best.pos || (pos === best.pos && syn.length > best.len)) best = { item, pos, len: syn.length, end: pos + syn.length };
    }
  }
  return best;
}

function parseRange(str) {
  let min = '', max = '';
  const fix = x => x.replace(',', '.');
  const r = str.match(new RegExp(`(${NUM})\\s*[-–—−]\\s*(${NUM})`));
  if (r) { min = fix(r[1]); max = fix(r[2]); }
  else {
    const lt = str.match(new RegExp(`(?:<|≤|до|менее|не более)\\s*=?\\s*(${NUM})`, 'i'));
    const gt = str.match(new RegExp(`(?:>|≥|от|более|не менее)\\s*=?\\s*(${NUM})`, 'i'));
    if (lt) max = fix(lt[1]);
    if (gt) min = fix(gt[1]);
  }
  return { min, max };
}
function cleanUnit(raw) {
  const u = String(raw || '').replace(/[↑↓*+!|]/g, ' ').replace(/\s*(не более|не менее|до|от|менее|более)\s*$/i, '').replace(/[\s\-–—:;,.]+$/, '').replace(/^[\s\-–—:;,.]+/, '').trim();
  return /[A-Za-zА-Яа-я%]/.test(u) && u.length <= 12 && !/\s\S+\s/.test(u) ? u : '';
}

function parseTail(tail) {
  let unit = '';
  tail = tail.replace(/[xх×*]?\s*10\s*[\^*еe]?\s*(12|9|6|3)\s*\/\s*[лl]/i, (m0, p) => { unit = `10^${p}/л`; return ' '; });
  // Значение — число, стоящее отдельно. «25» в «25-гидрокси» или «B12» — часть названия, а не результат.
  const strict = new RegExp(`(?:^|[\\s:;|])((?:[<>≤≥]\\s*)?${NUM})(?![.,]?\\d)(?![-–][A-Za-zА-Яа-яЁё])`);
  const vm = tail.match(strict);
  if (!vm) return null;
  const vLen = vm[1].length, vIdx = vm.index + vm[0].length - vLen;
  const value = tail.slice(vIdx, vIdx + vLen).replace(/\s+/g, '').replace(',', '.');
  const after = tail.slice(vIdx + vLen);
  if (!unit) {
    const um = after.match(/^\s*([^\d<>≤≥(\[\]]{1,16}?)\s*(?=[\d<>≤≥(\[]|$)/);
    if (um) unit = cleanUnit(um[1]);
  }
  return { value, unit, ...parseRange(after) };
}

// Что стоит перепроверить глазами: потерянная запятая, странная единица.
function checkResult(r, item) {
  const n = v => { const x = parseFloat(String(v).replace(/^[<>≤≥]/, '')); return Number.isNaN(x) ? null : x; };
  const warn = [];
  const known = UNIT_BY_FOLD.get(fold(r.unit));
  if (known) r.unit = known; else if (r.unit) warn.push('unit');
  const v = n(r.value), min = n(r.min), max = n(r.max);
  if (item && item.max != null && max !== null && (max > item.max * 4 || max < item.max / 4)) warn.push('min', 'max');
  const refMax = warn.includes('max') ? item.max : max, refMin = warn.includes('max') ? item.min : min;
  if (v !== null && ((refMax != null && refMax > 0 && v > refMax * 4) || (refMin != null && refMin > 0 && v < refMin / 4))) warn.push('value');
  if (item && r.min === '' && r.max === '' && (item.min != null || item.max != null) && fold(r.unit) === fold(item.unit || '')) {
    r.min = item.min != null ? String(item.min) : ''; r.max = item.max != null ? String(item.max) : ''; r.fromCatalog = true;
  }
  if (warn.length) r.warn = warn;
  return r;
}

// ---------- таблица: раскладываем слова по колонкам «Наименование / Результат / Ед. / Норма» ----------
const HEADER_KINDS = [
  ['ref', /норм|референс|интервал/], ['unit', /ед\.?\s*изм|единиц|^ед\.?$/], ['flag', /флаг|отклонен/],
  ['value', /результат|значение/], ['name', /наименован|исследован|показател|тест|анализ|параметр|компонент/],
];
function toCells(line) {
  const out = [];
  for (const c of [...line.cells].sort((a, b) => a.x0 - b.x0)) {
    const last = out[out.length - 1];
    if (last && c.x0 - last.x1 < line.h * 0.75) { last.s += ' ' + c.s; last.x1 = Math.max(last.x1, c.x1); } else out.push({ ...c });
  }
  return out;
}
const headerKind = c => (c.s.length > 40 ? null : (HEADER_KINDS.find(([, re]) => re.test(pNorm(c.s))) || [])[0]);
// Заголовок таблицы часто перенесён на две-три строки («Нормальные / значения»), поэтому смотрим и на соседние.
function detectHeader(cells, nearby) {
  if (cells.length < 2 || cells.length > 8 || cells.some(c => c.s.length > 40)) return null;
  const cols = [];
  for (const c of cells) {
    const kind = headerKind(c);
    if (kind && !cols.some(x => x.kind === kind)) cols.push({ kind, x0: c.x0, x1: c.x1 });
  }
  if (!cols.some(c => c.kind === 'value') || cols.length < 2) return null;
  for (const c of nearby || []) {
    const kind = headerKind(c);
    if (kind && kind !== 'value' && !cols.some(x => x.kind === kind || (c.x0 < x.x1 && c.x1 > x.x0))) cols.push({ kind, x0: c.x0, x1: c.x1 });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  cols.forEach((c, i) => {
    c.left = i ? (cols[i - 1].x1 + c.x0) / 2 : -Infinity;
    c.right = i < cols.length - 1 ? (c.x1 + cols[i + 1].x0) / 2 : Infinity;
  });
  if (cols[0].kind !== 'name') { cols[0].left = cols[0].x0 - 4; cols.unshift({ kind: 'name', left: -Infinity, right: cols[0].left }); }
  return cols;
}
function parseTable(lines) {
  if (!lines || !lines.length) return [];
  const hs = lines.map(l => l.h).sort((a, b) => a - b), H = hs[Math.floor(hs.length / 2)] || 10;
  const text = lines.map(l => l.cells.map(c => c.s).join(' ')).join('\n');
  const urine = /анализ мочи|исследование мочи/.test(pNorm(text));
  const out = [], seen = new Set();
  let cols = null, row = null, prevY = null;
  const valRe = new RegExp(`^[^0-9<>≤≥A-Za-zА-Яа-яЁё]*((?:[<>≤≥]\\s*)?${NUM})(.*)$`);
  const flush = () => {
    if (row && row.name.length && row.value) {
      const rawName = row.name.join(' ').replace(/\s+/g, ' ').replace(/[\s,.:;\-–]+$/, '').trim();
      const m = matchIndicator(fold(rawName));
      let name = m ? m.item.name : rawName;
      const unit = cleanUnit(row.unit.replace(/[xх×*]?\s*10\s*[\^*еe]?\s*(12|9|6|3)\s*\/\s*[лl]/i, '10^$1/л')) || (/10\^/.test(row.unit) ? row.unit.match(/10\^\d+\/л/)[0] : '');
      if (m && m.item.abs && (/10\^|тыс/.test(unit) || /абс/.test(pNorm(rawName)))) name = m.item.abs;
      if (urine) name += ' (моча)';
      const k = pNorm(name);
      if (!seen.has(k) && (rawName.match(/[A-Za-zА-Яа-яЁё]/g) || []).length >= 2) {
        seen.add(k);
        out.push(checkResult({ name, value: row.value, unit: unit || (m && !urine && !row.unit ? m.item.unit || '' : ''), ...parseRange(row.ref) }, urine ? null : m && m.item));
      }
    }
    row = null;
  };
  const all = lines.map(l => ({ line: l, cells: toCells(l) }));
  let skipUntil = -Infinity;
  for (let i = 0; i < all.length; i++) {
    const { line, cells } = all[i];
    if (!cells.length) continue;
    const near = all.filter((x, j) => j !== i && Math.abs(x.line.y - line.y) < H * 1.7).flatMap(x => x.cells);
    const hdr = detectHeader(cells, near);
    if (hdr) { flush(); cols = hdr; prevY = line.y; skipUntil = line.y + H * 1.7; continue; }
    if (!cols) continue;
    if (line.y < skipUntil && cells.every(c => headerKind(c) || c.s.length <= 2)) continue; // хвост заголовка
    const valueCol = cols.find(c => c.kind === 'value'), nameCol = cols[0];
    const parts = { name: [], value: [], unit: [], ref: [], flag: [] };
    let spanning = false;
    for (const c of cells) {
      if (c.x0 < nameCol.right) {
        parts.name.push(c.s);
        if (c.x1 > (valueCol.x0 + valueCol.x1) / 2) spanning = true; // строка во всю ширину — подзаголовок или примечание
      } else {
        const mid = (c.x0 + c.x1) / 2;
        const col = cols.find(k => mid >= k.left && mid < k.right) || cols[cols.length - 1];
        parts[col.kind === 'name' ? 'value' : col.kind].push(c.s);
      }
    }
    const gap = prevY === null ? 99 : (line.y - prevY) / H;
    prevY = line.y;
    const nameTxt = parts.name.join(' ').trim(), valTxt = parts.value.join(' ').trim();
    const vm = valTxt.match(valRe);
    if (spanning || (valTxt && !vm)) { flush(); continue; }
    const value = vm ? vm[1].replace(/\s+/g, '').replace(',', '.') : '';
    const unitTxt = parts.unit.join(' ').trim() || (vm && !cols.some(c => c.kind === 'unit') ? vm[2].trim() : '');
    const refTxt = parts.ref.join(' ').trim();
    // продолжение многострочного названия: вплотную к предыдущей строке или по смыслу
    const joins = () => row && gap < 1.6 && (gap < 0.95 || /^[a-zа-яё(]/.test(nameTxt) || /[,\-–(]$/.test(row.name[row.name.length - 1] || ''));
    if (nameTxt && value) {
      if (row && !row.value && joins()) row.name.push(nameTxt); else { flush(); row = { name: [nameTxt], value: '', unit: '', ref: '' }; }
      row.value = value;
    } else if (value) {
      if (row && !row.value && gap < 1.6) row.value = value; else continue;
    } else if (nameTxt) {
      if (/[A-Za-zА-Яа-яЁё]/.test(nameTxt)) {
        if (joins()) row.name.push(nameTxt); else { flush(); row = { name: [nameTxt], value: '', unit: '', ref: '' }; }
      }
    } else if (!row || gap >= 1.6) continue;
    if (row) { if (unitTxt && !row.unit) row.unit = unitTxt; if (refTxt && !row.ref) row.ref = refTxt; }
  }
  flush();
  return out;
}

const NOT_RESULT = /дата|возраст|пол(?![а-яё])|тел\.|телефон|заказ|лиценз|стр\.|страниц|адрес|инн|паспорт|полис|снилс|№|номер|пациент|врач|год|лет(?![а-яё])/i;

function parseLab(text) {
  const urine = /анализ мочи|исследование мочи/.test(pNorm(text));
  const out = [], seen = new Set();
  const add = r => { const k = pNorm(r.name); if (!seen.has(k)) { seen.add(k); out.push(r); } };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const raw = rawLine.replace(/\s+/g, ' ').trim();
    if (raw.length < 4) continue;
    const line = pNorm(raw);
    const m = matchIndicator(fold(raw));
    if (m) {
      const tail = raw.slice(m.end).replace(/^[\s,]*\([^)]*\)/, '');
      const t = parseTail(tail);
      if (!t) continue;
      let name = m.item.name;
      if (m.item.abs && (/10\^|тыс/.test(t.unit) || /абс/.test(line))) name = m.item.abs;
      if (urine) name += ' (моча)';
      add(checkResult({ name, value: t.value, unit: t.unit || (urine ? '' : m.item.unit || ''), min: t.min, max: t.max }, urine ? null : m.item));
      continue;
    }
    // строка не из справочника, но похожа на «Название значение ед. норма»
    const g = raw.match(new RegExp(`^([A-Za-zА-Яа-яЁё][^\\d<>]{2,60}?)[\\s:]+((?:[<>]\\s*)?${NUM}.*)$`));
    if (g && !NOT_RESULT.test(g[1])) {
      const t = parseTail(g[2]);
      const name = g[1].replace(/[\s,.:;\-–(]+$/, '').trim();
      if (t && (t.min !== '' || t.max !== '') && (name.match(/[A-Za-zА-Яа-яЁё]/g) || []).length >= 3) {
        add(checkResult({ name: name[0].toUpperCase() + name.slice(1) + (urine ? ' (моча)' : ''), value: t.value, unit: t.unit, min: t.min, max: t.max }, null));
      }
    }
  }
  return out;
}

// ---------- тип документа ----------
function earliest(text, list) {
  let best = null;
  for (const [name, kws] of list) {
    for (const kw of [].concat(kws)) {
      const i = findKw(text, kw);
      if (i >= 0 && (!best || i < best.idx || (i === best.idx && kw.length > best.len))) best = { name, idx: i, len: kw.length };
    }
  }
  return best;
}

function section(text, startRe, stopRe, limit = 3000) {
  const m = startRe.exec(text);
  if (!m) return '';
  let rest = text.slice(m.index + m[0].length);
  const s = stopRe.exec(rest);
  if (s) rest = rest.slice(0, s.index);
  return rest.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}

const MEASURE_KW = /объ[её]м|толщин|длин|ширин|высот|размер|диаметр|перешеек|перешейк|фракция выброса|чсс|м-эхо|эндометри|кдр|кср/i;
function parseMeasures(text) {
  const out = [], seen = new Set();
  for (const lineRaw of String(text).split(/\r?\n/)) {
    const line = lineRaw.replace(/\s+/g, ' ').trim();
    const colon = line.indexOf(':');
    const subject = colon > 2 && colon < 45 && !/\d/.test(line.slice(0, colon)) ? line.slice(0, colon).trim() : '';
    const re = new RegExp(`([А-Яа-яЁё][А-Яа-яЁё \\-]{2,50}?)\\s*[:\\-–—=]?\\s*(${NUM})\\s*(мм|см3|см³|см\\^3|куб\\.?\\s?см|мл|см|%|уд\\/мин)(?![а-яa-z0-9])`, 'g');
    let m;
    while ((m = re.exec(line))) {
      let name = m[1].trim();
      if (!MEASURE_KW.test(name)) continue;
      if (/[xх×*]\s*$/.test(line.slice(0, m.index + m[1].length))) continue;
      if (subject && !pNorm(name).includes(pNorm(subject))) name = `${subject}: ${name}`;
      name = name[0].toUpperCase() + name.slice(1);
      const unit = m[3].replace(/см3|см\^3|куб\.?\s?см/, 'см³');
      const k = pNorm(name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name, value: m[2].replace(',', '.'), unit });
    }
  }
  return out.slice(0, 20);
}

function analyzeText(text, todayIso, lines) {
  text = String(text || '');
  const t = pNorm(text);
  const table = parseTable(lines);
  const results = table.length ? table : parseLab(text);
  const st = earliest(t, STUDY_TYPES);
  const visitScore = ['жалобы', 'анамнез', 'объективно', 'осмотр', 'консультаци', 'диагноз', 'прием врача'].filter(k => t.includes(k)).length;
  let kind = '';
  const studyTitle = st && st.idx < 300;
  if (results.length >= 3 && !studyTitle && visitScore < 3) kind = 'analysis';
  else if (visitScore >= 3) kind = 'visit';
  else if (studyTitle) kind = 'study';
  else if (visitScore >= 2) kind = 'visit';
  else if (st) kind = 'study';
  else if (results.length) kind = 'analysis';

  const area = earliest(t, STUDY_AREAS);
  const spec = earliest(t, SPECIALTIES.map(([n, k]) => [n, [k]]).concat([['ЛОР', ['лор']]]));
  const lab = LABS.map(([k, n]) => ({ n, i: findWord(t, k) })).filter(x => x.i >= 0).sort((a, b) => a.i - b.i)[0];
  const doc = text.match(/[Вв]рач[^\n:]{0,30}[:\s]\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.|\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+))/);
  const STOP = /\n\s*(рекомендаци|врач(?![а-яё])|подпись|дата(?![а-яё]))/i;
  return {
    kind,
    parsed: {
      date: parseDate(text, todayIso),
      lab: lab ? lab.n : '',
      results,
      studyType: st ? st.name : '',
      area: area ? area.name : '',
      conclusion: section(text, /заключение\s*[:.\-–]?\s*/i, STOP),
      recs: section(text, /рекомендаци[ия]\s*[:.\-–]?\s*/i, /\n\s*(врач(?![а-яё])|подпись|дата(?![а-яё])|заключение)/i),
      diagnosis: section(text, /диагноз[^:\n]{0,40}:\s*/i, /\n\s*(рекомендаци|план(?![а-яё])|назначен|лечение|врач(?![а-яё]))/i, 600),
      measures: parseMeasures(text),
      specialty: spec ? spec.name : '',
      doctor: doc ? doc[1].trim() : '',
    },
  };
}

if (typeof module !== 'undefined') module.exports = { analyzeText, parseLab, parseTable, parseDate, parseMeasures };
