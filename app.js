'use strict';
/* Мои анализы — всё работает в браузере. Данные и сканы хранятся в IndexedDB на устройстве. */

// ---------- утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoLocal(new Date());
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU') : 'без даты');
const fmtStamp = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/^[<>≤≥\s]+/, '')); return Number.isNaN(n) ? null : n; };
const key = n => String(n ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const enc = encodeURIComponent;
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
const WEEK = 7 * 864e5;
const store = {
  get(k) { try { return localStorage.getItem('mt_' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('mt_' + k, v); } catch (e) { /* приватный режим */ } },
};

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8"/>',
  doc: '<path d="M9 4h6v3H9z"/><path d="M9 5H5v15h14V5h-4M9 12h6M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 3l8 3v6c0 4.500-3.400 8-8 9-4.600-1-8-4.500-8-9V6z"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.500"/><rect x="14" y="4" width="6" height="6" rx="1.500"/><rect x="4" y="14" width="6" height="6" rx="1.500"/><rect x="14" y="14" width="6" height="6" rx="1.500"/>',
  edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  cal: '<path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/>',
  clip: '<path d="M9 12l5-5a2.500 2.500 0 0 1 3.500 3.500l-7 7a4 4 0 0 1-5.700-5.700l7-7"/>',
  up: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  pill: '<rect x="3" y="8.500" width="18" height="7" rx="3.500" transform="rotate(-45 12 12)"/><path d="M9 9l6 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

function flag(r) {
  const v = num(r.value), min = num(r.min), max = num(r.max);
  if (v === null || (min === null && max === null)) return '';
  if (min !== null && v < min) return 'low';
  if (max !== null && v > max) return 'high';
  return 'ok';
}
const unitHtml = u => esc(u).replace(/10\^12/, '10¹²').replace(/10\^9/, '10⁹').replace(/10\^6/, '10⁶').replace(/10\^3/, '10³');
const FLAG_TXT = { low: 'Ниже нормы', high: 'Выше нормы', ok: 'В норме' };
const pill = f => (f ? `<span class="pill ${f}">${FLAG_TXT[f]}</span>` : '');
function rangeText(r) {
  const min = num(r.min), max = num(r.max);
  if (min !== null && max !== null) return `${min}–${max}`;
  if (max !== null) return `до ${max}`;
  if (min !== null) return `от ${min}`;
  return '';
}
function deltaText(cur, prev) {
  const a = num(cur), b = num(prev);
  if (a === null || b === null) return '';
  const d = +(a - b).toFixed(2);
  if (d === 0) return 'без изменений';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}${b ? ` (${d > 0 ? '+' : '−'}${Math.abs(Math.round(d / b * 100))}%)` : ''}`;
}

// ---------- хранилище (IndexedDB) ----------
// Версию базы можно только повышать. При обновлении приложения существующие записи не трогаются:
// onupgradeneeded лишь добавляет недостающие хранилища.
const STORES = ['analyses', 'studies', 'conclusions', 'meds', 'files', 'inbox', 'backups'];
const RECORDS = ['analyses', 'studies', 'conclusions', 'meds'];
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('med-tracker', 4);
    r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
    r.onsuccess = () => { db = r.result; db.onversionchange = () => db.close(); res(); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('закройте другие вкладки с приложением и обновите страницу'));
  });
  const run = (s, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(s, mode);
    const rq = fn(t.objectStore(s));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return {
    open,
    all: s => run(s, 'readonly', st => st.getAll()),
    keys: s => run(s, 'readonly', st => st.getAllKeys()),
    get: (s, id) => run(s, 'readonly', st => st.get(id)),
    put: (s, o) => run(s, 'readwrite', st => st.put(o)),
    del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
    clear: s => run(s, 'readwrite', st => st.clear()),
  };
})();

let analyses = [], studies = [], conclusions = [], meds = [], inbox = [], backups = [];
async function load() {
  analyses = (await DB.all('analyses')).sort(byDateDesc);
  studies = (await DB.all('studies')).sort(byDateDesc);
  conclusions = (await DB.all('conclusions')).sort(byDateDesc);
  meds = (await DB.all('meds')).sort(byDateDesc);
  inbox = (await DB.all('inbox')).sort((a, b) => a.addedAt - b.addedAt);
  backups = (await DB.all('backups')).sort((a, b) => b.at - a.at);
}
const hasData = () => analyses.length + studies.length + conclusions.length + meds.length > 0;

// Файлы удаляем, только когда на них не ссылается ни одна запись и ни одна точка восстановления
async function gc() {
  const used = new Set();
  const add = r => (r.files || []).forEach(f => used.add(f.id));
  for (const s of RECORDS) (await DB.all(s)).forEach(add);
  (await DB.all('inbox')).forEach(d => used.add(d.fileId));
  (await DB.all('backups')).forEach(b => RECORDS.forEach(s => (b[s] || []).forEach(add)));
  for (const id of await DB.keys('files')) if (!used.has(id)) await DB.del('files', id);
}

// перенос записей из первой версии приложения
async function migrate() {
  for (const c of await DB.all('conclusions')) {
    if (!('type' in c)) continue;
    if (['УЗИ', 'МРТ', 'КТ', 'Рентген', 'ЭКГ'].includes(c.type)) {
      await DB.put('studies', { id: c.id, date: c.date, type: c.type, area: c.title || '', clinic: '', doctor: c.doctor || '', description: '', conclusion: c.text || '', recs: c.recs || '', measures: [], files: c.files || [] });
      await DB.del('conclusions', c.id);
    } else {
      await DB.put('conclusions', { id: c.id, date: c.date, specialty: c.title || (c.type === 'Приём врача' ? '' : c.type), doctor: c.doctor || '', clinic: '', diagnosis: '', text: c.text || '', recs: c.recs || '', files: c.files || [] });
    }
  }
}

// ---------- ряды данных ----------
function seriesMap() {
  const m = new Map();
  [...analyses].reverse().forEach(a => (a.results || []).forEach(r => {
    if (!r.name || !r.name.trim()) return;
    const k = key(r.name);
    if (!m.has(k)) m.set(k, { name: r.name.trim(), pts: [] });
    m.get(k).pts.push({ ...r, date: a.date, aid: a.id });
  }));
  return m;
}
const studyTitle = s => `${s.type || 'Исследование'}${s.area ? ', ' + s.area.toLowerCase() : ''}`;
const studyKey = s => `${key(s.type)}|${key(s.area)}`;
function studySeries() {
  const m = new Map();
  [...studies].reverse().forEach(s => {
    const k = studyKey(s);
    if (!m.has(k)) m.set(k, { key: k, title: studyTitle(s), items: [] });
    m.get(k).items.push(s);
  });
  return m;
}

// Параметры исследования. Для записей, сохранённых до появления словесных параметров,
// дополняем их разбором протокола «на лету», ничего не перезаписывая.
function studyParams(s) {
  const own = s.measures || [];
  if (s.pv === PARSER_VERSION || !s.description) return own;
  // запись сохранена старой версией: разбираем протокол заново (по органам), значения, введённые вручную, оставляем
  const parsed = parseFindings(s.description);
  if (!parsed.length) return own;
  const used = new Set();
  own.forEach(o => {
    const hits = parsed.filter(m => key(m.name) === key(o.name) || key(m.name).endsWith(': ' + key(o.name)));
    if (hits.length) used.add(o);
    // число, исправленное вручную, сохраняем — но только когда понятно, к какому органу оно относится
    if (hits.length === 1 && num(o.value) !== null && !/[×x]/.test(hits[0].value)) { hits[0].value = o.value; hits[0].unit = o.unit || hits[0].unit; }
  });
  const concl = key(s.conclusion);
  return [...parsed, ...own.filter(o => !used.has(o) && !concl.includes(key(o.name)))];
}
// «Заключение» старых записей могло захватить «Рекомендовано: …» и «ПОДПИСИ» — разделяем при показе
function studyText(s) {
  let c = String(s.conclusion || '').replace(/\n?\s*подписи?\s*[\s\S]*$/i, ''), recs = s.recs || '';
  const m = c.match(/\n?\s*рекомендовано\s*:?\s*/i);
  if (m) { if (!recs) recs = c.slice(m.index + m[0].length); c = c.slice(0, m.index); }
  const fix = x => x.replace(/\s+([.,;:])/g, '$1').trim();
  return { conclusion: fix(c), recs: fix(recs) };
}
const isClear = v => /^(не\s+(выявлен|обнаружен|увеличен|расширен|изменен|утолщен)|без\s+(особенностей|патологии)|в\s+(пределах\s+)?норм)/i.test(String(v));
function groupParams(params) {
  const groups = new Map();
  params.forEach(m => {
    const i = m.name.indexOf(': ');
    const g = i > 0 ? m.name.slice(0, i) : '', label = i > 0 ? m.name.slice(i + 2) : m.name;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ label: label[0].toUpperCase() + label.slice(1), m });
  });
  return groups;
}
// каждый орган — отдельный блок с заголовком и плашками параметров
function paramsHtml(params) {
  if (!params.length) return '';
  const groups = groupParams(params), named = [...groups.keys()].some(Boolean);
  const tile = ({ label, m }) => `<div class="param ${num(m.value) === null || /[×x]/.test(m.value) ? (isClear(m.value) ? 'clear' : 'txt') : 'numv'}"><span>${esc(label)}</span><b>${esc(m.value)}${m.unit ? ` <small>${esc(m.unit)}</small>` : ''}</b></div>`;
  return [...groups.entries()].map(([g, items]) => `<section class="organ"><h4>${esc(g || (named ? 'Общее' : 'Параметры'))}<span class="muted">${items.length}</span></h4><div class="params">${items.map(tile).join('')}</div></section>`).join('');
}
// рекомендации и подобный текст: список вместо сплошной строки
function listHtml(text) {
  const items = String(text || '').split(/\n+|;\s+/).map(x => x.replace(/^\s*(?:\d+[.)]|[-–•*])\s*/, '').trim()).filter(Boolean);
  if (items.length < 2) return `<p class="note">${esc(text)}</p>`;
  return `<ul class="recs">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
}
const conclHtml = text => (text ? `<div class="concl"><span>Заключение</span><p>${esc(text)}</p></div>` : '');
const medsOf = id => meds.filter(m => m.sourceId === id);
const medChips = id => { const l = medsOf(id); return l.length ? `<h4>Назначено</h4><div class="files">${l.map(m => `<a class="file med-chip" href="#/meds">${ic('pill')}<b>${esc(m.name)}</b> ${esc(m.dose || '')}</a>`).join('')}</div>` : ''; };

// ---------- графики ----------
function smoothPath(p) {
  if (p.length < 2) return '';
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += ` C${b[0] + (c[0] - a[0]) / 7},${b[1] + (c[1] - a[1]) / 7} ${c[0] - (e[0] - b[0]) / 7},${c[1] - (e[1] - b[1]) / 7} ${c[0]},${c[1]}`;
  }
  return d;
}
let chartId = 0;
function chart(pts) {
  const p = pts.map(x => ({ t: new Date(x.date).getTime(), v: num(x.value), f: flag(x), d: x.date, u: x.unit })).filter(x => x.v !== null && !Number.isNaN(x.t));
  if (!p.length) return '<p class="muted">Нет числовых значений для графика.</p>';
  const last = pts[pts.length - 1];
  const bmin = num(last.min), bmax = num(last.max);
  const W = 460, H = 240, L = 40, R = 16, T = 28, B = 34, id = 'g' + (++chartId);
  const xs = p.map(x => x.t), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => (x1 === x0 ? L + (W - L - R) / 2 : L + (t - x0) / (x1 - x0) * (W - L - R));
  let lo = Math.min(...p.map(x => x.v), bmin ?? Infinity), hi = Math.max(...p.map(x => x.v), bmax ?? -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.14, floor = lo >= 0 ? 0 : -Infinity; lo = Math.max(floor, lo - pad); hi += pad;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(2));
  const xy = p.map(x => [+X(x.t).toFixed(1), +Y(x.v).toFixed(1)]);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>`;
  if (bmin !== null || bmax !== null) {
    const y1 = Y(bmax ?? hi), y2 = Y(bmin ?? lo);
    s += `<rect class="band" x="${L}" y="${y1}" width="${W - L - R}" height="${Math.max(0, y2 - y1)}" rx="10"/>`;
  }
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * i / 3, y = Y(v);
    s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  if (xy.length > 1) {
    const d = smoothPath(xy);
    s += `<path d="${d} L${xy[xy.length - 1][0]},${H - B} L${xy[0][0]},${H - B} Z" fill="url(#${id})"/><path class="line" d="${d}"/>`;
  }
  p.forEach((x, i) => { s += `<circle class="dot ${x.f}" cx="${xy[i][0]}" cy="${xy[i][1]}" r="${i === p.length - 1 ? 6 : 4.5}"><title>${fmtDate(x.d)}: ${x.v} ${esc(x.u || '')}</title></circle>`; });
  const lp = xy[xy.length - 1];
  s += `<text class="val" x="${Math.min(lp[0], W - R - 4)}" y="${lp[1] - 12}" text-anchor="end">${p[p.length - 1].v}</text>`;
  s += `<text x="${xy[0][0]}" y="${H - 10}" text-anchor="${p.length > 1 ? 'start' : 'middle'}">${fmtDate(p[0].d)}</text>`;
  if (p.length > 1) s += `<text x="${lp[0]}" y="${H - 10}" text-anchor="end">${fmtDate(p[p.length - 1].d)}</text>`;
  return s + '</svg>';
}
function spark(pts) {
  const v = pts.map(x => num(x.value)).filter(x => x !== null);
  if (v.length < 2) return '<svg class="spark" viewBox="0 0 120 36" aria-hidden="true"><circle cx="110" cy="18" r="4"/></svg>';
  const lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 36;
  const xy = v.map((y, i) => [+(6 + i / (v.length - 1) * (W - 12)).toFixed(1), +(hi === lo ? H / 2 : 6 + (hi - y) / (hi - lo) * (H - 12)).toFixed(1)]);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${smoothPath(xy)}"/><circle cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="4"/></svg>`;
}

// ---------- карточки ----------
const app = $('#app');
const fileLinks = files => ((files || []).length ? `<div class="files">${files.map(f => `<a class="file" data-act="open-file" data-id="${f.id}">${ic('clip')}${esc(f.name)}</a>`).join('')}</div>` : '');
const nextBadge = r => (r.nextDate ? `<span class="pill ${r.nextDate < today() ? 'high' : 'plain'}">Контроль ${fmtDate(r.nextDate)}</span>` : '');
const cardBtns = (kind, id) => `<div class="btns"><button class="round sm" data-act="edit-${kind}" data-id="${id}" aria-label="Изменить" title="Изменить">${ic('edit')}</button><button class="round sm" data-act="del-${kind}" data-id="${id}" aria-label="Удалить" title="Удалить">${ic('trash')}</button></div>`;
const block = (title, text) => (text ? `<h4>${title}</h4><p class="note">${esc(text)}</p>` : '');
const recHead = (icon, tint, title, sub, btns) => `<div class="rec-head"><span class="ico ${tint}">${ic(icon)}</span><div class="rec-title"><h3>${title}</h3><div class="muted">${sub}</div></div>${btns}</div>`;

function resultsTable(a) {
  if (!(a.results || []).length) return '';
  return `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th></tr></thead><tbody>${a.results.map(r => {
    const f = flag(r);
    return `<tr><td><a href="#/indicators/${enc(key(r.name))}">${esc(r.name)}</a></td><td class="v ${f}">${esc(r.value)} <small>${unitHtml(r.unit)}</small></td><td class="muted">${esc(rangeText(r))}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function analysisCard(a) {
  const bad = (a.results || []).filter(r => ['low', 'high'].includes(flag(r))).length;
  return `<article class="card">${recHead('drop', 'sky', `Анализ от ${fmtDate(a.date)}`, `${esc(a.lab || 'Лаборатория не указана')}${bad ? `, вне нормы: ${bad}` : ''} ${nextBadge(a)}`, cardBtns('analysis', a.id))}
    ${resultsTable(a)}${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}${fileLinks(a.files)}</article>`;
}
function studyCard(s) {
  return `<article class="card">${recHead('scan', 'lilac', `<a href="#/studies/${enc(studyKey(s))}">${esc(studyTitle(s))}</a>`, `${fmtDate(s.date)}${s.clinic ? ', ' + esc(s.clinic) : ''}${s.doctor ? ', ' + esc(s.doctor) : ''} ${nextBadge(s)}`, cardBtns('study', s.id))}
    ${conclHtml(studyText(s).conclusion)}${paramsHtml(studyParams(s))}${studyText(s).recs ? `<h4>Рекомендации</h4>${listHtml(studyText(s).recs)}` : ''}${medChips(s.id)}
    ${s.description ? `<details><summary>Полный текст протокола</summary><p class="note">${esc(s.description)}</p></details>` : ''}${fileLinks(s.files)}</article>`;
}
const visitType = c => `${c.kind || 'Консультация'}${c.specialty ? ', ' + c.specialty.toLowerCase() : ''}`;
function conclusionCard(c) {
  return `<article class="card">${recHead('doc', 'green', esc(visitType(c)), `<span class="pill plain">${fmtDate(c.date)}</span> ${esc([c.doctor, c.clinic].filter(Boolean).join(', '))} ${nextBadge(c)}`, cardBtns('conclusion', c.id))}
    ${c.diagnosis ? `<div class="concl dx"><span>Диагноз</span><p>${esc(c.diagnosis)}</p></div>` : ''}${conclHtml(c.text)}${c.recs ? `<h4>Рекомендации</h4>${listHtml(c.recs)}` : ''}${medChips(c.id)}${fileLinks(c.files)}</article>`;
}
// заключение из исследования — для общего раздела «Заключения»
function studyConclCard(s) {
  return `<article class="card">${recHead('scan', 'lilac', esc(studyTitle(s)), `<span class="pill plain">${fmtDate(s.date)}</span> ${esc([s.doctor, s.clinic].filter(Boolean).join(', '))}`, `<div class="btns"><a class="round sm" href="#/studies/${enc(studyKey(s))}" aria-label="Открыть исследование" title="Открыть исследование">${ic('right')}</a></div>`)}
    ${conclHtml(studyText(s).conclusion)}${studyText(s).recs ? `<h4>Рекомендации</h4>${listHtml(studyText(s).recs)}` : ''}${fileLinks(s.files)}</article>`;
}

// ---------- контроль (что и когда повторить) ----------
function upcoming() {
  const out = [];
  analyses.forEach(a => a.nextDate && out.push({ date: a.nextDate, label: 'Повторить анализы' + (a.lab ? ` (${a.lab})` : ''), store: 'analyses', id: a.id }));
  studies.forEach(s => s.nextDate && out.push({ date: s.nextDate, label: studyTitle(s), store: 'studies', id: s.id }));
  conclusions.forEach(c => c.nextDate && out.push({ date: c.nextDate, label: 'Приём: ' + (c.specialty || 'врач'), store: 'conclusions', id: c.id }));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportIcs() {
  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const ev = upcoming().map(u => `BEGIN:VEVENT\r\nUID:${u.id}@med-tracker\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${u.date.replace(/-/g, '')}\r\nSUMMARY:${u.label.replace(/[,;\\]/g, ' ')}\r\nEND:VEVENT`).join('\r\n');
  downloadBlob(new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//med-tracker//RU\r\n${ev}\r\nEND:VCALENDAR\r\n`], { type: 'text/calendar' }), 'kontrol.ics');
}

// ---------- представления ----------
const uploadBtn = (cls = 'primary', text = 'Загрузить сканы') => `<label class="btn ${cls}">${ic('up')}${text}<input type="file" class="scan-input" multiple accept="image/*,application/pdf" hidden></label>`;
const pageHead = (title, sub = '') => `<div class="page-head"><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div>`;

function backupDue() {
  if (store.get('auto') === 'off' || !hasData()) return false;
  const now = Date.now();
  return now - (+store.get('lastFile') || 0) > WEEK && now > (+store.get('snooze') || 0);
}

function viewHome() {
  const sm = seriesMap();
  const series = [...sm.values()].map(s => ({ ...s, last: s.pts[s.pts.length - 1] }));
  const bad = series.filter(x => ['low', 'high'].includes(flag(x.last)));
  const tiles = [...bad, ...series.filter(x => !bad.includes(x)).sort((a, b) => byDateDesc(a.last, b.last))].slice(0, 6);
  const up = upcoming();
  const recent = [
    ...analyses.map(a => ({ date: a.date, html: analysisCard(a) })),
    ...studies.map(s => ({ date: s.date, html: studyCard(s) })),
    ...conclusions.map(c => ({ date: c.date, html: conclusionCard(c) })),
  ].sort(byDateDesc).slice(0, 3);
  const dateLine = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const stat = (href, tint, icon, n, label) => `<a class="stat ${tint}" href="${href}"><span class="ico white">${ic(icon)}</span><b>${n}</b><span>${label}</span></a>`;
  app.innerHTML = `<div class="page-head hero"><p class="muted cap">${dateLine}</p><h2>${bad.length ? `Вне нормы: ${bad.length} из ${series.length}` : series.length ? 'Все показатели в норме' : 'Соберите здесь свои анализы'}</h2></div>
  ${backupDue() ? `<div class="banner cream"><div><b>Пора сохранить резервную копию</b><div class="muted">${+store.get('lastFile') ? 'Прошла неделя с прошлой копии.' : 'Копии в файл ещё не было.'} Файл пригодится, если данные браузера сотрутся.</div></div><div class="btns"><button class="primary" data-act="export">Сохранить</button><button data-act="snooze">Позже</button></div></div>` : ''}
  ${inbox.length ? `<a class="banner sky" href="#/scans"><b>Сканы ждут проверки: ${inbox.length}</b>${ic('right')}</a>` : ''}
  <div class="stats">${stat('#/analyses', 'sky', 'drop', analyses.length, 'анализы')}${stat('#/indicators', 'green', 'pulse', sm.size, 'показатели')}${stat('#/studies', 'lilac', 'scan', studies.length, 'исследования')}${stat('#/conclusions', 'cream', 'doc', conclusions.length, 'заключения')}</div>
  <div class="toolbar">${uploadBtn()}<button data-act="add-analysis">${ic('plus')}Анализ</button><button data-act="add-study">${ic('plus')}Исследование</button><button data-act="add-conclusion">${ic('plus')}Заключение</button></div>
  ${tiles.length ? `<div class="sec-head"><h3>Показатели</h3><a href="#/indicators">Все</a></div><div class="tiles">${tiles.map(s => {
    const f = flag(s.last);
    return `<a class="tile ${f}" href="#/indicators/${enc(key(s.name))}"><span class="t-name">${esc(s.name)}</span><span class="t-val">${esc(s.last.value)}<small>${unitHtml(s.last.unit)}</small></span>${spark(s.pts)}<span class="t-foot">${pill(f) || `<span class="muted">${fmtDate(s.last.date)}</span>`}</span></a>`;
  }).join('')}</div>` : ''}
  ${meds.some(m => m.active !== false) ? `<a class="banner lilac" href="#/meds"><span><b>Лекарства сейчас: ${meds.filter(m => m.active !== false).length}</b><span class="muted"> ${esc(meds.filter(m => m.active !== false).slice(0, 3).map(m => m.name).join(', '))}</span></span>${ic('right')}</a>` : ''}
  ${up.length ? `<div class="card teal"><div class="sec-head"><h3>${ic('cal')}Контроль</h3><button class="sm" data-act="ics">В календарь</button></div><ul class="plain">${up.map(u => `<li><span class="when ${u.date < today() ? 'late' : ''}">${fmtDate(u.date)}</span><span>${esc(u.label)}${u.date < today() ? ', просрочено' : ''}</span><button class="sm" data-act="done-next" data-id="${u.store}:${u.id}">Готово</button></li>`).join('')}</ul></div>` : ''}
  <div class="sec-head"><h3>Последние записи</h3><a href="#/timeline">Хронология</a></div>${recent.map(x => x.html).join('') || '<div class="empty">Загрузите скан или добавьте запись вручную: появятся графики и сводка.</div>'}`;
}

function viewMore() {
  const item = (href, tint, icon, title, sub) => `<a class="more ${tint}" href="${href}"><span class="ico white">${ic(icon)}</span><b>${title}</b><span class="muted">${sub}</span></a>`;
  app.innerHTML = `${pageHead('Разделы')}<div class="more-grid">
    ${item('#/indicators', 'green', 'pulse', 'Показатели', 'Графики и динамика')}
    ${item('#/conclusions', 'cream', 'doc', 'Заключения', 'Врачи и исследования')}
    ${item('#/meds', 'lilac', 'pill', 'Лекарства', meds.filter(m => m.active !== false).length ? `Назначено сейчас: ${meds.filter(m => m.active !== false).length}` : 'Назначения врачей')}
    ${item('#/timeline', 'sky', 'clock', 'Хронология', 'Вся история по годам')}
    ${item('#/summary', 'green', 'file', 'Сводка для врача', 'Одна страница для приёма')}
    ${item('#/scans', 'sky', 'up', 'Сканы', inbox.length ? `Ждут проверки: ${inbox.length}` : 'Загрузка и распознавание')}
    ${item('#/data', 'cream', 'shield', 'Копии и настройки', 'Резервные копии, тема')}</div>`;
}

const KIND = { analysis: 'Анализ', study: 'Исследование', visit: 'Заключение врача' };
function draftCard(d) {
  const status = { queued: 'В очереди на распознавание', processing: 'Распознаётся…', ready: 'Готово к проверке', error: 'Текст не распознан, заполните вручную' }[d.status];
  let body = '';
  if (d.status === 'processing') body = `<progress id="prog-${d.id}" max="1" value="0"></progress>`;
  if (d.status === 'ready' || d.status === 'error') {
    const p = d.parsed || {};
    const hint = d.kind ? `Похоже на ${{ analysis: 'анализ', study: 'исследование', visit: 'заключение врача' }[d.kind]}${p.date ? ' от ' + fmtDate(p.date) : ', дата не найдена'}${d.kind === 'analysis' ? `, показателей: ${p.results.length}` : ''}` : 'Тип документа не определён, выберите сами';
    body = `<p class="muted">${d.status === 'error' ? esc(d.error || '') : hint}</p><div class="chips"><span class="muted">Сохранить как</span>
      ${Object.keys(KIND).map(k => `<button class="sm ${d.kind === k ? 'primary' : ''}" data-act="draft-${k}" data-id="${d.id}">${KIND[k]}</button>`).join('')}</div>`;
  }
  return `<article class="card">${recHead('file', 'sky', `<a data-act="open-file" data-id="${d.fileId}">${esc(d.name)}</a>`, status, `<div class="btns"><button class="round sm" data-act="del-draft" data-id="${d.id}" aria-label="Удалить" title="Удалить">${ic('trash')}</button></div>`)}${body}</article>`;
}
function viewScans() {
  app.innerHTML = `${pageHead('Сканы', 'Распознавание идёт на вашем устройстве, файлы никуда не отправляются.')}
  <label class="drop" id="drop"><span class="ico white">${ic('up')}</span><b>Выберите или перетащите файлы</b><span class="muted">Фото, сканы, PDF. Можно сразу много, в том числе старые: дата берётся из документа.</span>
    <input type="file" class="scan-input" multiple accept="image/*,application/pdf" hidden></label>
  ${inbox.map(draftCard).join('') || '<div class="empty">Нет сканов, ожидающих проверки.</div>'}`;
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addScans(e.dataTransfer.files); });
}

function listView(title, items, card, toolbar, searchText, emptyText, extra = '') {
  app.innerHTML = `${pageHead(title)}<div class="toolbar"><input type="search" id="q" placeholder="Поиск" aria-label="Поиск">${toolbar}</div>${extra}<div id="list"></div>`;
  const draw = () => {
    const q = key($('#q').value);
    const f = items.filter(x => !q || key(searchText(x)).includes(q));
    $('#list').innerHTML = f.map(card).join('') || `<div class="empty">${items.length ? 'Ничего не найдено.' : emptyText}</div>`;
  };
  $('#q').addEventListener('input', draw);
  draw();
}
const viewAnalyses = () => listView('Анализы', analyses, analysisCard, `<button class="primary" data-act="add-analysis">${ic('plus')}Анализ</button>`,
  a => [fmtDate(a.date), a.lab, a.note, ...(a.results || []).map(r => r.name)].join(' '), 'Анализов пока нет. Загрузите скан кнопкой «+» или добавьте вручную.');
function viewConclusions(param) {
  const all = [
    ...conclusions.map(c => ({ k: 'visit', date: c.date, html: conclusionCard(c), text: [fmtDate(c.date), visitType(c), c.doctor, c.clinic, c.diagnosis, c.text, c.recs].join(' ') })),
    ...studies.filter(s => s.conclusion).map(s => ({ k: 'study', date: s.date, html: studyConclCard(s), text: [fmtDate(s.date), studyTitle(s), s.doctor, s.clinic, s.conclusion, s.recs].join(' ') })),
  ].filter(x => !param || x.k === param).sort(byDateDesc);
  const chips = [['', 'Все'], ['visit', 'Врачи'], ['study', 'Исследования']];
  listView('Заключения', all, x => x.html, `<button class="primary" data-act="add-conclusion">${ic('plus')}Заключение</button>`, x => x.text,
    'Заключений пока нет. Сюда попадают заключения врачей и выводы из УЗИ, МРТ и других исследований.',
    `<div class="chips">${chips.map(([k, t]) => `<a class="btn sm ${param === k ? 'primary' : ''}" href="#/conclusions${k ? '/' + k : ''}">${t}</a>`).join('')}</div>`);
}

// ---------- лекарства ----------
function medCard(m) {
  const on = m.active !== false;
  return `<article class="med ${on ? '' : 'done'}"><span class="ico ${on ? 'cream' : 'white'}">${ic('pill')}</span><div class="med-main"><h3>${esc(m.name)} ${m.dose ? `<span class="pill plain">${esc(m.dose)}</span>` : ''}</h3>
    ${m.schedule ? `<p>${esc(m.schedule)}</p>` : ''}<div class="muted">${esc([m.source, m.date ? 'назначено ' + fmtDate(m.date) : ''].filter(Boolean).join(', '))}</div>${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}</div>
    <div class="btns"><button class="sm" data-act="toggle-med" data-id="${m.id}">${on ? 'Завершить' : 'Вернуть'}</button><button class="round sm" data-act="edit-med" data-id="${m.id}" aria-label="Изменить" title="Изменить">${ic('edit')}</button><button class="round sm" data-act="del-med" data-id="${m.id}" aria-label="Удалить" title="Удалить">${ic('trash')}</button></div></article>`;
}
function viewMeds() {
  const on = meds.filter(m => m.active !== false), off = meds.filter(m => m.active === false);
  app.innerHTML = `${pageHead('Лекарства', 'Назначения из заключений врачей и то, что вы добавили сами. Это список для памяти, а не рекомендация: схему приёма определяет врач.')}
  <div class="toolbar"><button class="primary" data-act="add-med">${ic('plus')}Лекарство</button></div>
  ${on.length ? `<div class="sec-head"><h3>Назначено сейчас</h3><span class="muted">${on.length}</span></div>${on.map(medCard).join('')}` : ''}
  ${off.length ? `<div class="sec-head"><h3>Завершённые</h3><span class="muted">${off.length}</span></div>${off.map(medCard).join('')}` : ''}
  ${meds.length ? '' : '<div class="empty">Лекарств пока нет. Они появятся из рекомендаций в заключениях или добавьте вручную.</div>'}`;
}
function medForm(m) {
  m = m || { name: '', dose: '', schedule: '', date: today(), source: '', note: '', active: true };
  openDialog(`<h2>${m.id ? 'Лекарство' : 'Новое лекарство'}</h2>
    <label>Название<input name="name" required value="${esc(m.name)}"></label>
    <div class="two"><label>Дозировка<input name="dose" value="${esc(m.dose)}" placeholder="50 мкг"></label><label>Когда назначено<input type="date" name="date" value="${esc(m.date)}"></label></div>
    <label>Как принимать<input name="schedule" value="${esc(m.schedule)}" placeholder="1 раз в день утром, 2 месяца"></label>
    <label>Кто назначил<input name="source" value="${esc(m.source)}" placeholder="Эндокринолог"></label>
    <label>Заметка<textarea name="note" rows="2">${esc(m.note)}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${m.active !== false ? 'checked' : ''}> Принимаю сейчас</label>${actionsRow}`,
  async f => {
    const g = n => f.elements[n].value.trim();
    await DB.put('meds', { ...m, id: m.id || uid(), name: g('name'), dose: g('dose'), schedule: g('schedule'), date: f.elements.date.value, source: g('source'), note: g('note'), active: f.elements.active.checked });
  });
}
function medRow(m = {}) {
  return `<div class="row r3 medrow">
    <input name="name" placeholder="Лекарство" aria-label="Лекарство" value="${esc(m.name)}">
    <input name="dose" placeholder="Доза" aria-label="Дозировка" value="${esc(m.dose)}">
    <input name="schedule" placeholder="Как принимать" aria-label="Как принимать" value="${esc(m.schedule)}">
    <button type="button" class="round sm" data-rm aria-label="Убрать строку" title="Убрать строку">×</button></div>`;
}
const medsBlock = list => `<div class="muted">Назначенные лекарства</div><div id="medrows">${(list.length ? list : [{}]).map(medRow).join('')}</div>
  <button type="button" class="sm" data-addmed>${ic('plus')}Лекарство</button>`;
// лекарства из формы записи → в общий список, со ссылкой на запись
async function syncMeds(form, rec, source) {
  const rows = readRows(form, '#medrows .row', ['name', 'dose', 'schedule']).filter(r => r.name);
  const old = (await DB.all('meds')).filter(m => m.sourceId === rec.id);
  for (const o of old) if (!rows.some(r => key(r.name) === key(o.name))) await DB.del('meds', o.id);
  for (const r of rows) {
    const o = old.find(x => key(x.name) === key(r.name));
    await DB.put('meds', { id: o ? o.id : uid(), active: o ? o.active : true, note: o ? o.note : '', ...r, date: rec.date, source, sourceId: rec.id });
  }
}
// один раз проходим по уже сохранённым записям и собираем из рекомендаций лекарства
async function collectMedsOnce() {
  if (store.get('medsScan')) return;
  const have = new Set(meds.map(m => m.sourceId));
  const put = async (rec, text, source) => {
    if (have.has(rec.id)) return;
    for (const r of parseMeds(text)) await DB.put('meds', { id: uid(), active: true, note: '', ...r, date: rec.date, source, sourceId: rec.id });
  };
  for (const c of conclusions) await put(c, [c.recs, c.text].join('\n'), c.specialty || 'Врач');
  for (const st of studies) await put(st, st.recs, studyTitle(st));
  store.set('medsScan', '1');
}

function viewIndicators(param) {
  const sm = seriesMap();
  const list = [...sm.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!list.length) { app.innerHTML = `${pageHead('Показатели')}<div class="empty">Сначала добавьте анализ.</div>`; return; }
  const cur = sm.get(param) || list[0];
  const last = cur.pts[cur.pts.length - 1], prev = cur.pts[cur.pts.length - 2], f = flag(last);
  const rows = cur.pts.map((r, i) => ({ r, prev: cur.pts[i - 1] })).reverse();
  app.innerHTML = `${pageHead('Показатели')}
  <div class="toolbar"><select id="ind" aria-label="Показатель">${list.map(s => `<option value="${esc(key(s.name))}" ${s === cur ? 'selected' : ''}>${esc(s.name)} (${s.pts.length})</option>`).join('')}</select><button data-act="print">Печать</button></div>
  <div class="card feature ${f}"><div class="feature-head"><div><div class="muted">${esc(cur.name)}, ${fmtDate(last.date)}</div><div class="big">${esc(last.value)}<small>${unitHtml(last.unit)}</small></div></div>
    <div class="feature-side">${pill(f)}${rangeText(last) ? `<span class="muted">Норма ${esc(rangeText(last))}</span>` : ''}${prev ? `<span class="muted">${deltaText(last.value, prev.value)}</span>` : ''}</div></div>${chart(cur.pts)}</div>
  <div class="card"><table><thead><tr><th>Дата</th><th>Значение</th><th>Изменение</th><th>Норма</th></tr></thead><tbody>${rows.map(({ r, prev: pr }) => {
    const fl = flag(r);
    return `<tr><td>${fmtDate(r.date)}</td><td class="v ${fl}">${esc(r.value)} <small>${unitHtml(r.unit)}</small></td><td class="muted">${pr ? deltaText(r.value, pr.value) : ''}</td><td class="muted">${esc(rangeText(r))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  $('#ind').addEventListener('change', e => { location.hash = '#/indicators/' + enc(e.target.value); });
}

function viewStudies(param) {
  const sm = studySeries();
  const cur = sm.get(param);
  if (!cur) {
    const groups = [...sm.values()].sort((a, b) => byDateDesc(a.items[a.items.length - 1], b.items[b.items.length - 1]));
    listView('Исследования', groups, g => {
      const last = g.items[g.items.length - 1];
      return `<a class="card link" href="#/studies/${enc(g.key)}">${recHead('scan', 'lilac', esc(g.title), `Последнее ${fmtDate(last.date)}, всего ${g.items.length}`, ic('right'))}${last.conclusion ? `<p class="note clip">${esc(studyText(last).conclusion)}</p>` : ''}</a>`;
    }, `<button class="primary" data-act="add-study">${ic('plus')}Исследование</button>`,
    g => [g.title, ...g.items.map(s => [s.conclusion, s.clinic, s.doctor, fmtDate(s.date)].join(' '))].join(' '), 'Исследований пока нет. УЗИ, МРТ, рентген и другие собираются здесь по видам.');
    return;
  }
  const items = cur.items;
  const P = items.map(studyParams);
  const names = new Map();
  P.forEach(list => list.forEach(m => { if (m.name && !names.has(key(m.name))) names.set(key(m.name), m.name); }));
  const cell = (i, k) => P[i].find(x => key(x.name) === k);
  const charts = [...names.entries()].map(([k, name]) => {
    const pts = items.map((s, i) => { const m = cell(i, k); return m && !/[×x]/.test(m.value) && { date: s.date, value: m.value, unit: m.unit }; }).filter(Boolean);
    return pts.filter(p => num(p.value) !== null).length >= 2 ? `<div class="card"><h3>${esc(name)}${pts[0].unit ? ', ' + esc(pts[0].unit) : ''}</h3>${chart(pts)}</div>` : '';
  }).join('');
  const matrix = items.length > 1 && names.size ? `<div class="card"><h3>Динамика параметров</h3><p class="muted">Цветом отмечено то, что изменилось по сравнению с предыдущим исследованием.</p>
    <table class="matrix"><thead><tr><th>Параметр</th>${items.map(s => `<th>${fmtDate(s.date)}</th>`).join('')}</tr></thead><tbody>${[...groupParams([...names.values()].map(n => ({ name: n }))).entries()].map(([g, list]) => `${g ? `<tr class="org"><td colspan="${items.length + 1}">${esc(g)}</td></tr>` : ''}${list.map(({ label, m: nm }) => { const k = key(nm.name); return `<tr><td>${esc(label)}</td>${items.map((s, i) => {
      const m = cell(i, k), prev = i ? cell(i - 1, k) : null;
      const chg = m && prev && key(m.value) !== key(prev.value);
      return `<td class="${chg ? 'chg' : ''}">${m ? `<b>${esc(m.value)}</b> <small>${esc(m.unit)}</small>${chg && num(m.value) !== null && num(prev.value) !== null && !/[×x]/.test(m.value) ? `<div class="muted">${deltaText(m.value, prev.value)}</div>` : ''}` : '<span class="muted">нет</span>'}</td>`;
    }).join('')}</tr>`; }).join('')}`).join('')}
    <tr class="org"><td colspan="${items.length + 1}">Заключение</td></tr><tr><td></td>${items.map(s => `<td>${esc(studyText(s).conclusion)}</td>`).join('')}</tr></tbody></table></div>` : '';
  app.innerHTML = `${pageHead(esc(cur.title))}
  <div class="toolbar"><a class="btn" href="#/studies">Все исследования</a><button class="primary" data-act="add-study" data-id="${esc(cur.key)}">${ic('plus')}Добавить</button><button data-act="print">Печать</button></div>
  ${items.length > 1 ? '' : '<p class="muted">Когда исследований этого вида станет два и больше, здесь появятся динамика параметров и графики.</p>'}
  ${matrix}${charts}<div class="sec-head"><h3>Все исследования</h3></div>${[...items].reverse().map(studyCard).join('')}`;
}

function viewTimeline(param) {
  const all = [
    ...analyses.map(a => ({ k: 'analysis', date: a.date, icon: 'drop', tint: 'sky', title: 'Анализы' + (a.lab ? ', ' + a.lab : ''), sub: `показателей: ${(a.results || []).length}`, html: analysisCard(a) })),
    ...studies.map(s => ({ k: 'study', date: s.date, icon: 'scan', tint: 'lilac', title: studyTitle(s), sub: studyText(s).conclusion, html: studyCard(s) })),
    ...conclusions.map(c => ({ k: 'visit', date: c.date, icon: 'doc', tint: 'green', title: c.specialty || 'Врач', sub: c.diagnosis || c.text || '', html: conclusionCard(c) })),
  ].filter(x => !param || x.k === param).sort(byDateDesc);
  const chips = [['', 'Всё'], ['analysis', 'Анализы'], ['study', 'Исследования'], ['visit', 'Заключения']];
  let html = `${pageHead('Хронология')}<div class="chips">${chips.map(([k, t]) => `<a class="btn sm ${param === k ? 'primary' : ''}" href="#/timeline${k ? '/' + k : ''}">${t}</a>`).join('')}</div>`;
  let year = '';
  all.forEach(x => {
    const y = (x.date || '').slice(0, 4) || 'Без даты';
    if (y !== year) { year = y; html += `<h3 class="year">${y}</h3>`; }
    html += `<details class="tl"><summary><span class="ico ${x.tint}">${ic(x.icon)}</span><span class="tl-main"><b>${esc(x.title)}</b><span class="muted clip1">${esc(x.sub)}</span></span><span class="tl-date">${fmtDate(x.date).slice(0, 5)}</span></summary>${x.html}</details>`;
  });
  app.innerHTML = html + (all.length ? '' : '<div class="empty">Записей пока нет.</div>');
}

function viewSummary(param) {
  const periods = { 3: '3 месяца', 6: '6 месяцев', 12: '12 месяцев', 0: 'всё время' };
  const m = param in periods ? +param : 12;
  let from = '';
  if (m) { const d = new Date(); d.setMonth(d.getMonth() - m); from = isoLocal(d); }
  const inP = x => !from || (x.date || '') >= from;
  const isOk = x => flag(x.last) === 'ok' || !flag(x.last);
  const rows = [...seriesMap().values()].map(s => {
    const idx = s.pts.map((p, i) => (inP(p) ? i : -1)).filter(i => i >= 0).pop();
    return idx === undefined ? null : { name: s.name, last: s.pts[idx], prev: s.pts[idx - 1] };
  }).filter(Boolean).sort((a, b) => isOk(a) - isOk(b) || a.name.localeCompare(b.name, 'ru'));
  const st = studies.filter(inP), cs = conclusions.filter(inP);
  app.innerHTML = `${pageHead('Сводка для врача', `Составлено ${fmtDate(today())}${from ? `, период с ${fmtDate(from)}` : ''}. Сначала идут показатели вне нормы.`)}
  <div class="toolbar"><select id="per" aria-label="Период">${Object.entries(periods).map(([k, t]) => `<option value="${k}" ${+k === m ? 'selected' : ''}>За ${t}</option>`).join('')}</select><button class="primary" data-act="print">Печать или PDF</button></div>
  <div class="card"><h3>Анализы: последние значения</h3>${rows.length ? `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th><th>Дата</th><th>Было</th><th>Изменение</th></tr></thead><tbody>${rows.map(x => {
    const f = flag(x.last);
    return `<tr><td>${esc(x.name)}</td><td class="v ${f}">${esc(x.last.value)} <small>${unitHtml(x.last.unit)}</small></td><td class="muted">${esc(rangeText(x.last))}</td><td class="muted">${fmtDate(x.last.date)}</td><td class="muted">${x.prev ? `${esc(x.prev.value)} (${fmtDate(x.prev.date)})` : ''}</td><td class="muted">${x.prev ? deltaText(x.last.value, x.prev.value) : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">Нет анализов за период.</p>'}</div>
  <div class="card"><h3>Исследования</h3>${st.map(s => `<p><b>${fmtDate(s.date)}, ${esc(studyTitle(s))}</b><br><span class="note">${esc(studyText(s).conclusion || 'заключение не указано')}</span></p>`).join('') || '<p class="muted">Нет исследований за период.</p>'}</div>
  <div class="card"><h3>Заключения врачей</h3>${cs.map(c => `<p><b>${fmtDate(c.date)}, ${esc(visitType(c))}</b>${c.diagnosis ? `<br>Диагноз: <span class="note">${esc(c.diagnosis)}</span>` : ''}${c.recs ? `<br>Рекомендации: <span class="note">${esc(c.recs)}</span>` : ''}</p>`).join('') || '<p class="muted">Нет заключений за период.</p>'}</div>`;
  const on = meds.filter(x => x.active !== false);
  if (on.length) app.insertAdjacentHTML('beforeend', `<div class="card"><h3>Лекарства сейчас</h3><table><tbody>${on.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.dose || '')}</td><td>${esc(x.schedule || '')}</td><td class="muted">${esc(x.source || '')}</td></tr>`).join('')}</tbody></table></div>`);
  $('#per').addEventListener('change', e => { location.hash = '#/summary/' + e.target.value; });
}

function viewData() {
  const auto = store.get('auto') !== 'off', lastFile = +store.get('lastFile') || 0, theme = store.get('theme') || 'light';
  const count = b => ['analyses', 'studies', 'conclusions'].reduce((n, s) => n + (b[s] || []).length, 0);
  app.innerHTML = `${pageHead('Копии и настройки')}
  <div class="card"><h3>Копия в файл</h3><p class="muted">Файл содержит все записи и сканы. Храните его в «Файлах» или в облаке: он спасёт данные, если браузер их сотрёт, и переносит их на другое устройство. ${lastFile ? `Последняя копия: ${fmtStamp(lastFile)}.` : 'Копии в файл ещё не было.'}</p>
    <div class="toolbar"><button class="primary" data-act="export">Сохранить копию</button><label class="btn">Восстановить из файла<input type="file" id="imp" accept="application/json,.json" hidden></label></div></div>
  <div class="card"><h3>Автокопии раз в неделю</h3>
    <label class="check"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}> Делать точку восстановления каждую неделю и напоминать о копии в файл</label>
    <p class="muted">Точки восстановления хранятся внутри приложения и помогают откатить случайные правки и удаления. Хранятся пять последних.</p>
    ${backups.length ? `<ul class="plain">${backups.map(b => `<li><span>${fmtStamp(b.at)}</span><span class="muted">${b.auto ? 'авто' : b.note || 'вручную'}, записей: ${count(b)}</span><button class="sm" data-act="restore" data-id="${b.id}">Вернуть</button></li>`).join('')}</ul>` : '<p class="muted">Точек восстановления пока нет.</p>'}
    <button data-act="snapshot">Создать точку сейчас</button></div>
  <div class="card"><h3>Оформление</h3><div class="chips">${[['light', 'Светлое'], ['dark', 'Тёмное'], ['auto', 'Как в системе']].map(([k, t]) => `<button class="sm ${theme === k ? 'primary' : ''}" data-act="theme" data-id="${k}">${t}</button>`).join('')}</div></div>
  <div class="card"><h3>Где хранятся данные</h3><p class="muted">Записи и сканы лежат только в этом браузере на этом устройстве, распознавание тоже идёт здесь. На GitHub находится лишь код приложения. Обновление приложения записи не затрагивает.</p>
    <button class="danger" data-act="wipe">Удалить все данные</button></div>`;
  $('#imp').addEventListener('change', e => e.target.files[0] && importData(e.target.files[0]));
  $('#auto').addEventListener('change', e => store.set('auto', e.target.checked ? 'on' : 'off'));
}

// ---------- формы ----------
const dlg = $('#dlg');
let dlgUrls = [];
dlg.addEventListener('close', () => { dlgUrls.forEach(u => URL.revokeObjectURL(u)); dlgUrls = []; });

function openDialog(html, onSubmit, preview = '') {
  dlg.className = preview ? 'wide' : '';
  dlg.innerHTML = `<form>${preview ? `<div class="review">${preview}<div>${html}</div></div>` : html}</form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await onSubmit(form); await gc(); dlg.close(); await load(); render(); } catch (err) { alert('Не удалось сохранить: ' + err.message); }
  });
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.showModal();
  dlg.scrollTop = 0;
  return form;
}
async function draftPreview(d) {
  if (!d) return '';
  const f = await DB.get('files', d.fileId);
  let media = `<a class="file" data-act="open-file" data-id="${d.fileId}">${ic('clip')}Открыть ${esc(d.name)}</a>`;
  if (f && (f.type || '').startsWith('image/')) { const url = URL.createObjectURL(f.blob); dlgUrls.push(url); media = `<a href="${url}" target="_blank" title="Открыть в полном размере"><img src="${url}" alt="Скан"></a>`; }
  return `<aside class="scan"><p class="hint">Сверьте данные со сканом: распознавание может ошибаться.</p>${media}
    <details><summary>Распознанный текст</summary><pre>${esc(d.text || 'Текст не распознан.')}</pre></details></aside>`;
}
const draftFiles = d => (d ? [{ id: d.fileId, name: d.name }] : []);
const actionsRow = '<div class="actions"><button type="button" data-close>Отмена</button><button class="primary">Сохранить</button></div>';
const dateField = (v, label = 'Дата') => `<label>${label}<input type="date" name="date" required max="${today()}" value="${esc(v)}"></label>`;
const nextField = v => `<label>Контроль: когда повторить или прийти снова<input type="date" name="nextDate" value="${esc(v)}"></label>`;
const filesBlock = files => `${(files || []).length ? `<div class="muted">Файлы (снимите галочку, чтобы убрать)</div>${files.map(f => `<label class="check"><input type="checkbox" name="keep" value="${f.id}" checked> ${esc(f.name)}</label>`).join('')}` : ''}
  <label>Прикрепить файлы<input type="file" name="newfiles" multiple accept="image/*,application/pdf"></label>`;

async function saveFiles(form, old) {
  const keepIds = new Set([...form.querySelectorAll('[name=keep]:checked')].map(x => x.value));
  const kept = (old || []).filter(f => keepIds.has(f.id));
  for (const file of form.elements.newfiles.files) {
    const id = uid();
    await DB.put('files', { id, name: file.name, type: file.type, blob: file });
    kept.push({ id, name: file.name });
  }
  return kept;
}
const readRows = (form, sel, fields) => [...form.querySelectorAll(sel)].map(r => Object.fromEntries(fields.map(n => [n, r.querySelector(`[name=${n}]`).value.trim()])));

function resultRow(r = {}) {
  const w = n => ((r.warn || []).includes(n) ? ' class="sus" title="Проверьте по скану"' : r.fromCatalog && (n === 'min' || n === 'max') ? ' class="cat" title="Норма из справочника"' : '');
  return `<div class="row r5">
    <input name="name" list="catalog" placeholder="Показатель" aria-label="Показатель" value="${esc(r.name)}">
    <input name="value" placeholder="Значение" aria-label="Значение" value="${esc(r.value)}" inputmode="decimal"${w('value')}>
    <input name="unit" placeholder="Ед." aria-label="Единица" value="${esc(r.unit)}"${w('unit')}>
    <input name="min" placeholder="Мин" aria-label="Норма от" value="${esc(r.min)}" inputmode="decimal"${w('min')}>
    <input name="max" placeholder="Макс" aria-label="Норма до" value="${esc(r.max)}" inputmode="decimal"${w('max')}>
    <button type="button" class="round sm" data-rm aria-label="Убрать строку" title="Убрать строку">×</button></div>`;
}
function measureRow(m = {}) {
  return `<div class="row r3">
    <input name="name" list="measures" placeholder="Параметр" aria-label="Параметр" value="${esc(m.name)}">
    <input name="value" placeholder="Значение" aria-label="Значение" value="${esc(m.value)}">
    <input name="unit" placeholder="Ед." aria-label="Единица" value="${esc(m.unit)}">
    <button type="button" class="round sm" data-rm aria-label="Убрать строку" title="Убрать строку">×</button></div>`;
}
function prefill(name) {
  const last = seriesMap().get(key(name));
  if (last) { const p = last.pts[last.pts.length - 1]; return { unit: p.unit, min: p.min, max: p.max }; }
  const c = CATALOG.find(x => key(x.name) === key(name));
  return c ? { unit: c.unit ?? '', min: c.min ?? '', max: c.max ?? '' } : null;
}
function rowEvents(form, rowsEl, makeRow) {
  form.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) rm.closest('.row').remove();
    if (e.target.closest('[data-addrow]')) rowsEl.insertAdjacentHTML('beforeend', makeRow());
    if (e.target.closest('[data-addmed]')) form.querySelector('#medrows').insertAdjacentHTML('beforeend', medRow());
  });
}

async function analysisForm(a, draft) {
  const p = draft && draft.parsed;
  a = a || { date: draft ? (p && p.date) || '' : today(), lab: (p && p.lab) || '', note: '', results: (p && p.results) || [], files: draftFiles(draft) };
  const form = openDialog(`<h2>${a.id ? 'Анализ' : 'Новый анализ'}</h2>
    <div class="two">${dateField(a.date, 'Дата сдачи')}<label>Лаборатория или клиника<input name="lab" value="${esc(a.lab)}"></label></div>
    <div class="muted">Добавить набор</div>
    <div class="chips">${Object.keys(PANELS).map(n => `<button type="button" class="sm" data-panel="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    ${a.results.some(r => r.warn) ? '<p class="hint warn">Жёлтым выделено то, что выглядит подозрительно (например, потерялась запятая). Проверьте по скану.</p>' : ''}
    ${a.results.some(r => r.fromCatalog) ? '<p class="hint">Голубым выделена норма из справочника: в документе её нет. Поправьте, если ваша лаборатория даёт другую.</p>' : ''}
    <div class="row r5 head"><span>Показатель</span><span>Значение</span><span>Ед.</span><span>Мин</span><span>Макс</span><span></span></div>
    <div id="rows">${(a.results.length ? a.results : [{}]).map(resultRow).join('')}</div>
    <button type="button" class="sm" data-addrow>${ic('plus')}Строка</button>
    <label class="mt">Заметка<textarea name="note" rows="2">${esc(a.note)}</textarea></label>
    ${nextField(a.nextDate)}${filesBlock(a.files)}${actionsRow}`,
  async f => {
    const results = readRows(f, '#rows .row', ['name', 'value', 'unit', 'min', 'max']).filter(r => r.name && r.value !== '');
    const files = await saveFiles(f, a.files);
    await DB.put('analyses', { id: a.id || uid(), date: f.elements.date.value, lab: f.elements.lab.value.trim(), note: f.elements.note.value.trim(), nextDate: f.elements.nextDate.value, results, files });
    if (draft) await DB.del('inbox', draft.id);
  }, await draftPreview(draft));
  const rows = $('#rows', form);
  rowEvents(form, rows, resultRow);
  rows.addEventListener('change', e => {
    if (e.target.name !== 'name') return;
    const pf = prefill(e.target.value), row = e.target.closest('.row');
    if (pf && !row.querySelector('[name=unit]').value && !row.querySelector('[name=max]').value) {
      row.querySelector('[name=unit]').value = pf.unit ?? '';
      row.querySelector('[name=min]').value = pf.min ?? '';
      row.querySelector('[name=max]').value = pf.max ?? '';
    }
  });
  form.addEventListener('click', e => {
    if (!e.target.matches('[data-panel]')) return;
    const have = new Set([...rows.querySelectorAll('[name=name]')].map(i => key(i.value)));
    rows.querySelectorAll('.row').forEach(r => { if (!r.querySelector('[name=name]').value.trim() && !r.querySelector('[name=value]').value) r.remove(); });
    PANELS[e.target.dataset.panel].filter(n => !have.has(key(n))).forEach(n => rows.insertAdjacentHTML('beforeend', resultRow({ name: n, ...(prefill(n) || {}) })));
  });
}

async function studyForm(s, draft, seriesKey) {
  const p = draft && draft.parsed;
  const tpl = seriesKey && (studySeries().get(seriesKey) || { items: [] }).items.slice(-1)[0];
  s = s || {
    date: draft ? (p && p.date) || '' : today(), type: (p && p.studyType) || (tpl && tpl.type) || 'УЗИ', area: (p && p.area) || (tpl && tpl.area) || '', clinic: (p && p.clinic) || '', doctor: (p && p.doctor) || '',
    description: (p && (p.body || p.clean)) || (draft && draft.text) || '', conclusion: (p && p.conclusion) || '', recs: (p && p.recs) || '',
    measures: (p && p.measures) || (tpl ? (tpl.measures || []).map(m => ({ name: m.name, value: '', unit: m.unit })) : []), files: draftFiles(draft),
  };
  if (s.id) s = { ...s, ...studyText(s) };
  const isNew = !s.id, params = isNew ? s.measures : studyParams(s), medList = isNew ? (p && p.meds) || [] : medsOf(s.id);
  const areas = [...new Set([...studies.map(x => x.area).filter(Boolean), ...STUDY_AREAS.map(x => x[0])])];
  const mnames = [...new Set(studies.flatMap(x => (x.measures || []).map(m => m.name)).filter(Boolean))];
  const form = openDialog(`<h2>${s.id ? 'Исследование' : 'Новое исследование'}</h2>
    <div class="two">${dateField(s.date, 'Дата исследования')}<label>Вид<select name="type">${STUDY_TYPES.map(([t]) => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <label>Что исследовали (по этому полю записи собираются в динамику)<input name="area" list="areas" value="${esc(s.area)}" placeholder="Щитовидная железа"></label>
    <datalist id="areas">${areas.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="measures">${mnames.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="two"><label>Клиника<input name="clinic" value="${esc(s.clinic)}"></label><label>Врач<input name="doctor" value="${esc(s.doctor)}"></label></div>
    <label>Заключение<textarea name="conclusion" rows="4">${esc(s.conclusion)}</textarea></label>
    <div class="muted">Параметры: размеры, «не выявлено» и другое. Числа попадут на графики</div>
    <div id="rows">${(params.length ? params : [{}]).map(measureRow).join('')}</div>
    <button type="button" class="sm" data-addrow>${ic('plus')}Параметр</button>
    <label class="mt">Рекомендации<textarea name="recs" rows="2">${esc(s.recs)}</textarea></label>
    ${medsBlock(medList)}
    <label class="mt">Полный текст протокола<textarea name="description" rows="4">${esc(s.description)}</textarea></label>
    ${nextField(s.nextDate)}${filesBlock(s.files)}${actionsRow}`,
  async f => {
    const g = n => f.elements[n].value.trim();
    const measures = readRows(f, '#rows .row', ['name', 'value', 'unit']).filter(m => m.name && m.value !== '');
    const files = await saveFiles(f, s.files);
    const rec = { id: s.id || uid(), date: f.elements.date.value, type: f.elements.type.value, area: g('area'), clinic: g('clinic'), doctor: g('doctor'), conclusion: g('conclusion'), recs: g('recs'), description: g('description'), nextDate: f.elements.nextDate.value, measures, files, pv: PARSER_VERSION };
    await DB.put('studies', rec);
    await syncMeds(f, rec, studyTitle(rec));
    if (draft) await DB.del('inbox', draft.id);
  }, await draftPreview(draft));
  rowEvents(form, $('#rows', form), measureRow);
}

async function conclusionForm(c, draft) {
  const p = draft && draft.parsed;
  const medList = c ? medsOf(c.id) : (p && p.meds) || [];
  c = c || { date: draft ? (p && p.date) || '' : today(), kind: (p && p.docKind) || 'Консультация', specialty: (p && p.specialty) || '', doctor: (p && p.doctor) || '', clinic: (p && p.clinic) || '', diagnosis: (p && p.diagnosis) || '', text: (p && (p.conclusion || p.visitText || p.clean)) || (draft && draft.text) || '', recs: (p && p.recs) || '', files: draftFiles(draft) };
  const specs = [...new Set([...conclusions.map(x => x.specialty).filter(Boolean), ...SPECIALTIES.map(x => x[0])])];
  const form = openDialog(`<h2>${c.id ? 'Заключение врача' : 'Новое заключение врача'}</h2>
    <div class="two">${dateField(c.date, 'Дата')}<label>Тип заключения<select name="kind">${['Консультация', 'Осмотр', 'Выписка', 'Справка', 'Другое'].map(t => `<option ${t === (c.kind || 'Консультация') ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="two"><label>Врач<input name="doctor" value="${esc(c.doctor)}"></label><label>Специальность<input name="specialty" list="specs" value="${esc(c.specialty)}" placeholder="Эндокринолог"></label></div>
    <datalist id="specs">${specs.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <label>Клиника<input name="clinic" value="${esc(c.clinic)}"></label>
    <label>Диагноз<textarea name="diagnosis" rows="2">${esc(c.diagnosis)}</textarea></label>
    <label>Заключение<textarea name="text" rows="6">${esc(c.text)}</textarea></label>
    <label>Рекомендации<textarea name="recs" rows="3">${esc(c.recs)}</textarea></label>
    ${medsBlock(medList)}<div class="mt"></div>
    ${nextField(c.nextDate)}${filesBlock(c.files)}${actionsRow}`,
  async f => {
    const g = n => f.elements[n].value.trim();
    const files = await saveFiles(f, c.files);
    const rec = { id: c.id || uid(), date: f.elements.date.value, kind: f.elements.kind.value, specialty: g('specialty'), doctor: g('doctor'), clinic: g('clinic'), diagnosis: g('diagnosis'), text: g('text'), recs: g('recs'), nextDate: f.elements.nextDate.value, files };
    await DB.put('conclusions', rec);
    await syncMeds(f, rec, rec.specialty || 'Врач');
    if (draft) await DB.del('inbox', draft.id);
  }, await draftPreview(draft));
  rowEvents(form, $('#medrows', form), medRow);
}

// ---------- сканы: загрузка и распознавание ----------
const route = () => location.hash.replace(/^#\/?/, '').split('/')[0];
function refreshIfVisible() { if (['', 'scans', 'more'].includes(route())) render(); else updateBadge(); }

async function addScans(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (!files.length) { if (fileList.length) alert('Подходят только изображения и PDF.'); return; }
  for (const file of files) {
    const fileId = uid();
    await DB.put('files', { id: fileId, name: file.name, type: file.type, blob: file });
    await DB.put('inbox', { id: uid(), fileId, name: file.name, type: file.type, addedAt: Date.now() + Math.random(), status: 'queued' });
  }
  await load();
  if (route() !== 'scans') location.hash = '#/scans'; else render();
  processInbox();
}

let processing = false;
async function processInbox() {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const d = (await DB.all('inbox')).filter(x => x.status === 'queued').sort((a, b) => a.addedAt - b.addedAt)[0];
      if (!d) break;
      d.status = 'processing';
      await DB.put('inbox', d); await load(); refreshIfVisible();
      try {
        const f = await DB.get('files', d.fileId);
        const res = await OCR.recognize(f.blob, f.type, v => { const el = document.getElementById('prog-' + d.id); if (el) el.value = v; });
        Object.assign(d, analyzeText(res.text, today(), res.lines), { text: res.text, status: 'ready', pver: PARSER_VERSION });
      } catch (e) {
        Object.assign(d, { status: 'error', error: String((e && e.message) || e), text: '', kind: '', parsed: null });
      }
      if (await DB.get('inbox', d.id)) await DB.put('inbox', d); // могли удалить, пока распознавалось
      await load(); refreshIfVisible();
    }
  } finally { processing = false; }
}

// ---------- резервные копии ----------
async function makeSnapshot(auto, note = '') {
  await DB.put('backups', { id: uid(), at: Date.now(), auto, note, analyses: await DB.all('analyses'), studies: await DB.all('studies'), conclusions: await DB.all('conclusions'), meds: await DB.all('meds') });
  const all = (await DB.all('backups')).sort((a, b) => b.at - a.at);
  for (const old of all.slice(5)) await DB.del('backups', old.id);
  await gc();
}
async function weeklySnapshot() {
  if (store.get('auto') === 'off' || !hasData()) return;
  const lastAuto = backups.find(b => b.auto);
  if (!lastAuto || Date.now() - lastAuto.at > WEEK) { await makeSnapshot(true); await load(); }
}
async function restoreSnapshot(id) {
  const b = await DB.get('backups', id);
  if (!b || !confirm(`Вернуть записи к состоянию на ${fmtStamp(b.at)}? Текущее состояние сохранится как отдельная точка.`)) return;
  await makeSnapshot(false, 'перед возвратом');
  for (const s of RECORDS) { if (!(s in b)) continue; await DB.clear(s); for (const x of b[s]) await DB.put(s, x); }
  await gc(); await load(); render();
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportData() {
  const files = [];
  for (const f of await DB.all('files')) files.push({ id: f.id, name: f.name, type: f.type, data: await blobToDataURL(f.blob) });
  const payload = { app: 'med-tracker', version: 4, exportedAt: new Date().toISOString(), analyses, studies, conclusions, meds, inbox, files };
  const name = `medtracker-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  let saved = true;
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  // на телефоне открываем «Поделиться», чтобы сохранить в «Файлы» или облако
  if (file && /iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name === 'AbortError') saved = false; else downloadBlob(blob, name); }
  } else downloadBlob(blob, name);
  if (saved) { store.set('lastFile', Date.now()); render(); }
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'med-tracker') throw new Error('это не файл копии приложения');
    if (hasData()) await makeSnapshot(false, 'перед импортом');
    for (const f of d.files || []) await DB.put('files', { id: f.id, name: f.name, type: f.type, blob: await (await fetch(f.data)).blob() });
    for (const s of [...RECORDS, 'inbox']) for (const x of d[s] || []) await DB.put(s, x);
    await migrate(); await load(); render();
    alert('Данные восстановлены.');
  } catch (e) { alert('Не удалось импортировать: ' + e.message); }
}

// ---------- действия ----------
async function removeEntity(s, id) {
  await DB.del(s, id);
  for (const m of (await DB.all('meds')).filter(x => x.sourceId === id)) await DB.del('meds', m.id);
  await gc(); await load(); render();
}
function applyTheme(t) { document.documentElement.dataset.theme = t; }
const draftOf = id => {
  const d = inbox.find(x => x.id === id);
  if (d && d.text && d.pver !== PARSER_VERSION) {
    const re = analyzeText(d.text, today()), old = d.parsed || {};
    d.parsed = { ...re.parsed, results: (old.results || []).length ? old.results : re.parsed.results, date: old.date || re.parsed.date, lab: old.lab || re.parsed.lab };
    d.pver = PARSER_VERSION;
  }
  return d;
};
const actions = {
  'add-analysis': () => analysisForm(),
  'edit-analysis': id => analysisForm(analyses.find(a => a.id === id)),
  'del-analysis': id => confirm('Удалить этот анализ?') && removeEntity('analyses', id),
  'add-study': k => studyForm(null, null, k),
  'edit-study': id => studyForm(studies.find(s => s.id === id)),
  'del-study': id => confirm('Удалить это исследование?') && removeEntity('studies', id),
  'add-conclusion': () => conclusionForm(),
  'edit-conclusion': id => conclusionForm(conclusions.find(c => c.id === id)),
  'del-conclusion': id => confirm('Удалить это заключение?') && removeEntity('conclusions', id),
  'add-med': () => medForm(),
  'edit-med': id => medForm(meds.find(m => m.id === id)),
  'del-med': async id => { if (confirm('Удалить это лекарство из списка?')) { await DB.del('meds', id); await load(); render(); } },
  'toggle-med': async id => { const m = await DB.get('meds', id); if (m) { m.active = m.active === false; await DB.put('meds', m); await load(); render(); } },
  'draft-analysis': id => analysisForm(null, draftOf(id)),
  'draft-study': id => studyForm(null, draftOf(id)),
  'draft-visit': id => conclusionForm(null, draftOf(id)),
  'del-draft': async id => {
    if (!draftOf(id) || !confirm('Удалить этот скан?')) return;
    await DB.del('inbox', id); await gc(); await load(); render();
  },
  'done-next': async v => {
    const [s, id] = v.split(':');
    const item = await DB.get(s, id);
    if (item) { item.nextDate = ''; await DB.put(s, item); await load(); render(); }
  },
  'open-file': async id => {
    const f = await DB.get('files', id);
    if (f) window.open(URL.createObjectURL(f.blob), '_blank');
  },
  ics: exportIcs,
  print: () => window.print(),
  export: exportData,
  snooze: () => { store.set('snooze', Date.now() + 864e5); render(); },
  snapshot: async () => { await makeSnapshot(false); await load(); render(); },
  restore: restoreSnapshot,
  theme: t => { store.set('theme', t); applyTheme(t); render(); },
  wipe: async () => {
    if (!confirm('Удалить ВСЕ данные, сканы и точки восстановления? Вернуть их можно будет только из файла копии.')) return;
    for (const s of STORES) await DB.clear(s);
    await load(); render();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset.id);
});
document.addEventListener('input', e => { if (e.target.classList.contains('sus') || e.target.classList.contains('cat')) e.target.classList.remove('sus', 'cat'); });
document.addEventListener('change', e => {
  if (e.target.matches('.scan-input') && e.target.files.length) { addScans(e.target.files); e.target.value = ''; }
});

// ---------- роутер ----------
function updateBadge() {
  document.querySelectorAll('.scan-count').forEach(b => { b.textContent = inbox.length || ''; b.hidden = !inbox.length; });
}
function render() {
  const [r = '', param = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const p = decodeURIComponent(param);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === r));
  const views = { scans: viewScans, analyses: viewAnalyses, indicators: () => viewIndicators(p), studies: () => viewStudies(p), conclusions: () => viewConclusions(p), meds: viewMeds, timeline: () => viewTimeline(p), summary: () => viewSummary(p), data: viewData, more: viewMore };
  (views[r] || viewHome)();
  updateBadge();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

(async () => {
  $('#catalog').innerHTML = CATALOG.flatMap(c => [c.name, c.abs].filter(Boolean)).map(n => `<option value="${esc(n)}">`).join('');
  try {
    await DB.open();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await migrate();
    for (const d of await DB.all('inbox')) if (d.status === 'processing') { d.status = 'queued'; await DB.put('inbox', d); }
    await load();
    await collectMedsOnce();
    await load();
    await weeklySnapshot();
    render();
    processInbox();
  } catch (e) {
    app.innerHTML = `<div class="card">Не удалось открыть хранилище браузера: ${esc(e.message)}. В приватном режиме данные могут не сохраняться.</div>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
