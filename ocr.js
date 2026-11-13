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

  async function ocrCanvas(canvas, progress) {
    const w = await getWorker();
    onProgress = progress;
    try { return (await w.recognize(canvas)).data.text || ''; } finally { onProgress = null; }
  }

  // текстовый слой PDF: собираем строки по вертикальной координате
  function linesFromItems(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x, s: it.str });
    }
    return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ')).join('\n');
  }

  async function pdfToText(blob, progress) {
    await loadScript('vendor/pdfjs/pdf.min.js');
    const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    lib.GlobalWorkerOptions.workerSrc = abs('vendor/pdfjs/pdf.worker.min.js');
    const pdf = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const n = Math.min(pdf.numPages, 15);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      let text = linesFromItems((await page.getTextContent()).items);
      if ((text.match(/[A-Za-zА-Яа-я]/g) || []).length < 40) {
        // скан внутри PDF: рисуем страницу и распознаём
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        text = await ocrCanvas(c, p => progress && progress((i - 1 + p) / n));
      }
      out.push(text);
      if (progress) progress(i / n);
    }
    return out.join('\n');
  }

  return {
    async recognize(blob, type, progress) {
      if (type === 'application/pdf') return pdfToText(blob, progress);
      return ocrCanvas(await toCanvas(blob), progress);
    },
  };
})();
