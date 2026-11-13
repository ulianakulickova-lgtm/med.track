'use strict';
/* Мои анализы — клиентское приложение. Все данные хранятся в IndexedDB вашего браузера. */

// ---------- утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('ru-RU') : '');
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? null : n; };
const key = n => String(n).trim().toLowerCase();

function flag(r) {
  const v = num(r.value), min = num(r.min), max = num(r.max);
  if (v === null || (min === null && max === null)) return '';
  if (min !== null && v < min) return 'low';
  if (max !== null && v > max) return 'high';
  return 'ok';
}
const arrow = f => (f === 'low' ? '↓' : f === 'high' ? '↑' : '');
function rangeText(r) {
  const min = num(r.min), max = num(r.max);
  if (min !== null && max !== null) return `${min}–${max}`;
  if (max !== null) return `≤ ${max}`;
  if (min !== null) return `≥ ${min}`;
  return '';
}

// ---------- хранилище (IndexedDB) ----------
const DB = (() => {
  let db;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('med-tracker', 1);
    r.onupgradeneeded = () => ['analyses', 'conclusions', 'files'].forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
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

let analyses = [], conclusions = [];
async function load() {
  analyses = (await DB.all('analyses')).sort((a, b) => b.date.localeCompare(a.date));
  conclusions = (await DB.all('conclusions')).sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- данные по показателям ----------
function seriesMap() {
  const m = new Map();
  [...analyses].sort((a, b) => a.date.localeCompare(b.date)).forEach(a =>
    (a.results || []).forEach(r => {
      if (!r.name || !r.name.trim()) return;
      const k = key(r.name);
      if (!m.has(k)) m.set(k, { name: r.name.trim(), pts: [] });
      m.get(k).pts.push({ ...r, date: a.date, aid: a.id });
    }));
  return m;
}

// ---------- график ----------
function chart(pts) {
  const p = pts.map(x => ({ t: new Date(x.date).getTime(), v: num(x.value), f: flag(x), d: x.date, u: x.unit })).filter(x => x.v !== null);
  if (!p.length) return '<p class="muted">Нет числовых значений для графика.</p>';
  const last = pts[pts.length - 1];
  const bmin = num(last.min), bmax = num(last.max);
  const W = 640, H = 260, L = 48, R = 16, T = 16, B = 34;
  const xs = p.map(x => x.t), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => (x1 === x0 ? L + (W - L - R) / 2 : L + (t - x0) / (x1 - x0) * (W - L - R));
  let lo = Math.min(...p.map(x => x.v), bmin ?? Infinity), hi = Math.max(...p.map(x => x.v), bmax ?? -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : +v.toFixed(2));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График показателя">`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = Y(v);
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`;
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
  return s + '</svg>' + ((bmin !== null || bmax !== null) ? '<p class="muted">Зелёная полоса — референс последнего анализа.</p>' : '');
}

// ---------- представления ----------
const app = $('#app');
const FLAG_TXT = { low: '↓ ниже нормы', high: '↑ выше нормы', ok: 'в норме' };

function fileLinks(files) {
  return (files || []).map(f => `<a class="file" data-act="open-file" data-id="${f.id}">📎 ${esc(f.name)}</a>`).join('');
}
function resultsTable(a) {
  if (!(a.results || []).length) return '';
  return `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th></tr></thead><tbody>${a.results.map(r => {
    const f = flag(r);
    return `<tr><td><a href="#/indicators/${encodeURIComponent(key(r.name))}">${esc(r.name)}</a></td><td class="${f}">${esc(r.value)} ${esc(r.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(r))}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function analysisCard(a) {
  const bad = (a.results || []).filter(r => ['low', 'high'].includes(flag(r))).length;
  return `<div class="card"><div class="card-head"><div><h3>${fmtDate(a.date)}${a.lab ? ' · ' + esc(a.lab) : ''}</h3>
    <div class="muted">${(a.results || []).length} показателей${bad ? `, вне нормы: ${bad}` : ''}</div></div>
    <div><button class="sm" data-act="edit-analysis" data-id="${a.id}">Изменить</button>
    <button class="sm danger" data-act="del-analysis" data-id="${a.id}">Удалить</button></div></div>
    ${resultsTable(a)}${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}<div>${fileLinks(a.files)}</div></div>`;
}
function conclusionCard(c) {
  return `<div class="card"><div class="card-head"><div><h3>${esc(c.title || c.type)}</h3>
    <div class="muted">${fmtDate(c.date)} · ${esc(c.type)}${c.doctor ? ' · ' + esc(c.doctor) : ''}</div></div>
    <div><button class="sm" data-act="edit-conclusion" data-id="${c.id}">Изменить</button>
    <button class="sm danger" data-act="del-conclusion" data-id="${c.id}">Удалить</button></div></div>
    ${c.text ? `<p class="note">${esc(c.text)}</p>` : ''}
    ${c.recs ? `<h3>Рекомендации</h3><p class="note">${esc(c.recs)}</p>` : ''}<div>${fileLinks(c.files)}</div></div>`;
}

function viewHome() {
  const sm = seriesMap();
  const lasts = [...sm.values()].map(s => ({ name: s.name, last: s.pts[s.pts.length - 1] }));
  const bad = lasts.filter(x => ['low', 'high'].includes(flag(x.last)));
  app.innerHTML = `<h2>Обзор</h2>
  <div class="grid">
    <div class="card stat"><b>${analyses.length}</b>анализов</div>
    <div class="card stat"><b>${sm.size}</b>показателей</div>
    <div class="card stat"><b>${conclusions.length}</b>заключений</div>
    <div class="card stat"><b>${bad.length}</b>вне нормы</div>
  </div>
  <div class="toolbar"><button class="primary" data-act="add-analysis">+ Анализ</button><button data-act="add-conclusion">+ Заключение</button></div>
  <div class="card"><h3>Последние значения вне нормы</h3>${bad.length ? `<table><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th><th>Дата</th></tr></thead><tbody>${bad.map(x => {
    const f = flag(x.last);
    return `<tr><td><a href="#/indicators/${encodeURIComponent(key(x.name))}">${esc(x.name)}</a></td><td class="${f}">${esc(x.last.value)} ${esc(x.last.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(x.last))}</td><td class="muted">${fmtDate(x.last.date)}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted">Нет данных вне нормы.</p>'}</div>
  <h3>Последние анализы</h3>${analyses.slice(0, 3).map(analysisCard).join('') || '<div class="empty">Пока пусто. Добавьте первый анализ.</div>'}
  <h3>Последние заключения</h3>${conclusions.slice(0, 3).map(conclusionCard).join('') || '<div class="empty">Заключений пока нет.</div>'}`;
}

function listView(title, items, card, addAct, addLabel, searchText) {
  app.innerHTML = `<h2>${title}</h2><div class="toolbar"><input type="search" id="q" placeholder="Поиск…"><button class="primary" data-act="${addAct}">${addLabel}</button></div><div id="list"></div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const f = items().filter(x => !q || searchText(x).toLowerCase().includes(q));
    $('#list').innerHTML = f.map(card).join('') || '<div class="empty">Ничего не найдено.</div>';
  };
  $('#q').addEventListener('input', draw);
  draw();
}
const viewAnalyses = () => listView('Анализы', () => analyses, analysisCard, 'add-analysis', '+ Анализ',
  a => [a.date, a.lab, a.note, ...(a.results || []).map(r => r.name)].join(' '));
const viewConclusions = () => listView('Заключения', () => conclusions, conclusionCard, 'add-conclusion', '+ Заключение',
  c => [c.date, c.type, c.title, c.doctor, c.text, c.recs].join(' '));

function viewIndicators(param) {
  const sm = seriesMap();
  const list = [...sm.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (!list.length) { app.innerHTML = '<h2>Показатели</h2><div class="empty">Сначала добавьте анализ.</div>'; return; }
  const cur = sm.get(param) || list[0];
  const rows = [...cur.pts].reverse();
  app.innerHTML = `<h2>Показатели</h2>
  <div class="toolbar"><select id="ind">${list.map(s => `<option value="${esc(key(s.name))}" ${s === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button onclick="print()">Печать</button></div>
  <div class="card"><h3>${esc(cur.name)}</h3>${chart(cur.pts)}</div>
  <div class="card"><table><thead><tr><th>Дата</th><th>Значение</th><th>Норма</th><th></th></tr></thead><tbody>${rows.map(r => {
    const f = flag(r);
    return `<tr><td>${fmtDate(r.date)}</td><td class="${f}">${esc(r.value)} ${esc(r.unit)} ${arrow(f)}</td><td class="muted">${esc(rangeText(r))}</td><td class="muted">${FLAG_TXT[f] || ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  $('#ind').addEventListener('change', e => { location.hash = '#/indicators/' + encodeURIComponent(e.target.value); });
}

function viewData() {
  app.innerHTML = `<h2>Данные</h2>
  <div class="card"><h3>Где хранятся данные</h3><p class="muted">Только в этом браузере (IndexedDB). На GitHub попадает лишь код приложения, ваши анализы — никогда. Если очистить данные сайта или сменить браузер, записи пропадут, поэтому делайте резервные копии.</p></div>
  <div class="card"><h3>Резервная копия</h3><div class="toolbar">
    <button class="primary" data-act="export">Скачать копию (JSON)</button>
    <label class="btn">Восстановить из файла<input type="file" id="imp" accept="application/json" hidden></label></div>
    <p class="muted">Файл копии содержит все данные и вложения. Не публикуйте его и не коммитьте в репозиторий.</p></div>
  <div class="card"><h3>Опасная зона</h3><button class="danger" data-act="wipe">Удалить все данные</button></div>`;
  $('#imp').addEventListener('change', e => e.target.files[0] && importData(e.target.files[0]));
}

// ---------- формы ----------
const dlg = $('#dlg');
function openDialog(html, onSubmit) {
  dlg.innerHTML = `<form>${html}</form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try { await onSubmit(form); dlg.close(); await load(); render(); } catch (err) { alert('Не удалось сохранить: ' + err.message); }
  });
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.showModal();
  return form;
}
const filesBlock = files => `${(files || []).length ? `<div class="muted">Вложения (снимите галочку, чтобы удалить):</div>${files.map(f => `<label><input type="checkbox" name="keep" value="${f.id}" checked style="width:auto"> ${esc(f.name)}</label>`).join('')}` : ''}
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

function resultRow(r = {}) {
  return `<div class="row">
    <input name="name" list="catalog" placeholder="Показатель" value="${esc(r.name)}">
    <input name="value" placeholder="Значение" value="${esc(r.value)}">
    <input name="unit" placeholder="Ед. изм." value="${esc(r.unit)}">
    <input name="min" placeholder="Мин" value="${esc(r.min)}">
    <input name="max" placeholder="Макс" value="${esc(r.max)}">
    <button type="button" class="sm" data-rm title="Убрать строку">×</button></div>`;
}
function prefill(name) {
  const last = seriesMap().get(key(name));
  if (last) { const p = last.pts[last.pts.length - 1]; return { unit: p.unit, min: p.min, max: p.max }; }
  const c = CATALOG.find(x => key(x.name) === key(name));
  return c ? { unit: c.unit, min: c.min, max: c.max } : null;
}

function analysisForm(a) {
  const isNew = !a;
  a = a || { date: today(), lab: '', note: '', results: [], files: [] };
  const form = openDialog(`<h2>${isNew ? 'Новый анализ' : 'Анализ'}</h2>
    <div class="two"><label>Дата<input type="date" name="date" required value="${esc(a.date)}"></label>
    <label>Лаборатория / клиника<input name="lab" value="${esc(a.lab)}"></label></div>
    <div class="muted">Быстро добавить набор:</div>
    <div class="chips">${Object.keys(PANELS).map(p => `<button type="button" class="sm" data-panel="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <div class="row head"><span>Показатель</span><span>Значение</span><span>Ед.</span><span>Мин</span><span>Макс</span><span></span></div>
    <div id="rows">${(a.results.length ? a.results : [{}]).map(resultRow).join('')}</div>
    <button type="button" class="sm" data-addrow>+ строка</button>
    <label style="margin-top:10px">Заметка<textarea name="note" rows="2">${esc(a.note)}</textarea></label>
    ${filesBlock(a.files)}
    <p class="muted">Референсы подставляются автоматически как ориентир — сверяйте их с бланком вашей лаборатории.</p>
    <div class="actions"><button type="button" data-close>Отмена</button><button class="primary">Сохранить</button></div>`,
  async f => {
    const results = [...f.querySelectorAll('.row:not(.head)')].map(r => {
      const g = n => r.querySelector(`[name=${n}]`).value.trim();
      return { name: g('name'), value: g('value'), unit: g('unit'), min: g('min'), max: g('max') };
    }).filter(r => r.name && r.value !== '');
    const files = await saveFiles(f, a.files);
    await DB.put('analyses', { id: a.id || uid(), date: f.elements.date.value, lab: f.elements.lab.value.trim(), note: f.elements.note.value.trim(), results, files });
  });
  const rows = $('#rows', form);
  rows.addEventListener('change', e => {
    if (e.target.name !== 'name') return;
    const p = prefill(e.target.value);
    const row = e.target.closest('.row');
    if (p && !row.querySelector('[name=unit]').value) {
      row.querySelector('[name=unit]').value = p.unit ?? '';
      row.querySelector('[name=min]').value = p.min ?? '';
      row.querySelector('[name=max]').value = p.max ?? '';
    }
  });
  form.addEventListener('click', e => {
    if (e.target.matches('[data-rm]')) e.target.closest('.row').remove();
    if (e.target.matches('[data-addrow]')) rows.insertAdjacentHTML('beforeend', resultRow());
    if (e.target.matches('[data-panel]')) {
      const have = new Set([...rows.querySelectorAll('[name=name]')].map(i => key(i.value)));
      rows.querySelectorAll('.row').forEach(r => { if (!r.querySelector('[name=name]').value.trim() && !r.querySelector('[name=value]').value) r.remove(); });
      PANELS[e.target.dataset.panel].filter(n => !have.has(key(n))).forEach(n => {
        const p = prefill(n) || {};
        rows.insertAdjacentHTML('beforeend', resultRow({ name: n, ...p }));
      });
    }
  });
}

function conclusionForm(c) {
  const isNew = !c;
  c = c || { date: today(), type: 'Приём врача', title: '', doctor: '', text: '', recs: '', files: [] };
  openDialog(`<h2>${isNew ? 'Новое заключение' : 'Заключение'}</h2>
    <div class="two"><label>Дата<input type="date" name="date" required value="${esc(c.date)}"></label>
    <label>Тип<select name="type">${CONCLUSION_TYPES.map(t => `<option ${t === c.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <div class="two"><label>Название (напр. «УЗИ щитовидной железы»)<input name="title" value="${esc(c.title)}"></label>
    <label>Врач / клиника<input name="doctor" value="${esc(c.doctor)}"></label></div>
    <label>Заключение<textarea name="text" rows="6">${esc(c.text)}</textarea></label>
    <label>Рекомендации<textarea name="recs" rows="3">${esc(c.recs)}</textarea></label>
    ${filesBlock(c.files)}
    <div class="actions"><button type="button" data-close>Отмена</button><button class="primary">Сохранить</button></div>`,
  async f => {
    const files = await saveFiles(f, c.files);
    const g = n => f.elements[n].value.trim();
    await DB.put('conclusions', { id: c.id || uid(), date: f.elements.date.value, type: f.elements.type.value, title: g('title'), doctor: g('doctor'), text: g('text'), recs: g('recs'), files });
  });
}

// ---------- резервная копия ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportData() {
  const files = [];
  for (const f of await DB.all('files')) files.push({ id: f.id, name: f.name, type: f.type, data: await blobToDataURL(f.blob) });
  const payload = { app: 'med-tracker', version: 1, exportedAt: new Date().toISOString(), analyses, conclusions, files };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `medtracker-backup-${today()}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'med-tracker') throw new Error('это не файл копии приложения');
    for (const f of d.files || []) await DB.put('files', { id: f.id, name: f.name, type: f.type, blob: await (await fetch(f.data)).blob() });
    for (const a of d.analyses || []) await DB.put('analyses', a);
    for (const c of d.conclusions || []) await DB.put('conclusions', c);
    await load(); render();
    alert('Данные восстановлены (записи с теми же id перезаписаны).');
  } catch (e) { alert('Не удалось импортировать: ' + e.message); }
}

// ---------- действия ----------
async function removeEntity(store, id) {
  const item = (store === 'analyses' ? analyses : conclusions).find(x => x.id === id);
  for (const f of item?.files || []) await DB.del('files', f.id);
  await DB.del(store, id);
  await load(); render();
}
const actions = {
  'add-analysis': () => analysisForm(),
  'edit-analysis': id => analysisForm(analyses.find(a => a.id === id)),
  'del-analysis': id => confirm('Удалить этот анализ?') && removeEntity('analyses', id),
  'add-conclusion': () => conclusionForm(),
  'edit-conclusion': id => conclusionForm(conclusions.find(c => c.id === id)),
  'del-conclusion': id => confirm('Удалить это заключение?') && removeEntity('conclusions', id),
  'open-file': async id => {
    const f = await DB.get('files', id);
    if (f) window.open(URL.createObjectURL(f.blob), '_blank');
  },
  export: exportData,
  wipe: async () => {
    if (!confirm('Удалить ВСЕ данные без возможности восстановления? Сначала сделайте копию.')) return;
    for (const s of ['analyses', 'conclusions', 'files']) await DB.clear(s);
    await load(); render();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset.id);
});

// ---------- роутер ----------
function render() {
  const [, route = '', param = ''] = location.hash.replace(/^#\/?/, '/').split('/');
  const p = decodeURIComponent(param);
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + route || (!route && a.getAttribute('href') === '#/')));
  ({ analyses: viewAnalyses, conclusions: viewConclusions, indicators: () => viewIndicators(p), data: viewData }[route] || viewHome)();
}
window.addEventListener('hashchange', render);

(async () => {
  $('#catalog').innerHTML = CATALOG.map(c => `<option value="${esc(c.name)}">`).join('');
  try {
    await DB.open();
    if (navigator.storage?.persist) navigator.storage.persist();
    await load();
    render();
  } catch (e) {
    app.innerHTML = `<div class="card">Не удалось открыть хранилище браузера: ${esc(e.message)}. В приватном режиме данные могут не сохраняться.</div>`;
  }
})();
