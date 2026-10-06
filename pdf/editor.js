/* ============================================
   TOOLREADY PDF EDITOR
   Everything runs in the browser. The PDF is read with PDF.js (display) and
   pdf-lib (saving) - both self-hosted in ./vendor - and is never uploaded.
   This page's Content-Security-Policy forbids any other network access.

   Coordinates: every annotation is stored in PDF "points" in VISUAL page
   space (origin top-left, as the page appears on screen, rotation applied).
   At save time they are converted back to PDF user space with PDF.js's
   viewport.convertToPdfPoint(), which handles rotation and crop boxes.
   ============================================ */
import * as pdfjsLib from './vendor/pdf.min.mjs';

const PDFLib = window.PDFLib;
const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = PDFLib;

const VENDOR = new URL('./vendor/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
const PDFJS_OPTIONS = {
  wasmUrl: VENDOR + 'wasm/',
  standardFontDataUrl: VENDOR + 'standard_fonts/',
  isEvalSupported: false,
  enableScripting: false,
};

const MAX_FILE_BYTES = 300 * 1024 * 1024;
const LINE_HEIGHT = 1.2;
const FONT_STACKS = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", "Noto Sans Sinhala", "Noto Sans Tamil", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", "Noto Sans Sinhala", "Noto Sans Tamil", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", "Noto Sans Sinhala", "Noto Sans Tamil", monospace',
};
const STD_FONTS = {
  Helvetica: { n: 'Helvetica', b: 'HelveticaBold', i: 'HelveticaOblique', bi: 'HelveticaBoldOblique' },
  Times: { n: 'TimesRoman', b: 'TimesRomanBold', i: 'TimesRomanItalic', bi: 'TimesRomanBoldItalic' },
  Courier: { n: 'Courier', b: 'CourierBold', i: 'CourierOblique', bi: 'CourierBoldOblique' },
};

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const state = {
  fileName: 'document.pdf',
  bytes: null,
  pdfDoc: null,
  pages: [],
  scale: 1,
  tool: 'select',
  annos: [],
  selectedId: null,
  nextId: 1,
  images: new Map(),
  nextImageId: 1,
  fields: [],
  fieldValues: new Map(),
  dirtyFields: new Set(),
  undo: [],
  redo: [],
  placement: null,
  lastSignatureId: null,
  textStyle: { font: 'Helvetica', size: 12, bold: false, italic: false, color: '#000000' },
  markColor: '#000000',
  whiteColor: '#ffffff',
  hasEdits: false,
  lastDragEnd: 0,
};

/* ---------- small helpers ---------- */
function setStatus(msg, kind = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status' + (kind ? ' ' + kind : '');
}
function showError(msg) {
  const box = $('load-error');
  box.textContent = msg;
  box.hidden = false;
}
function clearError() { $('load-error').hidden = true; }
function mk(tag, cls, parent) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.append(n);
  return n;
}
function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function snapshot() { return JSON.stringify(state.annos); }
function isHeaderSticky() {
  const header = document.querySelector('.site-header');
  return !!header && getComputedStyle(header).position === 'sticky';
}
function stickyOffset() {
  const header = document.querySelector('.site-header');
  const wrap = document.querySelector('.toolbar-wrap');
  return (header && isHeaderSticky() ? header.offsetHeight : 0) + (wrap ? wrap.offsetHeight : 0);
}
function updateHeaderVar() {
  const header = document.querySelector('.site-header');
  document.documentElement.style.setProperty('--header-h', (isHeaderSticky() ? header.offsetHeight : 0) + 'px');
}
function cssFont(a, px) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? '700' : '400'} ${px}px ${FONT_STACKS[a.font]}`;
}

/* ---------- text measuring (uses the same fonts as the on-screen text) ---------- */
const measureCtx = document.createElement('canvas').getContext('2d');
function textMetrics(a, scale) {
  measureCtx.font = cssFont(a, a.size * scale);
  const lines = a.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  return { w, h: lines.length * a.size * LINE_HEIGHT * scale };
}
const baselineCache = new Map();
// Where the first baseline sits inside a text box, as a fraction of font size,
// measured from the actual on-screen font so the saved PDF matches what you see.
function baselineRatio(a) {
  const key = a.font + (a.bold ? 'b' : '') + (a.italic ? 'i' : '');
  if (baselineCache.has(key)) return baselineCache.get(key);
  const k = 100;
  measureCtx.font = cssFont(a, k);
  const m = measureCtx.measureText('Hxg');
  const fa = m.fontBoundingBoxAscent ?? k * 0.9;
  const fd = m.fontBoundingBoxDescent ?? k * 0.22;
  const ratio = ((LINE_HEIGHT * k - (fa + fd)) / 2 + fa) / k;
  baselineCache.set(key, ratio);
  return ratio;
}

/* ============================================
   OPENING A FILE
   ============================================ */
function appError(code, cause) { const e = new Error(code); e.code = code; e.cause = cause; return e; }

function friendlyError(err) {
  if (err && err.code === 'encrypted') {
    return 'This PDF is password-protected or has security restrictions, which this editor cannot open yet. Tip: if you can open it normally, use your browser\'s Print → "Save as PDF" to make an unrestricted copy, then open that copy here.';
  }
  if (err && (err.code === 'unreadable' || (err.name && /InvalidPDF|Format/i.test(err.name)))) {
    return 'This PDF could not be read — it may be damaged or use an unusual format. Tip: open it in your browser and use Print → "Save as PDF" to make a clean copy, then try again.';
  }
  return 'Sorry, this file could not be opened. Please make sure it is a normal PDF and try again.';
}

async function openFile(file) {
  clearError();
  if (!file) return;
  if (state.pdfDoc && state.hasEdits && !window.confirm('Open a new file? Your current edits will be lost.')) return;
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) { showError('That file doesn\'t look like a PDF. Please choose a file ending in .pdf.'); return; }
  if (file.size > MAX_FILE_BYTES) { showError('That file is very large (over 300 MB). Please try a smaller PDF.'); return; }
  setStatus('Opening your PDF…');
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { showError('Could not read that file. Please try again.'); setStatus(''); return; }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (!head.includes('%PDF-')) { showError('That file is not a valid PDF (it is missing the PDF header).'); setStatus(''); return; }
  try {
    await openBytes(bytes, file.name);
  } catch (err) {
    console.error(err);
    showError(friendlyError(err));
    setStatus('');
    if (!state.pdfDoc) { $('editor-section').hidden = true; $('drop-section').hidden = false; }
  }
}

async function openBytes(bytes, name) {
  // pdf-lib must be able to rewrite the file, so check that first.
  let libDoc;
  try {
    libDoc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  } catch (e) {
    if ((PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || (e && (e.name === 'EncryptedPDFError' || /encrypted/i.test(String(e.message))))) throw appError('encrypted', e);
    throw appError('unreadable', e);
  }
  const task = pdfjsLib.getDocument({ data: bytes.slice(), ...PDFJS_OPTIONS });
  let pdfDoc;
  try { pdfDoc = await task.promise; }
  catch (e) { throw appError('unreadable', e); }

  resetDocument(false);
  state.bytes = bytes;
  state.pdfDoc = pdfDoc;
  state.fileName = name;

  const pagesEl = $('pages');
  pagesEl.replaceChildren();
  let widest = 0;
  for (let i = 0; i < pdfDoc.numPages; i++) {
    const pdfPage = await pdfDoc.getPage(i + 1);
    const vp = pdfPage.getViewport({ scale: 1 });
    widest = Math.max(widest, vp.width);
    const p = { index: i, pdfPage, vp, el: mk('div', 'page'), canvas: null, fieldLayer: null, annoLayer: null, renderedScale: null, token: 0, task: null };
    p.el.dataset.index = String(i);
    p.canvas = mk('canvas', '', p.el);
    p.fieldLayer = mk('div', 'layer field-layer', p.el);
    p.annoLayer = mk('div', 'layer anno-layer', p.el);
    p.el.addEventListener('click', onPageClick);
    p.el.addEventListener('pointerdown', onPagePointerDown);
    pagesEl.append(p.el);
    state.pages.push(p);
  }

  $('drop-section').hidden = true;
  $('editor-section').hidden = false;
  const avail = $('pages').parentElement.clientWidth - 24;
  state.scale = clamp(Math.floor((avail / widest) * 100) / 100, 0.3, 1.5);
  state.pages.forEach(sizePage);

  state.fields = readFormFields(libDoc);
  renderFields();
  observePages();
  updateZoomLabel();
  updateUndoButtons();
  const wanted = new URLSearchParams(location.search).get('tool');
  setTool(wanted === 'sign' ? 'sign' : wanted === 'text' ? 'text' : 'select');
  updatePageIndicator();
  updateHeaderVar();
  const wrapTop = document.querySelector('.toolbar-wrap').getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: Math.max(0, wrapTop - (isHeaderSticky() ? document.querySelector('.site-header').offsetHeight : 0)) });

  if (state.fields.length) {
    setStatus(`This PDF has ${state.fields.length} fillable field${state.fields.length === 1 ? '' : 's'} (highlighted in blue). Click one and type — or use the tools above for anything else.`);
  } else {
    setStatus('Pick a tool above, then click on the page. Tip: use "Whiteout" to cover existing content before typing over it.');
  }
}

function resetDocument(showDrop) {
  if (io) io.disconnect();
  for (const p of state.pages) { try { p.task && p.task.cancel(); } catch { /* ignore */ } }
  if (state.pdfDoc) { try { state.pdfDoc.destroy(); } catch { /* ignore */ } }
  for (const img of state.images.values()) URL.revokeObjectURL(img.url);
  Object.assign(state, {
    bytes: null, pdfDoc: null, pages: [], annos: [], selectedId: null, images: new Map(),
    fields: [], fieldValues: new Map(), dirtyFields: new Set(), undo: [], redo: [],
    placement: null, hasEdits: false,
  });
  $('pages').replaceChildren();
  if (showDrop) {
    $('editor-section').hidden = true;
    $('drop-section').hidden = false;
    $('file-input').value = '';
    setStatus('');
  }
}

/* ============================================
   PAGE LAYOUT + LAZY RENDERING
   ============================================ */
let io = null;
function sizePage(p) {
  p.el.style.width = p.vp.width * state.scale + 'px';
  p.el.style.height = p.vp.height * state.scale + 'px';
}

async function renderPage(p) {
  const token = ++p.token;
  if (p.task) { try { p.task.cancel(); } catch { /* ignore */ } }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let out = state.scale * dpr;
  if (p.vp.width * p.vp.height * out * out > 16e6) out = Math.sqrt(16e6 / (p.vp.width * p.vp.height));
  const viewport = p.pdfPage.getViewport({ scale: out });
  const canvas = p.canvas;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = p.vp.width * state.scale + 'px';
  canvas.style.height = p.vp.height * state.scale + 'px';
  const task = p.pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport });
  p.task = task;
  try {
    await task.promise;
    if (token === p.token) p.renderedScale = state.scale;
  } catch (e) {
    if (!e || e.name !== 'RenderingCancelledException') console.error(e);
  }
}

function releasePage(p) {
  if (p.task) { try { p.task.cancel(); } catch { /* ignore */ } }
  p.token++;
  p.canvas.width = 0;
  p.canvas.height = 0;
  p.renderedScale = null;
}

function observePages() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = state.pages[Number(e.target.dataset.index)];
      if (!p) continue;
      if (e.isIntersecting) { if (p.renderedScale !== state.scale) renderPage(p); }
      else releasePage(p);
    }
  }, { rootMargin: '900px 0px' });
  state.pages.forEach((p) => io.observe(p.el));
}

function getAnchor() {
  const top = stickyOffset();
  for (const p of state.pages) {
    const r = p.el.getBoundingClientRect();
    if (r.bottom > top + 10) return { p, frac: (top - r.top) / r.height };
  }
  return null;
}
function restoreAnchor(a) {
  if (!a) return;
  const r = a.p.el.getBoundingClientRect();
  window.scrollBy(0, r.top + a.frac * r.height - stickyOffset());
}
function setScale(next) {
  next = clamp(Math.round(next * 100) / 100, 0.25, 4);
  if (next === state.scale || !state.pdfDoc) return;
  const anchor = getAnchor();
  state.scale = next;
  state.pages.forEach((p) => { sizePage(p); p.renderedScale = null; });
  renderFields();
  renderAnnotations();
  restoreAnchor(anchor);
  observePages();
  updateZoomLabel();
}
function updateZoomLabel() { $('zoom-label').textContent = Math.round(state.scale * 100) + '%'; }

function updatePageIndicator() {
  if (!state.pages.length) return;
  const mid = stickyOffset() + (window.innerHeight - stickyOffset()) / 2;
  let best = 0, bestDist = Infinity;
  state.pages.forEach((p, i) => {
    const r = p.el.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  $('page-indicator').textContent = `Page ${best + 1} / ${state.pages.length}`;
}

/* ============================================
   FORM FIELDS (existing AcroForm fields)
   ============================================ */
function readFormFields(libDoc) {
  const out = [];
  let form, fields;
  try { form = libDoc.getForm(); fields = form.getFields(); } catch { return out; }
  const libPages = libDoc.getPages();
  const refToIndex = new Map(libPages.map((pg, i) => [String(pg.ref), i]));
  const annotToIndex = new Map();
  libPages.forEach((pg, i) => {
    try {
      const an = pg.node.Annots();
      if (an) for (let k = 0; k < an.size(); k++) annotToIndex.set(String(an.get(k)), i);
    } catch { /* ignore */ }
  });
  const pageIndexOf = (w) => {
    try {
      const P = w.P();
      if (P) { const i = refToIndex.get(String(P)); if (i !== undefined) return i; }
      const ref = libDoc.context.getObjectRef(w.dict);
      if (ref) { const i = annotToIndex.get(String(ref)); if (i !== undefined) return i; }
    } catch { /* ignore */ }
    return -1;
  };

  for (const field of fields) {
    try {
      let type = null;
      if (field instanceof PDFLib.PDFTextField) type = 'text';
      else if (field instanceof PDFLib.PDFCheckBox) type = 'check';
      else if (field instanceof PDFLib.PDFRadioGroup) type = 'radio';
      else if (field instanceof PDFLib.PDFDropdown) type = 'dropdown';
      else if (field instanceof PDFLib.PDFOptionList) type = 'list';
      if (!type) continue; // buttons, signature fields: not handled

      const widgets = field.acroField.getWidgets();
      const radioOptions = type === 'radio' ? field.getOptions() : [];
      const rects = [];
      widgets.forEach((w, idx) => {
        const pi = pageIndexOf(w);
        if (pi < 0 || !state.pages[pi]) return;
        const r = w.getRectangle();
        const vpp = state.pages[pi].vp;
        const [x1, y1] = vpp.convertToViewportPoint(r.x, r.y);
        const [x2, y2] = vpp.convertToViewportPoint(r.x + r.width, r.y + r.height);
        const rect = { page: pi, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        if (rect.w < 3 || rect.h < 3) return;
        if (type === 'radio') {
          rect.option = radioOptions.length === widgets.length
            ? radioOptions[idx]
            : (w.getOnValue() && w.getOnValue().decodeText ? w.getOnValue().decodeText() : String(idx));
        }
        rects.push(rect);
      });
      if (!rects.length) continue;

      const d = { name: field.getName(), type, rects, readOnly: false, options: [], initial: '' };
      try { d.readOnly = field.isReadOnly(); } catch { /* ignore */ }
      if (type === 'text') {
        try { d.multiline = field.isMultiline(); } catch { d.multiline = false; }
        try { d.maxLength = field.getMaxLength(); } catch { /* ignore */ }
        try { d.password = field.isPassword(); } catch { /* ignore */ }
        try { d.initial = field.getText() || ''; } catch { d.initial = ''; }
      } else if (type === 'check') {
        try { d.initial = field.isChecked(); } catch { d.initial = false; }
      } else if (type === 'radio') {
        d.options = radioOptions;
        try { d.initial = field.getSelected() || ''; } catch { d.initial = ''; }
      } else if (type === 'dropdown') {
        d.options = field.getOptions();
        try { d.initial = field.getSelected()[0] || ''; } catch { d.initial = ''; }
      } else if (type === 'list') {
        d.options = field.getOptions();
        try { d.initial = field.getSelected(); } catch { d.initial = []; }
        try { d.multi = field.isMultiselect(); } catch { d.multi = false; }
      }
      out.push(d);
    } catch (e) {
      console.warn('Skipping a form field I could not read', e);
    }
  }
  return out;
}

function fieldValue(f) { return state.fieldValues.has(f.name) ? state.fieldValues.get(f.name) : f.initial; }
function setFieldValue(f, v) {
  state.fieldValues.set(f.name, v);
  state.dirtyFields.add(f.name);
  state.hasEdits = true;
}

function renderFields() {
  state.pages.forEach((p) => p.fieldLayer.replaceChildren());
  const s = state.scale;
  for (const f of state.fields) {
    f._nodes = [];
    // Some fields appear in several places (several widgets): keep them all in sync.
    const syncOthers = (except) => f._nodes.forEach((n) => { if (n.node !== except) n.apply(); });
    for (const r of f.rects) {
      const p = state.pages[r.page];
      if (!p) continue;
      let node, apply;
      if (f.type === 'text') {
        node = document.createElement(f.multiline ? 'textarea' : 'input');
        node.classList.add('field');
        if (f.multiline) node.classList.add('field-multi'); else node.type = f.password ? 'password' : 'text';
        if (f.maxLength) node.maxLength = f.maxLength;
        node.style.fontSize = (f.multiline ? 12 : clamp(r.h * 0.7, 7, 16)) * s + 'px';
        apply = () => { node.value = fieldValue(f); };
        node.addEventListener('input', () => { setFieldValue(f, node.value); syncOthers(node); });
      } else if (f.type === 'dropdown' || f.type === 'list') {
        node = document.createElement('select');
        node.classList.add('field');
        if (f.type === 'list') { node.multiple = !!f.multi; node.size = Math.max(2, Math.min(6, f.options.length)); }
        else node.append(new Option('', ''));
        for (const o of f.options) node.append(new Option(o, o));
        apply = () => {
          const cur = fieldValue(f);
          const arr = Array.isArray(cur) ? cur : [cur];
          for (const opt of node.options) opt.selected = arr.includes(opt.value);
        };
        node.style.fontSize = clamp(r.h * 0.6, 7, 14) * s + 'px';
        node.addEventListener('change', () => {
          setFieldValue(f, f.type === 'list' ? Array.from(node.selectedOptions).map((o) => o.value) : node.value);
          syncOthers(node);
        });
      } else {
        node = document.createElement('div');
        node.classList.add('field-box');
        const input = mk('input', '', node);
        input.type = f.type === 'check' ? 'checkbox' : 'radio';
        if (f.type === 'radio') { input.name = 'r_' + f.name; node.classList.add('field-radio'); }
        mk('span', '', node);
        apply = () => { input.checked = f.type === 'check' ? !!fieldValue(f) : fieldValue(f) === r.option; };
        input.addEventListener('change', () => {
          if (f.type === 'check') setFieldValue(f, input.checked);
          else if (input.checked) setFieldValue(f, r.option);
          syncOthers(node);
        });
        input.disabled = f.readOnly;
        input.setAttribute('aria-label', f.name);
      }
      if (f.readOnly && node.tagName !== 'DIV') node.disabled = true;
      node.setAttribute('aria-label', f.name);
      node.style.left = r.x * s + 'px';
      node.style.top = r.y * s + 'px';
      node.style.width = r.w * s + 'px';
      node.style.height = r.h * s + 'px';
      p.fieldLayer.append(node);
      f._nodes.push({ node, apply });
      apply();
    }
  }
}

/* ============================================
   ANNOTATIONS (text, images, marks, whiteout)
   ============================================ */
function pushHistory(before) {
  state.undo.push(before);
  if (state.undo.length > 100) state.undo.shift();
  state.redo.length = 0;
  state.hasEdits = true;
  updateUndoButtons();
}
function updateUndoButtons() {
  $('undo-btn').disabled = state.undo.length === 0;
  $('redo-btn').disabled = state.redo.length === 0;
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  state.annos = JSON.parse(state.undo.pop());
  afterHistoryChange();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  state.annos = JSON.parse(state.redo.pop());
  afterHistoryChange();
}
function afterHistoryChange() {
  if (!state.annos.some((a) => a.id === state.selectedId)) state.selectedId = null;
  renderAnnotations();
  updateUndoButtons();
  updateProps();
}

function findAnno(id) { return state.annos.find((a) => a.id === id); }

function renderAnnotations() {
  state.pages.forEach((p) => p.annoLayer.replaceChildren());
  for (const a of state.annos) {
    const p = state.pages[a.page];
    if (p) p.annoLayer.append(createAnnoEl(a));
  }
  applySelection();
}

function positionAnno(node, a) {
  const s = state.scale;
  node.style.left = a.x * s + 'px';
  node.style.top = a.y * s + 'px';
  if (a.type !== 'text') {
    node.style.width = a.w * s + 'px';
    node.style.height = a.h * s + 'px';
  }
}

function sizeText(ta, a, node) {
  const m = textMetrics(a, state.scale);
  const pad = a.size * state.scale * 0.5;
  ta.style.width = Math.ceil(m.w + pad) + 'px';
  ta.style.height = Math.ceil(m.h) + 'px';
  node.style.width = ta.style.width;
  node.style.height = ta.style.height;
  const m1 = textMetrics(a, 1);
  a.w = m1.w + a.size * 0.5;
  a.h = m1.h;
}
function styleText(ta, a) {
  ta.style.fontFamily = FONT_STACKS[a.font];
  ta.style.fontSize = a.size * state.scale + 'px';
  ta.style.fontWeight = a.bold ? '700' : '400';
  ta.style.fontStyle = a.italic ? 'italic' : 'normal';
  ta.style.color = a.color;
}

function markSvg(a, parent) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', a.kind === 'check' ? 'M15 55 L40 85 L88 15' : 'M15 15 L85 85 M85 15 L15 85');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', a.color);
  path.setAttribute('stroke-width', '12');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  parent.append(svg);
}

function createAnnoEl(a) {
  const node = document.createElement('div');
  node.className = `anno anno-${a.type}`;
  node.dataset.id = String(a.id);
  positionAnno(node, a);

  if (a.type === 'text') {
    const ta = mk('textarea', 'anno-textarea', node);
    ta.value = a.text;
    ta.spellcheck = false;
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('aria-label', 'Text');
    styleText(ta, a);
    sizeText(ta, a, node);
    ta.addEventListener('input', () => { a.text = ta.value; sizeText(ta, a, node); state.hasEdits = true; });
    ta.addEventListener('focus', () => { select(a.id); if (ta._before === undefined) ta._before = snapshot(); });
    ta.addEventListener('blur', () => {
      const before = ta._before;
      ta._before = undefined;
      if (!a.text.trim()) { // empty text boxes are discarded
        state.annos = state.annos.filter((x) => x.id !== a.id);
        if (state.selectedId === a.id) state.selectedId = null;
        renderAnnotations();
        updateProps();
        return;
      }
      if (before !== undefined && snapshot() !== before) pushHistory(before);
    });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur(); });
    const mv = mk('div', 'anno-move', node);
    mv.textContent = '✥';
    mv.title = 'Drag to move';
    mv.addEventListener('pointerdown', (e) => startDrag(e, a, node, 'move'));
  } else {
    if (a.type === 'image') {
      const img = mk('img', '', node);
      img.src = state.images.get(a.imageId).url;
      img.alt = a.kind === 'signature' ? 'Signature' : 'Image';
      img.draggable = false;
    } else if (a.type === 'mark') {
      markSvg(a, node);
    } else if (a.type === 'whiteout') {
      node.style.backgroundColor = a.color;
    }
    node.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.anno-del') || e.target.closest('.anno-resize')) return;
      startDrag(e, a, node, 'move');
    });
    const rz = mk('div', 'anno-resize', node);
    rz.addEventListener('pointerdown', (e) => startDrag(e, a, node, 'resize'));
  }
  const del = mk('div', 'anno-del', node);
  del.textContent = '×';
  del.title = 'Delete';
  del.setAttribute('role', 'button');
  del.addEventListener('pointerdown', (e) => e.stopPropagation());
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteAnno(a.id); });
  node.addEventListener('pointerdown', () => select(a.id));
  return node;
}

function resizeAllText() {
  for (const a of state.annos) {
    if (a.type !== 'text') continue;
    const node = document.querySelector(`.anno[data-id="${a.id}"]`);
    const ta = node && node.querySelector('textarea');
    if (ta) sizeText(ta, a, node);
  }
}
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', resizeAllText);

function deleteAnno(id) {
  const before = snapshot();
  state.annos = state.annos.filter((a) => a.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  pushHistory(before);
  renderAnnotations();
  updateProps();
}

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  applySelection();
  updateProps();
}
function applySelection() {
  document.querySelectorAll('.anno').forEach((n) => n.classList.toggle('selected', Number(n.dataset.id) === state.selectedId));
}

function startDrag(e, a, node, mode) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  select(a.id);
  const before = snapshot();
  const start = { x: e.clientX, y: e.clientY, ax: a.x, ay: a.y, aw: a.w, ah: a.h };
  const vp = state.pages[a.page].vp;
  const aspect = a.w && a.h ? a.w / a.h : 1;
  const onMove = (ev) => {
    const dx = (ev.clientX - start.x) / state.scale;
    const dy = (ev.clientY - start.y) / state.scale;
    if (mode === 'move') {
      a.x = clamp(start.ax + dx, Math.min(0, vp.width - a.w), Math.max(0, vp.width - a.w));
      a.y = clamp(start.ay + dy, Math.min(0, vp.height - a.h), Math.max(0, vp.height - a.h));
    } else if (a.type === 'whiteout') {
      a.w = clamp(start.aw + dx, 6, vp.width - a.x);
      a.h = clamp(start.ah + dy, 6, vp.height - a.y);
    } else {
      a.w = clamp(start.aw + dx, 10, vp.width - a.x);
      a.h = a.w / aspect;
    }
    positionAnno(node, a);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    state.lastDragEnd = Date.now();
    if (snapshot() !== before) pushHistory(before);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function pagePoint(e, p) {
  const r = p.el.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (p.vp.width / r.width), y: (e.clientY - r.top) * (p.vp.height / r.height) };
}

function todayString() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function addText(p, pt, isDate) {
  const before = snapshot();
  const st = state.textStyle;
  const a = {
    id: state.nextId++, page: p.index, type: 'text', x: clamp(pt.x, 0, p.vp.width - 20), y: clamp(pt.y - st.size * 0.6, 0, p.vp.height - st.size),
    text: isDate ? todayString() : '', font: st.font, size: st.size, bold: st.bold, italic: st.italic, color: st.color, w: 0, h: 0,
  };
  state.annos.push(a);
  state.selectedId = a.id;
  renderAnnotations();
  const ta = document.querySelector(`.anno[data-id="${a.id}"] textarea`);
  ta._before = before;
  ta.focus();
  setTool('select');
  updateProps();
}

function addMark(p, pt, kind) {
  const before = snapshot();
  const size = 18;
  const a = {
    id: state.nextId++, page: p.index, type: 'mark', kind, x: clamp(pt.x - size / 2, 0, p.vp.width - size), y: clamp(pt.y - size / 2, 0, p.vp.height - size),
    w: size, h: size, color: state.markColor,
  };
  state.annos.push(a);
  state.selectedId = a.id;
  pushHistory(before);
  renderAnnotations();
  setTool('select');
  updateProps();
}

function addImageAt(p, pt) {
  const pl = state.placement;
  if (!pl) return;
  const before = snapshot();
  const a = {
    id: state.nextId++, page: p.index, type: 'image', kind: pl.kind, imageId: pl.imageId,
    x: clamp(pt.x - pl.w / 2, 0, Math.max(0, p.vp.width - pl.w)), y: clamp(pt.y - pl.h / 2, 0, Math.max(0, p.vp.height - pl.h)), w: pl.w, h: pl.h,
  };
  state.annos.push(a);
  state.selectedId = a.id;
  pushHistory(before);
  state.placement = null;
  renderAnnotations();
  setTool('select');
  updateProps();
}

function startWhiteout(e, p, p0) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const draft = mk('div', 'draft-rect', p.annoLayer);
  const s = state.scale;
  const onMove = (ev) => {
    const pt = pagePoint(ev, p);
    const x = Math.min(p0.x, pt.x), y = Math.min(p0.y, pt.y);
    draft.style.left = x * s + 'px'; draft.style.top = y * s + 'px';
    draft.style.width = Math.abs(pt.x - p0.x) * s + 'px'; draft.style.height = Math.abs(pt.y - p0.y) * s + 'px';
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    draft.remove();
    state.lastDragEnd = Date.now();
    const pt = pagePoint(ev, p);
    const x = clamp(Math.min(p0.x, pt.x), 0, p.vp.width), y = clamp(Math.min(p0.y, pt.y), 0, p.vp.height);
    const w = Math.min(Math.abs(pt.x - p0.x), p.vp.width - x), h = Math.min(Math.abs(pt.y - p0.y), p.vp.height - y);
    if (w < 4 || h < 4) return;
    const before = snapshot();
    const a = { id: state.nextId++, page: p.index, type: 'whiteout', x, y, w, h, color: state.whiteColor };
    state.annos.push(a);
    state.selectedId = a.id;
    pushHistory(before);
    renderAnnotations();
    updateProps();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function onPagePointerDown(e) {
  if (e.target.closest('.anno') || e.target.closest('.field') || e.target.closest('.field-box')) return;
  const p = state.pages[Number(e.currentTarget.dataset.index)];
  if (state.tool === 'whiteout') startWhiteout(e, p, pagePoint(e, p));
}

function onPageClick(e) {
  if (Date.now() - state.lastDragEnd < 100) return;
  if (e.target.closest('.anno') || e.target.closest('.field') || e.target.closest('.field-box')) return;
  const p = state.pages[Number(e.currentTarget.dataset.index)];
  const pt = pagePoint(e, p);
  switch (state.tool) {
    case 'select': select(null); break;
    case 'text': addText(p, pt, false); break;
    case 'date': addText(p, pt, true); break;
    case 'check': addMark(p, pt, 'check'); break;
    case 'cross': addMark(p, pt, 'cross'); break;
    case 'sign':
    case 'image': addImageAt(p, pt); break;
    default: break;
  }
}

/* ============================================
   TOOLS + PROPERTIES BAR
   ============================================ */
const HINTS = {
  select: 'Click an item to select it. Drag it to move; drag the round handle to resize.',
  text: 'Click on the page where you want to type.',
  date: 'Click on the page where today\'s date should go.',
  check: 'Click where the check mark should go.',
  cross: 'Click where the cross should go.',
  whiteout: 'Drag a box over what you want to cover. Note: this only HIDES content — the original text stays inside the PDF and can still be copied, so do not use it to hide sensitive information.',
  sign: 'Click on the page where your signature should go.',
  image: 'Click on the page where the image should go.',
};

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  const pages = $('pages');
  pages.className = 'pages tool-' + tool + (state.placement ? ' placing' : '');
  if (tool !== 'select') setStatus(HINTS[tool] || '');
  if (tool === 'sign' && !state.placement) openSignatureDialog();
  if (tool === 'image' && !state.placement) $('image-input').click();
  updateProps();
}

function updateProps() {
  const sel = findAnno(state.selectedId);
  const showText = (sel && sel.type === 'text') || (!sel && (state.tool === 'text' || state.tool === 'date'));
  const showColor = (sel && (sel.type === 'text' || sel.type === 'mark' || sel.type === 'whiteout')) || (!sel && (state.tool === 'text' || state.tool === 'date' || state.tool === 'check' || state.tool === 'cross' || state.tool === 'whiteout'));
  const showDelete = !!sel;
  $('props-text').hidden = !showText;
  $('props-color').hidden = !showColor;
  $('props-delete').hidden = !showDelete;
  $('props-empty').hidden = showText || showColor || showDelete;
  if (showText) {
    const src = sel && sel.type === 'text' ? sel : state.textStyle;
    $('prop-font').value = src.font;
    $('prop-size').value = src.size;
    $('prop-bold').setAttribute('aria-pressed', String(!!src.bold));
    $('prop-italic').setAttribute('aria-pressed', String(!!src.italic));
  }
  if (showColor) {
    const color = sel ? sel.color : state.tool === 'whiteout' ? state.whiteColor : (state.tool === 'check' || state.tool === 'cross') ? state.markColor : state.textStyle.color;
    $('prop-color').value = color;
  }
}

let propBefore = null;
function applyProp(change) {
  const sel = findAnno(state.selectedId);
  if (sel && sel.type === 'text') {
    if (propBefore === null) propBefore = snapshot();
    change(sel);
    const node = document.querySelector(`.anno[data-id="${sel.id}"]`);
    if (node) {
      const ta = node.querySelector('textarea');
      styleText(ta, sel);
      sizeText(ta, sel, node);
    }
  } else if (!sel) {
    change(state.textStyle);
  }
}
function commitProp() {
  if (propBefore !== null && snapshot() !== propBefore) pushHistory(propBefore);
  propBefore = null;
}

/* ============================================
   IMAGES + SIGNATURE
   ============================================ */
function storeImage(bytes, mime, w, h) {
  const id = state.nextImageId++;
  state.images.set(id, { bytes, mime, w, h, url: URL.createObjectURL(new Blob([bytes], { type: mime })) });
  return id;
}

async function rasterize(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch {
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
      img.src = url;
    });
  }
  const sw = bmp.width, sh = bmp.height;
  const k = Math.min(1, 2400 / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d');
  const isJpeg = /jpe?g/i.test(file.type);
  if (isJpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, isJpeg ? 'image/jpeg' : 'image/png', 0.92));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: isJpeg ? 'image/jpeg' : 'image/png', w: c.width, h: c.height };
}

async function onImageChosen(file) {
  if (!file) { setTool('select'); return; }
  try {
    const r = await rasterize(file);
    const id = storeImage(r.bytes, r.mime, r.w, r.h);
    const fit = Math.min(1, 240 / Math.max(r.w, r.h));
    state.placement = { imageId: id, kind: 'image', w: r.w * fit, h: r.h * fit };
    setTool('image');
  } catch {
    setStatus('Sorry, that image could not be read. Try a PNG or JPG.', 'err');
    setTool('select');
  }
}

/* --- signature dialog --- */
const sig = { tab: 'draw', ink: '#111111', style: 'script', drawing: false, last: null, mid: null, inked: false, uploaded: null };
const sigCanvas = $('sig-canvas');
const sigCtx = sigCanvas.getContext('2d');

function openSignatureDialog() {
  $('sig-error').hidden = true;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sig.inked = false;
  $('sig-reuse').hidden = state.lastSignatureId === null;
  const d = $('sig-dialog');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
function closeSignatureDialog() {
  const d = $('sig-dialog');
  if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
}
function sigPos(e) {
  const r = sigCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (sigCanvas.width / r.width), y: (e.clientY - r.top) * (sigCanvas.height / r.height) };
}
sigCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sigCanvas.setPointerCapture(e.pointerId);
  sig.drawing = true;
  const p = sigPos(e);
  sig.last = p; sig.mid = p;
  sigCtx.fillStyle = sig.ink;
  sigCtx.beginPath(); sigCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); sigCtx.fill();
  sig.inked = true;
});
sigCanvas.addEventListener('pointermove', (e) => {
  if (!sig.drawing) return;
  const p = sigPos(e);
  const mid = { x: (sig.last.x + p.x) / 2, y: (sig.last.y + p.y) / 2 };
  sigCtx.strokeStyle = sig.ink; sigCtx.lineWidth = 7; sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
  sigCtx.beginPath(); sigCtx.moveTo(sig.mid.x, sig.mid.y); sigCtx.quadraticCurveTo(sig.last.x, sig.last.y, mid.x, mid.y); sigCtx.stroke();
  sig.last = p; sig.mid = mid;
});
const endStroke = () => { sig.drawing = false; };
sigCanvas.addEventListener('pointerup', endStroke);
sigCanvas.addEventListener('pointercancel', endStroke);

function renderTypedSignature() {
  const c = $('sig-type-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const text = $('sig-text').value.trim();
  if (!text) return;
  const family = sig.style === 'script'
    ? '"Segoe Script","Snell Roundhand","Brush Script MT","Lucida Handwriting","Apple Chancery",cursive'
    : 'Georgia,"Times New Roman",serif';
  let px = 170;
  ctx.font = `italic ${px}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > c.width - 60) { px = Math.floor(px * (c.width - 60) / w); ctx.font = `italic ${px}px ${family}`; }
  ctx.fillStyle = sig.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2);
}

async function renderUploadedSignature() {
  const c = $('sig-upload-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!sig.uploaded) return;
  const img = sig.uploaded;
  const k = Math.min((c.width - 40) / img.width, (c.height - 40) / img.height, 1);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  if ($('sig-remove-bg').checked) {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum > 235) px[i + 3] = 0;
      else if (lum > 170) px[i + 3] = Math.round(((235 - lum) / 65) * px[i + 3]);
    }
    ctx.putImageData(data, 0, 0);
  }
}

function trimToContent(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const data = ctx.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  const pad = 12;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function useSignature() {
  const src = sig.tab === 'draw' ? sigCanvas : sig.tab === 'type' ? $('sig-type-canvas') : $('sig-upload-canvas');
  const trimmed = trimToContent(src);
  const err = $('sig-error');
  if (!trimmed) {
    err.textContent = sig.tab === 'draw' ? 'Please draw your signature first.' : sig.tab === 'type' ? 'Please type your name first.' : 'Please choose an image of your signature first.';
    err.hidden = false;
    return;
  }
  const blob = await new Promise((res) => trimmed.toBlob(res, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const id = storeImage(bytes, 'image/png', trimmed.width, trimmed.height);
  state.lastSignatureId = id;
  placeSignature(id);
}
function placeSignature(id) {
  const img = state.images.get(id);
  const w = Math.min(170, img.w / 3.2);
  state.placement = { imageId: id, kind: 'signature', w, h: w * (img.h / img.w) };
  closeSignatureDialog();
  setTool('sign');
}

/* ============================================
   SAVING (pdf-lib)
   ============================================ */
function canEncode(text, font) {
  const set = new Set(font.getCharacterSet());
  for (const ch of text) {
    if (ch === '\n') continue;
    if (!set.has(ch.codePointAt(0))) return false;
  }
  return true;
}

// Text with characters the standard PDF fonts cannot encode (Sinhala, Tamil,
// many accented/other scripts) is drawn by the browser (which shapes complex
// scripts correctly) and embedded as a high-resolution image.
async function renderTextToPng(a) {
  const k = 4;
  const font = cssFont(a, a.size * k);
  try { await document.fonts.load(font, a.text); } catch { /* ignore */ }
  const lines = a.text.split('\n');
  const lh = a.size * LINE_HEIGHT * k;
  measureCtx.font = font;
  let wMax = 0;
  for (const l of lines) wMax = Math.max(wMax, measureCtx.measureText(l).width);
  const c = document.createElement('canvas');
  c.width = Math.ceil(wMax + 4 * k);
  c.height = Math.ceil(lh * lines.length);
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = a.color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    const m = ctx.measureText(l);
    const fa = m.fontBoundingBoxAscent ?? a.size * k * 0.9;
    const fd = m.fontBoundingBoxDescent ?? a.size * k * 0.22;
    ctx.fillText(l, 0, i * lh + (lh - (fa + fd)) / 2 + fa);
  });
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width / k, h: c.height / k };
}

function placeImage(page, vp, img, x, y, w, h) {
  const bl = vp.convertToPdfPoint(x, y + h);
  const br = vp.convertToPdfPoint(x + w, y + h);
  const ang = (Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180) / Math.PI;
  const opts = { x: bl[0], y: bl[1], width: w, height: h };
  if (Math.abs(ang) > 0.01) opts.rotate = degrees(ang);
  page.drawImage(img, opts);
}

async function drawAnnotation(ctx, a) {
  const page = ctx.pages[a.page];
  const vp = state.pages[a.page].vp;
  const P = (x, y) => vp.convertToPdfPoint(x, y);

  if (a.type === 'whiteout') {
    const c = [P(a.x, a.y), P(a.x + a.w, a.y), P(a.x, a.y + a.h), P(a.x + a.w, a.y + a.h)];
    const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
    page.drawRectangle({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), color: hexToRgb(a.color), borderWidth: 0 });
  } else if (a.type === 'image') {
    const img = await ctx.embedStored(a.imageId);
    placeImage(page, vp, img, a.x, a.y, a.w, a.h);
  } else if (a.type === 'mark') {
    const pts = a.kind === 'check'
      ? [[0.15, 0.55], [0.4, 0.85], [0.88, 0.15]]
      : null;
    const segs = a.kind === 'check'
      ? [[pts[0], pts[1]], [pts[1], pts[2]]]
      : [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]];
    for (const [s, e] of segs) {
      const p1 = P(a.x + s[0] * a.w, a.y + s[1] * a.h), p2 = P(a.x + e[0] * a.w, a.y + e[1] * a.h);
      page.drawLine({ start: { x: p1[0], y: p1[1] }, end: { x: p2[0], y: p2[1] }, thickness: Math.max(1.2, a.w * 0.12), color: hexToRgb(a.color), lineCap: LineCapStyle.Round });
    }
  } else if (a.type === 'text') {
    await drawText(ctx, page, vp, a);
  }
}

async function drawText(ctx, page, vp, a) {
  const text = a.text.replace(/\r/g, '').replace(/\t/g, '    ');
  if (!text.trim()) return;
  const font = await ctx.stdFont(a);
  if (canEncode(text, font)) {
    const p0 = vp.convertToPdfPoint(a.x, a.y), p1 = vp.convertToPdfPoint(a.x + 10, a.y);
    const ang = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI;
    const base = baselineRatio(a) * a.size;
    text.split('\n').forEach((line, i) => {
      if (!line) return;
      const q = vp.convertToPdfPoint(a.x, a.y + base + i * a.size * LINE_HEIGHT);
      const opts = { x: q[0], y: q[1], size: a.size, font, color: hexToRgb(a.color) };
      if (Math.abs(ang) > 0.01) opts.rotate = degrees(ang);
      page.drawText(line, opts);
    });
  } else {
    const r = await renderTextToPng({ ...a, text });
    const img = await ctx.doc.embedPng(r.bytes);
    placeImage(page, vp, img, a.x, a.y, r.w, r.h);
  }
}

async function applyFormValues(ctx) {
  const form = ctx.doc.getForm();
  const helv = await ctx.doc.embedFont(StandardFonts.Helvetica);
  for (const name of state.dirtyFields) {
    const f = state.fields.find((x) => x.name === name);
    if (!f) continue;
    const val = state.fieldValues.get(name);
    let field;
    try { field = form.getField(name); } catch { continue; }
    if (f.type === 'text') {
      const text = String(val ?? '').replace(/\r/g, '');
      if (canEncode(text, helv)) {
        field.setText(text === '' ? undefined : text);
      } else {
        // Characters a PDF form field cannot hold: clear the field and draw the text on the page.
        field.setText(undefined);
        for (const r of f.rects) {
          const size = clamp(r.h * 0.7, 7, 14);
          await drawText(ctx, ctx.pages[r.page], state.pages[r.page].vp, {
            type: 'text', page: r.page, text, font: 'Helvetica', size, bold: false, italic: false, color: '#000000',
            x: r.x + 2, y: r.y + (r.h - size * LINE_HEIGHT) / 2,
          });
        }
      }
    } else if (f.type === 'check') {
      if (val) field.check(); else field.uncheck();
    } else if (f.type === 'radio') {
      if (val) field.select(val); else field.clear();
    } else if (f.type === 'dropdown') {
      if (val) field.select(val); else field.clear();
    } else if (f.type === 'list') {
      if (Array.isArray(val) && val.length) field.select(val); else field.clear();
    }
  }
}

async function buildPdf() {
  const doc = await PDFDocument.load(state.bytes.slice(), { updateMetadata: false });
  const fontCache = new Map();
  const imgCache = new Map();
  const ctx = {
    doc,
    pages: doc.getPages(),
    async stdFont(a) {
      const key = (a.bold ? 'b' : '') + (a.italic ? 'i' : '');
      const name = STD_FONTS[a.font][key || 'n'];
      if (!fontCache.has(name)) fontCache.set(name, await doc.embedFont(StandardFonts[name]));
      return fontCache.get(name);
    },
    async embedStored(id) {
      if (!imgCache.has(id)) {
        const s = state.images.get(id);
        imgCache.set(id, s.mime === 'image/jpeg' ? await doc.embedJpg(s.bytes) : await doc.embedPng(s.bytes));
      }
      return imgCache.get(id);
    },
  };
  if (state.dirtyFields.size) await applyFormValues(ctx);
  for (const a of state.annos) await drawAnnotation(ctx, a);
  return doc.save();
}

async function downloadPdf() {
  if (!state.pdfDoc) return;
  const btn = $('download-btn');
  btn.disabled = true;
  setStatus('Preparing your PDF…');
  try {
    const bytes = await buildPdf();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    state.hasEdits = false;
    setStatus('Done — your edited PDF was created on your device and downloaded. Nothing was uploaded.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Sorry, something went wrong while saving this PDF. Please try again, or try a simpler copy of the file.', 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ============================================
   WIRING
   ============================================ */
function init() {
  $('header-search').addEventListener('click', () => { location.href = '../index.html'; });

  const fileInput = $('file-input');
  $('choose-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', () => openFile(fileInput.files[0]));
  const dz = $('dropzone');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  window.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dz.classList.remove('dragover'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tool !== 'sign' && b.dataset.tool !== 'image') state.placement = null;
    if (b.dataset.tool === 'sign' || b.dataset.tool === 'image') state.placement = null;
    setTool(b.dataset.tool);
  }));
  $('image-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onImageChosen(f); });
  $('image-input').addEventListener('cancel', () => { if (state.tool === 'image' && !state.placement) setTool('select'); });

  $('undo-btn').addEventListener('click', undo);
  $('redo-btn').addEventListener('click', redo);
  $('zoom-in').addEventListener('click', () => setScale(state.scale * 1.2));
  $('zoom-out').addEventListener('click', () => setScale(state.scale / 1.2));
  $('download-btn').addEventListener('click', downloadPdf);
  $('close-btn').addEventListener('click', () => {
    if (state.hasEdits && !window.confirm('Close this file? Your edits will be lost.')) return;
    resetDocument(true);
  });

  // properties bar
  $('prop-font').addEventListener('change', (e) => { applyProp((t) => { t.font = e.target.value; }); commitProp(); });
  $('prop-size').addEventListener('input', (e) => { const v = clamp(Number(e.target.value) || 12, 4, 144); applyProp((t) => { t.size = v; }); });
  $('prop-size').addEventListener('change', commitProp);
  $('prop-bold').addEventListener('click', () => { applyProp((t) => { t.bold = !t.bold; }); commitProp(); updateProps(); });
  $('prop-italic').addEventListener('click', () => { applyProp((t) => { t.italic = !t.italic; }); commitProp(); updateProps(); });
  $('prop-color').addEventListener('input', (e) => {
    const sel = findAnno(state.selectedId);
    const v = e.target.value;
    if (sel) {
      if (propBefore === null) propBefore = snapshot();
      sel.color = v;
      renderAnnotations();
    } else if (state.tool === 'whiteout') state.whiteColor = v;
    else if (state.tool === 'check' || state.tool === 'cross') state.markColor = v;
    else state.textStyle.color = v;
  });
  $('prop-color').addEventListener('change', commitProp);
  $('prop-delete').addEventListener('click', () => { if (state.selectedId !== null) deleteAnno(state.selectedId); });

  // dialogs
  const vd = $('verify-dialog');
  $('verify-btn').addEventListener('click', () => { if (vd.showModal) vd.showModal(); else vd.setAttribute('open', ''); });
  $('verify-close').addEventListener('click', () => { if (vd.close) vd.close(); else vd.removeAttribute('open'); });

  document.querySelectorAll('[data-sig-tab]').forEach((t) => t.addEventListener('click', () => {
    sig.tab = t.dataset.sigTab;
    document.querySelectorAll('[data-sig-tab]').forEach((x) => x.classList.toggle('active', x === t));
    ['draw', 'type', 'upload'].forEach((n) => { $('sig-' + n).hidden = n !== sig.tab; });
    $('sig-error').hidden = true;
    if (sig.tab === 'type') { renderTypedSignature(); $('sig-text').focus(); }
  }));
  document.querySelectorAll('[data-ink]').forEach((b) => b.addEventListener('click', () => {
    sig.ink = b.dataset.ink;
    document.querySelectorAll('[data-ink]').forEach((x) => x.classList.toggle('active', x === b));
    if (sig.tab === 'type') renderTypedSignature();
  }));
  document.querySelectorAll('[data-sig-style]').forEach((b) => b.addEventListener('click', () => {
    sig.style = b.dataset.sigStyle;
    document.querySelectorAll('[data-sig-style]').forEach((x) => x.classList.toggle('active', x === b));
    renderTypedSignature();
  }));
  $('sig-text').addEventListener('input', renderTypedSignature);
  $('sig-clear').addEventListener('click', () => { sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sig.inked = false; });
  $('sig-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => { sig.uploaded = img; renderUploadedSignature(); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); $('sig-error').textContent = 'That image could not be read.'; $('sig-error').hidden = false; };
    img.src = url;
  });
  $('sig-remove-bg').addEventListener('change', renderUploadedSignature);
  $('sig-use').addEventListener('click', useSignature);
  $('sig-reuse').addEventListener('click', () => placeSignature(state.lastSignatureId));
  $('sig-cancel').addEventListener('click', () => { closeSignatureDialog(); setTool('select'); });
  $('sig-dialog').addEventListener('cancel', () => { setTool('select'); });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (!state.pdfDoc) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === 'Escape') { state.placement = null; select(null); setTool('select'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId !== null) { e.preventDefault(); deleteAnno(state.selectedId); }
    else if (e.key.startsWith('Arrow') && state.selectedId !== null) {
      const a = findAnno(state.selectedId);
      if (!a) return;
      e.preventDefault();
      const before = snapshot();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') a.x -= step; if (e.key === 'ArrowRight') a.x += step;
      if (e.key === 'ArrowUp') a.y -= step; if (e.key === 'ArrowDown') a.y += step;
      pushHistory(before);
      renderAnnotations();
    }
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updatePageIndicator(); ticking = false; });
  }, { passive: true });
  window.addEventListener('resize', updateHeaderVar);
  updateHeaderVar();
  window.addEventListener('beforeunload', (e) => { if (state.hasEdits) { e.preventDefault(); e.returnValue = ''; } });
}

init();
