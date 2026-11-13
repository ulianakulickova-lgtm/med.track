'use strict';
/* Распознавание текста на устройстве: Tesseract (фото, сканы) и pdf.js (PDF).
   Библиотеки и языковые данные лежат в папке vendor — файлы никуда не отправляются. */
const OCR = (() => {
  const abs = p => new URL(p, document.baseURI).href;
  const loaded = {};
  const loadScript = src => (loaded[src] = loaded[src] || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('не удалось загрузить ' + src));
    document.head.appendChild(s);
  }));

  let workerP = null, onProgress = null;
  function getWorker() {
    if (!workerP) {
      workerP = loadScript('vendor/tesseract/tesseract.min.js').then(() => Tesseract.createWorker(['rus', 'eng'], 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
      })).then(async w => {
        // режим «одна колонка»: строки таблиц анализов не разрываются на части
        await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
        return w;
      });
      workerP.catch(() => { workerP = null; });
    }
    return workerP;
  }

  async function toCanvas(blob, maxSide = 2600) {
    let img;
    try { img = await createImageBitmap(blob); } catch (e) {
      img = await new Promise((res, rej) => {
        const i = new Image(); const url = URL.createObjectURL(blob);
        i.onload = () => { URL.revokeObjectURL(url); res(i); };
        i.onerror = () => { URL.revokeObjectURL(url); rej(new Error('не удалось открыть изображение')); };
        i.src = url;
      });
    }
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Результат распознавания: текст и строки со словами и их координатами
  // (координаты нужны, чтобы разложить таблицу анализа по колонкам).
  async function ocrCanvas(canvas, progress, yOffset = 0) {
    const w = await getWorker();
    onProgress = progress;
    try {
      const { data } = await w.recognize(canvas);
      const lines = (data.lines || []).map(l => ({
        y: yOffset + l.bbox.y1, h: l.bbox.y1 - l.bbox.y0,
        cells: (l.words || []).filter(x => x.text && x.text.trim()).map(x => ({ x0: x.bbox.x0, x1: x.bbox.x1, s: x.text.trim() })),
      })).filter(l => l.cells.length);
      return { text: data.text || '', lines };
    } finally { onProgress = null; }
  }

  // текстовый слой PDF: собираем строки по вертикальной координате
  function linesFromItems(items, pageH, yOffset) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = pageH - it.transform[5], h = it.height || Math.abs(it.transform[3]) || 10;
      let row = rows.find(r => Math.abs(r.y0 - y) < 2.5);
      if (!row) rows.push(row = { y0: y, y: yOffset + y, h, cells: [] });
      row.cells.push({ x0: x, x1: x + (it.width || it.str.length * h * 0.5), s: it.str.trim() });
    }
    rows.sort((a, b) => a.y - b.y).forEach(r => r.cells.sort((a, b) => a.x0 - b.x0));
    return rows;
  }

  async function pdfToText(blob, progress) {
    await loadScript('vendor/pdfjs/pdf.min.js');
    const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    lib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js');
    const pdf = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const n = Math.min(pdf.numPages, 15);
    const out = { text: '', lines: [] };
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const yOffset = (i - 1) * 100000;
      const rows = linesFromItems((await page.getTextContent()).items, page.getViewport({ scale: 1 }).height, yOffset);
      let res = { text: rows.map(r => r.cells.map(c => c.s).join(' ')).join('\n'), lines: rows };
      if ((res.text.match(/[A-Za-zА-Яа-я]/g) || []).length < 40) {
        // скан внутри PDF: рисуем страницу и распознаём
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        res = await ocrCanvas(c, v => progress && progress((i - 1 + v) / n), yOffset);
      }
      out.text += (out.text ? '\n' : '') + res.text;
      out.lines.push(...res.lines);
      if (progress) progress(i / n);
    }
    return out;
  }

  return {
    async recognize(blob, type, progress) {
      if (type === 'application/pdf') return pdfToText(blob, progress);
      return ocrCanvas(await toCanvas(blob), progress);
    },
  };
})();
