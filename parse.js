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
      if (pos < 0 || pos > 30) continue;
      if (!best || pos < best.pos || (pos === best.pos && syn.length > best.len)) best = { item, pos, len: syn.length, end: pos + syn.length };
    }
  }
  return best;
}

function parseTail(tail) {
  let unit = '';
  tail = tail.replace(/[xх×*]?\s*10\s*[\^*еe]?\s*(12|9|6|3)\s*\/\s*[лl]/i, (m0, p) => { unit = `10^${p}/л`; return ' '; });
  const vm = tail.match(new RegExp(`(?:[<>≤≥]\\s*)?${NUM}`));
  if (!vm) return null;
  const value = vm[0].replace(/\s+/g, '').replace(',', '.');
  const after = tail.slice(vm.index + vm[0].length);
  if (!unit) {
    const um = after.match(/^\s*([^\d<>≤≥(\[\]]{1,16}?)\s*(?=[\d<>≤≥(\[]|$)/);
    if (um) {
      const u = um[1].replace(/[↑↓*+!|]/g, ' ').replace(/\s*(не более|не менее|до|от|менее|более)\s*$/i, '').replace(/[\s\-–—:;,.]+$/, '').trim();
      if (/[A-Za-zА-Яа-я%]/.test(u) && u.length <= 12 && !/\s\S+\s/.test(u)) unit = u;
    }
  }
  let min = '', max = '';
  const fix = s => s.replace(',', '.');
  const r = after.match(new RegExp(`(${NUM})\\s*[-–—−]\\s*(${NUM})`));
  if (r) { min = fix(r[1]); max = fix(r[2]); }
  else {
    const lt = after.match(new RegExp(`(?:<|≤|до|менее|не более)\\s*=?\\s*(${NUM})`, 'i'));
    const gt = after.match(new RegExp(`(?:>|≥|от|более|не менее)\\s*=?\\s*(${NUM})`, 'i'));
    if (lt) max = fix(lt[1]);
    if (gt) min = fix(gt[1]);
  }
  return { value, unit, min, max };
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
  if (warn.length) r.warn = warn;
  return r;
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

function analyzeText(text, todayIso) {
  text = String(text || '');
  const t = pNorm(text);
  const results = parseLab(text);
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

if (typeof module !== 'undefined') module.exports = { analyzeText, parseLab, parseDate, parseMeasures };
