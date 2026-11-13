'use strict';
/* Мои анализы — всё работает в браузере. Данные и сканы хранятся в IndexedDB на устройстве. */

// ---------- утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoLocal(new Date());
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU') : 'без даты');
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/^[<>≤≥\s]+/, '')); return Number.isNaN(n) ? null : n; };
const key = n => String(n ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const enc = encodeURIComponent;
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');

function flag(r) {
  const v = num(r.value), min = num(r.min), max = num(r.max);
  if (v === null || (min === null && max === null)) return '';
  if (min !== null && v < min) return 'low';
  if (max !== null && v > max) return 'high';
  return 'ok';
}
const arrow = f => (f === 'low' ? '↓' : f === 'high' ? '↑' : '');
const FLAG_TXT = { low: '↓ ниже нормы', high: '↑ выше нормы', ok: 'в норме' };
function rangeText(r) {
  const min = num(r.min), max = num(r.max);
  if (min !== null && max !== null) return `${min}–${max}`;
  if (max !== null) return `≤ ${max}`;
  if (min !== null) return `≥ ${min}`;
  return '';
}
function deltaText(cur, prev) {
  const a = num(cur), b = num(prev);
  if (a === null || b === null) return '';
  const d = +(a - b).toFixed(2);
  if (d === 0) return '=';
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}${b ? ` (${d > 0 ? '+' : '−'}${Math.abs(Math.round(d / b * 100))}%)` : ''}`;
}

// ---------- хранилище (IndexedDB) ----------
const STORES = ['analyses', 'studies', 'conclusions', 'files', 'inbox'];
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('med-tracker', 2);
    r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return {
    open,
    all: s => run(s, 'readonly', st => st.getAll()),
    get: (s, id) => run(s, 'readonly', st => st.get(id)),
    put: (s, o) => run(s, 'readwrite', st => st.put(o)),
    del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
    clear: s => run(s, 'readwrite', st => st.clear()),
  };
})();

let analyses = [], studies = [], conclusions = [], inbox = [];
async function load() {
  analyses = (await DB.all('analyses')).sort(byDateDesc);
  studies = (await DB.all('studies')).sort(byDateDesc);
  conclusions = (await DB.all('conclusions')).sort(byDateDesc);
  inbox = (await DB.all('inbox')).sort((a, b) => a.addedAt - b.addedAt);
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
const studyTitle = s => `${s.type || 'Исследование'}${s.area ? ' · ' + s.area : ''}`;
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

// ---------- график ----------
function chart(pts) {
  const p = pts.map(x => ({ t: new Date(x.date).getTime(), v: num(x.value), f: flag(x), d: x.date, u: x.unit })).filter(x => x.v !== null && !Number.isNaN(x.t));
  if (!p.length) return '<p class="muted">Нет числовых значений для графика.</p>';
  const last = pts[pts.length - 1];
  const bmin = num(last.min), bmax = num(last.max);
  const W = 640, H = 240, L = 48, R = 16, T = 16, B = 34;
  const xs = p.map(x => x.t), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => (x1 === x0 ? L + (W - L - R) / 2 : L + (t - x0) / (x1 - x0) * (W - L - R));
  let lo = Math.min(...p.map(x => x.v), bmin ?? Infinity), hi = Math.max(...p.map(x => x.v), bmax ?? -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(2));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График">`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    s += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  if (bmin !== null || bmax !== null) {
    const y1 = Y(bmax ?? hi), y2 = Y(bmin ?? lo);
    s += `<rect class="band" x="${L}" y="${y1}" width="${W - L - R}" height="${Math.max(0, y2 - y1)}"/>`;
  }
  s += `<polyline class="line" points="${p.map(x => `${X(x.t)},${Y(x.v)}`).join(' ')}"/>`;
  p.forEach(x => { s += `<circle class="dot ${x.f}" cx="${X(x.t)}" cy="${Y(x.v)}" r="5"><title>${fmtDate(x.d)}: ${x.v} ${esc(x.u || '')}</title></circle>`; });
  const first = p[0], lastP = p[p.length - 1];
  s += `<text x="${X(first.t)}" y="${H - 10}" text-anchor="${p.length > 1 ? 'start' : 'middle'}">${fmtDate(first.d)}</text>`;
  if (p.length > 1) s += `<text x="${X(lastP.t)}" y="${H - 10}" text-anchor="end">${fmtDate(lastP.d)}</text>`;
  return s + '</svg>';
}

// ---------- карточки ----------
const app = $('#app');
const fileLinks = files => (files || []).map(f => `<a class="file" data-act="open-file" data-id="${f.id}">📎 ${esc(f.name)}</a>`).join('');
const nextBadge = r => (r.nextDate ? `<span class="badge ${r.nextDate < today() ? 'over' : ''}">Контроль: ${fmtDate(r.nextDate)}</span>` : '');
const cardBtns = (kind, id) => `<div class="btns"><button class="sm" data-act="edit-${kind}" data-id="${id}">Изменить</button><button class="sm danger" data-act="del-${kind}" data-id="${id}">Удалить</button></div>`;
const block = (title, text) => (text ? `<h4>${title}</h4><p class="note">${esc(text)}</p>` : '');

function resultsTable(a) {
  if (!(a.results || []).length) return '';
  return `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th></tr></thead><tbody>${a.results.map(r => {
    const f = flag(r);
    return `<tr><td><a href="#/indicators/${enc(key(r.name))}">${esc(r.name)}</a></td><td class="${f}">${esc(r.value)} ${esc(r.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(r))}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function analysisCard(a) {
  const bad = (a.results || []).filter(r => ['low', 'high'].includes(flag(r))).length;
  return `<div class="card"><div class="card-head"><div><h3>${fmtDate(a.date)}${a.lab ? ' · ' + esc(a.lab) : ''}</h3>
    <div class="muted">Показателей: ${(a.results || []).length}${bad ? `, вне нормы: ${bad}` : ''} ${nextBadge(a)}</div></div>${cardBtns('analysis', a.id)}</div>
    ${resultsTable(a)}${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}<div>${fileLinks(a.files)}</div></div>`;
}
function measuresTable(s) {
  if (!(s.measures || []).length) return '';
  return `<table><tbody>${s.measures.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.value)} ${esc(m.unit)}</td></tr>`).join('')}</tbody></table>`;
}
function studyCard(s) {
  return `<div class="card"><div class="card-head"><div><h3><a href="#/studies/${enc(studyKey(s))}">${esc(studyTitle(s))}</a></h3>
    <div class="muted">${fmtDate(s.date)}${s.clinic ? ' · ' + esc(s.clinic) : ''}${s.doctor ? ' · ' + esc(s.doctor) : ''} ${nextBadge(s)}</div></div>${cardBtns('study', s.id)}</div>
    ${block('Заключение', s.conclusion)}${measuresTable(s)}${block('Рекомендации', s.recs)}
    ${s.description ? `<details><summary>Описание (протокол)</summary><p class="note">${esc(s.description)}</p></details>` : ''}<div>${fileLinks(s.files)}</div></div>`;
}
function conclusionCard(c) {
  return `<div class="card"><div class="card-head"><div><h3>${esc(c.specialty || 'Врач')}${c.doctor ? ' · ' + esc(c.doctor) : ''}</h3>
    <div class="muted">${fmtDate(c.date)}${c.clinic ? ' · ' + esc(c.clinic) : ''} ${nextBadge(c)}</div></div>${cardBtns('conclusion', c.id)}</div>
    ${block('Диагноз', c.diagnosis)}${block('Заключение', c.text)}${block('Рекомендации', c.recs)}<div>${fileLinks(c.files)}</div></div>`;
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
const uploadBtn = (cls = 'primary') => `<label class="btn ${cls}">Загрузить сканы<input type="file" class="scan-input" multiple accept="image/*,application/pdf" hidden></label>`;

function viewHome() {
  const sm = seriesMap();
  const bad = [...sm.values()].map(s => ({ name: s.name, last: s.pts[s.pts.length - 1] })).filter(x => ['low', 'high'].includes(flag(x.last)));
  const up = upcoming();
  const recent = [
    ...analyses.map(a => ({ date: a.date, html: analysisCard(a) })),
    ...studies.map(s => ({ date: s.date, html: studyCard(s) })),
    ...conclusions.map(c => ({ date: c.date, html: conclusionCard(c) })),
  ].sort(byDateDesc).slice(0, 3);
  app.innerHTML = `<h2>Обзор</h2>
  <div class="grid">
    <a class="card stat" href="#/analyses"><b>${analyses.length}</b>анализов</a>
    <a class="card stat" href="#/indicators"><b>${sm.size}</b>показателей</a>
    <a class="card stat" href="#/studies"><b>${studies.length}</b>исследований</a>
    <a class="card stat" href="#/conclusions"><b>${conclusions.length}</b>заключений</a>
  </div>
  <div class="toolbar">${uploadBtn()}<button data-act="add-analysis">+ Анализ</button><button data-act="add-study">+ Исследование</button><button data-act="add-conclusion">+ Заключение врача</button></div>
  ${inbox.length ? `<div class="card accent"><b>Сканы ждут проверки: ${inbox.length}</b> <a href="#/scans">Перейти</a></div>` : ''}
  ${up.length ? `<div class="card"><div class="card-head"><h3>Контроль</h3><button class="sm" data-act="ics">В календарь (.ics)</button></div><table><tbody>${up.map(u => `<tr><td class="${u.date < today() ? 'high' : ''}">${fmtDate(u.date)}${u.date < today() ? ' · просрочено' : ''}</td><td>${esc(u.label)}</td><td><button class="sm" data-act="done-next" data-id="${u.store}:${u.id}">Готово</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="card"><h3>Последние значения вне нормы</h3>${bad.length ? `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th><th>Дата</th></tr></thead><tbody>${bad.map(x => {
    const f = flag(x.last);
    return `<tr><td><a href="#/indicators/${enc(key(x.name))}">${esc(x.name)}</a></td><td class="${f}">${esc(x.last.value)} ${esc(x.last.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(x.last))}</td><td class="muted">${fmtDate(x.last.date)}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">Нет значений вне нормы.</p>'}</div>
  <h3>Последние записи</h3>${recent.map(x => x.html).join('') || '<div class="empty">Пока пусто. Загрузите скан или добавьте запись вручную.</div>'}`;
}

const KIND = { analysis: 'Анализ', study: 'Исследование', visit: 'Заключение врача' };
function draftCard(d) {
  const status = { queued: 'В очереди на распознавание', processing: 'Распознаётся…', ready: 'Готово к проверке', error: 'Текст не распознан — заполните вручную' }[d.status];
  let body = '';
  if (d.status === 'processing') body = `<progress id="prog-${d.id}" max="1" value="0"></progress>`;
  if (d.status === 'ready' || d.status === 'error') {
    const p = d.parsed || {};
    const hint = d.kind ? `Похоже на: <b>${KIND[d.kind].toLowerCase()}</b>${p.date ? ' от ' + fmtDate(p.date) : ', дата не найдена'}${d.kind === 'analysis' ? `, показателей: ${p.results.length}` : ''}` : 'Тип документа не определён — выберите сами';
    body = `<p class="muted">${d.status === 'error' ? esc(d.error || '') : hint}</p><div class="toolbar"><span class="muted">Сохранить как:</span>
      ${Object.keys(KIND).map(k => `<button class="sm ${d.kind === k ? 'primary' : ''}" data-act="draft-${k}" data-id="${d.id}">${KIND[k]}</button>`).join('')}</div>`;
  }
  return `<div class="card"><div class="card-head"><div><h3><a class="file" data-act="open-file" data-id="${d.fileId}">📎 ${esc(d.name)}</a></h3><div class="muted">${status}</div></div>
    <div class="btns"><button class="sm danger" data-act="del-draft" data-id="${d.id}">Удалить</button></div></div>${body}</div>`;
}
function viewScans() {
  app.innerHTML = `<h2>Сканы</h2>
  <label class="drop" id="drop"><b>Перетащите сюда файлы или нажмите, чтобы выбрать</b><span class="muted">Фото, сканы, PDF. Можно сразу много, в том числе старые — дату приложение возьмёт из документа, и её можно поправить.</span>
    <input type="file" class="scan-input" multiple accept="image/*,application/pdf" hidden></label>
  <p class="muted">Распознавание идёт на вашем устройстве, файлы никуда не отправляются. Оно может ошибаться, поэтому перед сохранением сверяйте значения со сканом.</p>
  ${inbox.map(draftCard).join('') || '<div class="empty">Нет сканов, ожидающих проверки.</div>'}`;
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addScans(e.dataTransfer.files); });
}

function listView(title, items, card, toolbar, searchText, emptyText) {
  app.innerHTML = `<h2>${title}</h2><div class="toolbar"><input type="search" id="q" placeholder="Поиск…">${toolbar}</div><div id="list"></div>`;
  const draw = () => {
    const q = key($('#q').value);
    const f = items.filter(x => !q || key(searchText(x)).includes(q));
    $('#list').innerHTML = f.map(card).join('') || `<div class="empty">${items.length ? 'Ничего не найдено.' : emptyText}</div>`;
  };
  $('#q').addEventListener('input', draw);
  draw();
}
const viewAnalyses = () => listView('Анализы', analyses, analysisCard, `<button class="primary" data-act="add-analysis">+ Анализ</button>${uploadBtn('')}`,
  a => [fmtDate(a.date), a.lab, a.note, ...(a.results || []).map(r => r.name)].join(' '), 'Анализов пока нет.');
const viewConclusions = () => listView('Заключения врачей', conclusions, conclusionCard, `<button class="primary" data-act="add-conclusion">+ Заключение</button>${uploadBtn('')}`,
  c => [fmtDate(c.date), c.specialty, c.doctor, c.clinic, c.diagnosis, c.text, c.recs].join(' '), 'Заключений пока нет.');

function viewIndicators(param) {
  const sm = seriesMap();
  const list = [...sm.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!list.length) { app.innerHTML = '<h2>Показатели</h2><div class="empty">Сначала добавьте анализ.</div>'; return; }
  const cur = sm.get(param) || list[0];
  const rows = cur.pts.map((r, i) => ({ r, prev: cur.pts[i - 1] })).reverse();
  const hasBand = num(cur.pts[cur.pts.length - 1].min) !== null || num(cur.pts[cur.pts.length - 1].max) !== null;
  app.innerHTML = `<h2>Показатели</h2>
  <div class="toolbar"><select id="ind">${list.map(s => `<option value="${esc(key(s.name))}" ${s === cur ? 'selected' : ''}>${esc(s.name)} (${s.pts.length})</option>`).join('')}</select><button data-act="print">Печать</button></div>
  <div class="card"><h3>${esc(cur.name)}</h3>${chart(cur.pts)}${hasBand ? '<p class="muted">Зелёная полоса — норма из последнего анализа.</p>' : ''}</div>
  <div class="card"><table><thead><tr><th>Дата</th><th>Значение</th><th>Изменение</th><th>Норма</th><th></th></tr></thead><tbody>${rows.map(({ r, prev }) => {
    const f = flag(r);
    return `<tr><td>${fmtDate(r.date)}</td><td class="${f}">${esc(r.value)} ${esc(r.unit)} ${arrow(f)}</td><td class="muted">${prev ? deltaText(r.value, prev.value) : ''}</td><td class="muted">${esc(rangeText(r))}</td><td class="muted">${FLAG_TXT[f] || ''}</td></tr>`;
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
      return `<a class="card link" href="#/studies/${enc(g.key)}"><div class="card-head"><h3>${esc(g.title)}</h3><span class="badge">${g.items.length}</span></div>
        <div class="muted">Последнее: ${fmtDate(last.date)}</div>${last.conclusion ? `<p class="note clip">${esc(last.conclusion)}</p>` : ''}</a>`;
    }, `<button class="primary" data-act="add-study">+ Исследование</button>${uploadBtn('')}`,
    g => [g.title, ...g.items.map(s => [s.conclusion, s.clinic, s.doctor, fmtDate(s.date)].join(' '))].join(' '), 'Исследований пока нет. УЗИ, МРТ, рентген и другие собираются здесь по видам.');
    return;
  }
  // динамика по одному виду исследования
  const items = cur.items;
  const names = new Map();
  items.forEach(s => (s.measures || []).forEach(m => { if (m.name && !names.has(key(m.name))) names.set(key(m.name), m.name); }));
  const charts = [...names.entries()].map(([k, name]) => {
    const pts = items.map(s => { const m = (s.measures || []).find(x => key(x.name) === k); return m && { date: s.date, value: m.value, unit: m.unit }; }).filter(Boolean);
    return pts.filter(p => num(p.value) !== null).length >= 2 ? `<div class="card"><h3>${esc(name)}${pts[0].unit ? ', ' + esc(pts[0].unit) : ''}</h3>${chart(pts)}</div>` : '';
  }).join('');
  const opts = sel => items.map((s, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${fmtDate(s.date)}</option>`).join('');
  app.innerHTML = `<h2>${esc(cur.title)}</h2>
  <div class="toolbar"><a class="btn" href="#/studies">← Все исследования</a><button class="primary" data-act="add-study" data-id="${esc(cur.key)}">+ Добавить</button><button data-act="print">Печать</button></div>
  ${items.length > 1 ? `<div class="card"><h3>Сравнение</h3><div class="two"><select id="cmpA">${opts(items.length - 2)}</select><select id="cmpB">${opts(items.length - 1)}</select></div><div id="cmp"></div></div>` : '<p class="muted">Когда исследований этого вида станет два и больше, здесь появятся сравнение и графики.</p>'}
  ${charts}<h3>Все исследования</h3>${[...items].reverse().map(studyCard).join('')}`;
  if (items.length > 1) {
    const draw = () => {
      const a = items[+$('#cmpA').value], b = items[+$('#cmpB').value];
      const rows = [...names.entries()].map(([k, name]) => {
        const ma = (a.measures || []).find(x => key(x.name) === k), mb = (b.measures || []).find(x => key(x.name) === k);
        return `<tr><td>${esc(name)}</td><td>${ma ? esc(ma.value) + ' ' + esc(ma.unit) : '—'}</td><td>${mb ? esc(mb.value) + ' ' + esc(mb.unit) : '—'}</td><td class="muted">${ma && mb ? deltaText(mb.value, ma.value) : ''}</td></tr>`;
      }).join('');
      $('#cmp').innerHTML = `${rows ? `<table><thead><tr><th>Измерение</th><th>${fmtDate(a.date)}</th><th>${fmtDate(b.date)}</th><th>Изменение</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        <div class="two cmp"><div><h4>${fmtDate(a.date)}</h4><p class="note">${esc(a.conclusion || '—')}</p></div><div><h4>${fmtDate(b.date)}</h4><p class="note">${esc(b.conclusion || '—')}</p></div></div>`;
    };
    $('#cmpA').addEventListener('change', draw); $('#cmpB').addEventListener('change', draw);
    draw();
  }
}

function viewTimeline(param) {
  const all = [
    ...analyses.map(a => ({ k: 'analysis', date: a.date, icon: '🧪', title: 'Анализы' + (a.lab ? ' · ' + a.lab : ''), sub: `показателей: ${(a.results || []).length}`, html: analysisCard(a) })),
    ...studies.map(s => ({ k: 'study', date: s.date, icon: '🩻', title: studyTitle(s), sub: s.conclusion || '', html: studyCard(s) })),
    ...conclusions.map(c => ({ k: 'visit', date: c.date, icon: '🩺', title: c.specialty || 'Врач', sub: c.diagnosis || c.text || '', html: conclusionCard(c) })),
  ].filter(x => !param || x.k === param).sort(byDateDesc);
  const chips = [['', 'Всё'], ['analysis', 'Анализы'], ['study', 'Исследования'], ['visit', 'Заключения']];
  let html = `<h2>Хронология</h2><div class="chips">${chips.map(([k, t]) => `<a class="btn sm ${param === k ? 'primary' : ''}" href="#/timeline${k ? '/' + k : ''}">${t}</a>`).join('')}</div>`;
  let year = '';
  all.forEach(x => {
    const y = (x.date || '').slice(0, 4) || 'Без даты';
    if (y !== year) { year = y; html += `<h3 class="year">${y}</h3>`; }
    html += `<details class="tl"><summary><span class="tl-date">${fmtDate(x.date)}</span><span>${x.icon} <b>${esc(x.title)}</b> <span class="muted clip1">${esc(x.sub)}</span></span></summary>${x.html}</details>`;
  });
  app.innerHTML = html + (all.length ? '' : '<div class="empty">Записей пока нет.</div>');
}

function viewSummary(param) {
  const periods = { 3: '3 месяца', 6: '6 месяцев', 12: '12 месяцев', 0: 'всё время' };
  const m = param in periods ? +param : 12;
  let from = '';
  if (m) { const d = new Date(); d.setMonth(d.getMonth() - m); from = isoLocal(d); }
  const inP = x => !from || (x.date || '') >= from;
  const rows = [...seriesMap().values()].map(s => {
    const idx = s.pts.map((p, i) => (inP(p) ? i : -1)).filter(i => i >= 0).pop();
    return idx === undefined ? null : { name: s.name, last: s.pts[idx], prev: s.pts[idx - 1] };
  }).filter(Boolean).sort((a, b) => (flag(a.last) === 'ok' || !flag(a.last)) - (flag(b.last) === 'ok' || !flag(b.last)) || a.name.localeCompare(b.name, 'ru'));
  const st = studies.filter(inP), cs = conclusions.filter(inP);
  app.innerHTML = `<h2>Сводка для врача</h2>
  <div class="toolbar"><select id="per">${Object.entries(periods).map(([k, t]) => `<option value="${k}" ${+k === m ? 'selected' : ''}>За ${t}</option>`).join('')}</select><button class="primary" data-act="print">Печать / сохранить в PDF</button></div>
  <p class="muted">Составлено ${fmtDate(today())}${from ? `, период с ${fmtDate(from)}` : ''}. Сначала идут показатели вне нормы.</p>
  <div class="card"><h3>Анализы: последние значения</h3>${rows.length ? `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th><th>Дата</th><th>Было</th><th>Изменение</th></tr></thead><tbody>${rows.map(x => {
    const f = flag(x.last);
    return `<tr><td>${esc(x.name)}</td><td class="${f}">${esc(x.last.value)} ${esc(x.last.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(x.last))}</td><td class="muted">${fmtDate(x.last.date)}</td><td class="muted">${x.prev ? `${esc(x.prev.value)} (${fmtDate(x.prev.date)})` : ''}</td><td class="muted">${x.prev ? deltaText(x.last.value, x.prev.value) : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">Нет анализов за период.</p>'}</div>
  <div class="card"><h3>Исследования</h3>${st.map(s => `<p><b>${fmtDate(s.date)} · ${esc(studyTitle(s))}</b><br><span class="note">${esc(s.conclusion || 'заключение не указано')}</span></p>`).join('') || '<p class="muted">Нет исследований за период.</p>'}</div>
  <div class="card"><h3>Заключения врачей</h3>${cs.map(c => `<p><b>${fmtDate(c.date)} · ${esc(c.specialty || 'Врач')}</b>${c.diagnosis ? `<br>Диагноз: <span class="note">${esc(c.diagnosis)}</span>` : ''}${c.recs ? `<br>Рекомендации: <span class="note">${esc(c.recs)}</span>` : ''}</p>`).join('') || '<p class="muted">Нет заключений за период.</p>'}</div>`;
  $('#per').addEventListener('change', e => { location.hash = '#/summary/' + e.target.value; });
}

function viewData() {
  app.innerHTML = `<h2>Данные</h2>
  <div class="card"><h3>Где хранятся данные</h3><p class="muted">Записи и сканы лежат только в этом браузере на этом устройстве. Распознавание сканов тоже идёт на устройстве. На GitHub находится лишь код приложения. Если очистить данные сайта или сменить браузер, записи пропадут, поэтому делайте резервные копии.</p></div>
  <div class="card"><h3>Резервная копия</h3><div class="toolbar">
    <button class="primary" data-act="export">Скачать копию (JSON)</button>
    <label class="btn">Восстановить из файла<input type="file" id="imp" accept="application/json" hidden></label></div>
    <p class="muted">Файл копии содержит все записи и сканы. Не публикуйте его и не загружайте в репозиторий. Через копию можно перенести данные на другое устройство.</p></div>
  <div class="card"><h3>Опасная зона</h3><button class="danger" data-act="wipe">Удалить все данные</button></div>`;
  $('#imp').addEventListener('change', e => e.target.files[0] && importData(e.target.files[0]));
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
    try { await onSubmit(form); dlg.close(); await load(); render(); } catch (err) { alert('Не удалось сохранить: ' + err.message); }
  });
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.showModal();
  dlg.scrollTop = 0;
  return form;
}
async function draftPreview(d) {
  if (!d) return '';
  const f = await DB.get('files', d.fileId);
  let media = `<a class="file" data-act="open-file" data-id="${d.fileId}">📎 Открыть ${esc(d.name)}</a>`;
  if (f && (f.type || '').startsWith('image/')) { const url = URL.createObjectURL(f.blob); dlgUrls.push(url); media = `<a href="${url}" target="_blank" title="Открыть в полном размере"><img src="${url}" alt="Скан"></a>`; }
  return `<aside class="scan"><p class="warn">Сверьте данные со сканом: распознавание может ошибаться.</p>${media}
    <details><summary>Распознанный текст</summary><pre>${esc(d.text || 'Текст не распознан.')}</pre></details></aside>`;
}
const draftFiles = d => (d ? [{ id: d.fileId, name: d.name }] : []);
const actionsRow = '<div class="actions"><button type="button" data-close>Отмена</button><button class="primary">Сохранить</button></div>';
const dateField = (v, label = 'Дата') => `<label>${label}<input type="date" name="date" required max="${today()}" value="${esc(v)}"></label>`;
const nextField = v => `<label>Контроль: когда повторить или прийти снова (необязательно)<input type="date" name="nextDate" value="${esc(v)}"></label>`;
const filesBlock = files => `${(files || []).length ? `<div class="muted">Файлы (снимите галочку, чтобы удалить):</div>${files.map(f => `<label class="check"><input type="checkbox" name="keep" value="${f.id}" checked> ${esc(f.name)}</label>`).join('')}` : ''}
  <label>Прикрепить файлы (скан, PDF, фото)<input type="file" name="newfiles" multiple accept="image/*,application/pdf"></label>`;

async function saveFiles(form, old) {
  const keepIds = new Set([...form.querySelectorAll('[name=keep]:checked')].map(x => x.value));
  const kept = (old || []).filter(f => keepIds.has(f.id));
  for (const f of (old || []).filter(f => !keepIds.has(f.id))) await DB.del('files', f.id);
  for (const file of form.elements.newfiles.files) {
    const id = uid();
    await DB.put('files', { id, name: file.name, type: file.type, blob: file });
    kept.push({ id, name: file.name });
  }
  return kept;
}
const readRows = (form, sel, fields) => [...form.querySelectorAll(sel)].map(r => Object.fromEntries(fields.map(n => [n, r.querySelector(`[name=${n}]`).value.trim()])));

function resultRow(r = {}) {
  const w = n => ((r.warn || []).includes(n) ? ' class="sus" title="Проверьте по скану"' : '');
  return `<div class="row r5">
    <input name="name" list="catalog" placeholder="Показатель" value="${esc(r.name)}">
    <input name="value" placeholder="Значение" value="${esc(r.value)}" inputmode="decimal"${w('value')}>
    <input name="unit" placeholder="Ед." value="${esc(r.unit)}"${w('unit')}>
    <input name="min" placeholder="Мин" value="${esc(r.min)}" inputmode="decimal"${w('min')}>
    <input name="max" placeholder="Макс" value="${esc(r.max)}" inputmode="decimal"${w('max')}>
    <button type="button" class="sm" data-rm title="Убрать строку">×</button></div>`;
}
function measureRow(m = {}) {
  return `<div class="row r3">
    <input name="name" list="measures" placeholder="Что измерено (напр. объём правой доли)" value="${esc(m.name)}">
    <input name="value" placeholder="Значение" value="${esc(m.value)}" inputmode="decimal">
    <input name="unit" placeholder="Ед." value="${esc(m.unit)}">
    <button type="button" class="sm" data-rm title="Убрать строку">×</button></div>`;
}
function prefill(name) {
  const last = seriesMap().get(key(name));
  if (last) { const p = last.pts[last.pts.length - 1]; return { unit: p.unit, min: p.min, max: p.max }; }
  const c = CATALOG.find(x => key(x.name) === key(name));
  return c ? { unit: c.unit ?? '', min: c.min ?? '', max: c.max ?? '' } : null;
}
function rowEvents(form, rowsEl, makeRow) {
  form.addEventListener('click', e => {
    if (e.target.matches('[data-rm]')) e.target.closest('.row').remove();
    if (e.target.matches('[data-addrow]')) rowsEl.insertAdjacentHTML('beforeend', makeRow());
  });
}

async function analysisForm(a, draft) {
  const p = draft && draft.parsed;
  a = a || { date: draft ? (p && p.date) || '' : today(), lab: (p && p.lab) || '', note: '', results: (p && p.results) || [], files: draftFiles(draft) };
  const form = openDialog(`<h2>${a.id ? 'Анализ' : 'Новый анализ'}</h2>
    <div class="two">${dateField(a.date, 'Дата сдачи')}<label>Лаборатория / клиника<input name="lab" value="${esc(a.lab)}"></label></div>
    <div class="muted">Быстро добавить набор:</div>
    <div class="chips">${Object.keys(PANELS).map(n => `<button type="button" class="sm" data-panel="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    ${a.results.some(r => r.warn) ? '<p class="warn sus-note">Жёлтым выделены значения, которые выглядят подозрительно (например, потерялась запятая). Проверьте их по скану.</p>' : ''}
    <div class="row r5 head"><span>Показатель</span><span>Значение</span><span>Ед.</span><span>Мин</span><span>Макс</span><span></span></div>
    <div id="rows">${(a.results.length ? a.results : [{}]).map(resultRow).join('')}</div>
    <button type="button" class="sm" data-addrow>+ строка</button>
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
    date: draft ? (p && p.date) || '' : today(), type: (p && p.studyType) || (tpl && tpl.type) || 'УЗИ', area: (p && p.area) || (tpl && tpl.area) || '', clinic: '', doctor: (p && p.doctor) || '',
    description: (draft && draft.text) || '', conclusion: (p && p.conclusion) || '', recs: (p && p.recs) || '',
    measures: (p && p.measures) || (tpl ? (tpl.measures || []).map(m => ({ name: m.name, value: '', unit: m.unit })) : []), files: draftFiles(draft),
  };
  const areas = [...new Set([...studies.map(x => x.area).filter(Boolean), ...STUDY_AREAS.map(x => x[0])])];
  const mnames = [...new Set(studies.flatMap(x => (x.measures || []).map(m => m.name)).filter(Boolean))];
  const form = openDialog(`<h2>${s.id ? 'Исследование' : 'Новое исследование'}</h2>
    <div class="two">${dateField(s.date, 'Дата исследования')}<label>Вид<select name="type">${STUDY_TYPES.map(([t]) => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <label>Что исследовали (по этому полю записи собираются в динамику)<input name="area" list="areas" value="${esc(s.area)}" placeholder="Напр. Щитовидная железа"></label>
    <datalist id="areas">${areas.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="measures">${mnames.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="two"><label>Клиника<input name="clinic" value="${esc(s.clinic)}"></label><label>Врач<input name="doctor" value="${esc(s.doctor)}"></label></div>
    <label>Заключение<textarea name="conclusion" rows="4">${esc(s.conclusion)}</textarea></label>
    <div class="muted">Измерения для графиков (размеры, объёмы и т. п.):</div>
    <div id="rows">${(s.measures.length ? s.measures : [{}]).map(measureRow).join('')}</div>
    <button type="button" class="sm" data-addrow>+ измерение</button>
    <label class="mt">Рекомендации<textarea name="recs" rows="2">${esc(s.recs)}</textarea></label>
    <label>Описание (протокол)<textarea name="description" rows="4">${esc(s.description)}</textarea></label>
    ${nextField(s.nextDate)}${filesBlock(s.files)}${actionsRow}`,
  async f => {
    const g = n => f.elements[n].value.trim();
    const measures = readRows(f, '#rows .row', ['name', 'value', 'unit']).filter(m => m.name && m.value !== '');
    const files = await saveFiles(f, s.files);
    await DB.put('studies', { id: s.id || uid(), date: f.elements.date.value, type: f.elements.type.value, area: g('area'), clinic: g('clinic'), doctor: g('doctor'), conclusion: g('conclusion'), recs: g('recs'), description: g('description'), nextDate: f.elements.nextDate.value, measures, files });
    if (draft) await DB.del('inbox', draft.id);
  }, await draftPreview(draft));
  rowEvents(form, $('#rows', form), measureRow);
}

async function conclusionForm(c, draft) {
  const p = draft && draft.parsed;
  c = c || { date: draft ? (p && p.date) || '' : today(), specialty: (p && p.specialty) || '', doctor: (p && p.doctor) || '', clinic: '', diagnosis: (p && p.diagnosis) || '', text: (p && p.conclusion) || (draft && draft.text) || '', recs: (p && p.recs) || '', files: draftFiles(draft) };
  const specs = [...new Set([...conclusions.map(x => x.specialty).filter(Boolean), ...SPECIALTIES.map(x => x[0])])];
  openDialog(`<h2>${c.id ? 'Заключение врача' : 'Новое заключение врача'}</h2>
    <div class="two">${dateField(c.date, 'Дата приёма')}<label>Специальность<input name="specialty" list="specs" value="${esc(c.specialty)}" placeholder="Напр. Эндокринолог"></label></div>
    <datalist id="specs">${specs.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="two"><label>Врач<input name="doctor" value="${esc(c.doctor)}"></label><label>Клиника<input name="clinic" value="${esc(c.clinic)}"></label></div>
    <label>Диагноз<textarea name="diagnosis" rows="2">${esc(c.diagnosis)}</textarea></label>
    <label>Заключение<textarea name="text" rows="6">${esc(c.text)}</textarea></label>
    <label>Рекомендации<textarea name="recs" rows="3">${esc(c.recs)}</textarea></label>
    ${nextField(c.nextDate)}${filesBlock(c.files)}${actionsRow}`,
  async f => {
    const g = n => f.elements[n].value.trim();
    const files = await saveFiles(f, c.files);
    await DB.put('conclusions', { id: c.id || uid(), date: f.elements.date.value, specialty: g('specialty'), doctor: g('doctor'), clinic: g('clinic'), diagnosis: g('diagnosis'), text: g('text'), recs: g('recs'), nextDate: f.elements.nextDate.value, files });
    if (draft) await DB.del('inbox', draft.id);
  }, await draftPreview(draft));
}

// ---------- сканы: загрузка и распознавание ----------
const route = () => location.hash.replace(/^#\/?/, '').split('/')[0];
function refreshIfVisible() { if (['', 'scans'].includes(route())) render(); }

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
        const text = await OCR.recognize(f.blob, f.type, v => { const el = document.getElementById('prog-' + d.id); if (el) el.value = v; });
        Object.assign(d, analyzeText(text, today()), { text, status: 'ready' });
      } catch (e) {
        Object.assign(d, { status: 'error', error: String((e && e.message) || e), text: '', kind: '', parsed: null });
      }
      if (await DB.get('inbox', d.id)) await DB.put('inbox', d); // могли удалить, пока распознавалось
      await load(); refreshIfVisible();
    }
  } finally { processing = false; }
}

// ---------- резервная копия ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportData() {
  const files = [];
  for (const f of await DB.all('files')) files.push({ id: f.id, name: f.name, type: f.type, data: await blobToDataURL(f.blob) });
  const payload = { app: 'med-tracker', version: 2, exportedAt: new Date().toISOString(), analyses, studies, conclusions, inbox, files };
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `medtracker-backup-${today()}.json`);
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'med-tracker') throw new Error('это не файл копии приложения');
    for (const f of d.files || []) await DB.put('files', { id: f.id, name: f.name, type: f.type, blob: await (await fetch(f.data)).blob() });
    for (const s of ['analyses', 'studies', 'conclusions', 'inbox']) for (const x of d[s] || []) await DB.put(s, x);
    await migrate(); await load(); render();
    alert('Данные восстановлены.');
  } catch (e) { alert('Не удалось импортировать: ' + e.message); }
}

// ---------- действия ----------
async function removeEntity(store, id) {
  const item = await DB.get(store, id);
  for (const f of (item && item.files) || []) await DB.del('files', f.id);
  await DB.del(store, id);
  await load(); render();
}
const draftOf = id => inbox.find(d => d.id === id);
const actions = {
  'add-analysis': () => analysisForm(),
  'edit-analysis': id => analysisForm(analyses.find(a => a.id === id)),
  'del-analysis': id => confirm('Удалить этот анализ вместе с его файлами?') && removeEntity('analyses', id),
  'add-study': k => studyForm(null, null, k),
  'edit-study': id => studyForm(studies.find(s => s.id === id)),
  'del-study': id => confirm('Удалить это исследование вместе с его файлами?') && removeEntity('studies', id),
  'add-conclusion': () => conclusionForm(),
  'edit-conclusion': id => conclusionForm(conclusions.find(c => c.id === id)),
  'del-conclusion': id => confirm('Удалить это заключение вместе с его файлами?') && removeEntity('conclusions', id),
  'draft-analysis': id => analysisForm(null, draftOf(id)),
  'draft-study': id => studyForm(null, draftOf(id)),
  'draft-visit': id => conclusionForm(null, draftOf(id)),
  'del-draft': async id => {
    const d = draftOf(id);
    if (!d || !confirm('Удалить этот скан?')) return;
    await DB.del('files', d.fileId); await DB.del('inbox', id); await load(); render();
  },
  'done-next': async v => {
    const [store, id] = v.split(':');
    const item = await DB.get(store, id);
    if (item) { item.nextDate = ''; await DB.put(store, item); await load(); render(); }
  },
  'open-file': async id => {
    const f = await DB.get('files', id);
    if (f) window.open(URL.createObjectURL(f.blob), '_blank');
  },
  ics: exportIcs,
  print: () => window.print(),
  export: exportData,
  wipe: async () => {
    if (!confirm('Удалить ВСЕ данные и сканы без возможности восстановления? Сначала сделайте копию.')) return;
    for (const s of STORES) await DB.clear(s);
    await load(); render();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset.id);
});
document.addEventListener('input', e => { if (e.target.classList.contains('sus')) e.target.classList.remove('sus'); });
document.addEventListener('change', e => {
  if (e.target.matches('.scan-input') && e.target.files.length) { addScans(e.target.files); e.target.value = ''; }
});

// ---------- роутер ----------
function render() {
  const [r = '', param = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const p = decodeURIComponent(param);
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + r));
  const views = { scans: viewScans, analyses: viewAnalyses, indicators: () => viewIndicators(p), studies: () => viewStudies(p), conclusions: viewConclusions, timeline: () => viewTimeline(p), summary: () => viewSummary(p), data: viewData };
  (views[r] || viewHome)();
  const badge = $('#scan-count');
  if (badge) badge.textContent = inbox.length ? ` ${inbox.length}` : '';
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
    render();
    processInbox();
  } catch (e) {
    app.innerHTML = `<div class="card">Не удалось открыть хранилище браузера: ${esc(e.message)}. В приватном режиме данные могут не сохраняться.</div>`;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
