'use strict';

const WELCOME = `# Bienvenido a Capital

Capital es un editor de Markdown que muestra el texto ya formateado mientras escribís. Los símbolos aparecen solo cuando el cursor está encima.

Para empezar, abrí la carpeta donde guardás tus escritos con **Abrir carpeta**, a la izquierda. Los cambios se guardan solos en el archivo.

En el menú **Estilo** elegís la fuente, la letra capitular, el tamaño de página y cómo se ven los capítulos.

# Lo básico

Un numeral y un espacio al principio de la línea crean un capítulo, que siempre empieza en una página nueva. Dos numerales, un subtítulo. Tres guiones seguidos y Enter dejan un salto de página.

> Las citas empiezan con el signo mayor.
`;

const $ = (id) => document.getElementById(id);
const shell = $('shell'), desk = $('desk'), tree = $('tree'), book = $('book'), pagesEl = $('pages');
const state = { editor: null, root: null, file: null, target: null, dirty: false, loading: false, openDirs: new Set(), step: 0, tocClosed: new Set() };
const FS_OK = 'showDirectoryPicker' in window;
const PAGES_OK = CSS.supports('column-wrap', 'wrap') && CSS.supports('column-height', '1px');

/* ---------- Estilo del libro ---------- */
const FONTS = [
  { id: 'Gelasio', note: 'Sobria, de pantalla' },
  { id: 'EB Garamond', note: 'Garamond renacentista', scale: 1.08 },
  { id: 'Cormorant Garamond', note: 'Garamond elegante', scale: 1.16 },
  { id: 'Libre Baskerville', note: 'Baskerville', scale: 0.9 },
  { id: 'Crimson Pro', note: 'Libro contemporáneo', scale: 1.08 },
  { id: 'Spectral', note: 'Editorial' },
  { id: 'Literata', note: 'Para lectura larga', scale: 0.96 },
  { id: 'Alegreya', note: 'Caligráfica', scale: 1.02 },
  { id: 'IM Fell English', note: 'Imprenta antigua', scale: 1.04 },
];
const OPTIONS = {
  dropcap: [['none', 'Ninguna'], ['clasica', 'Clásica'], ['elevada', 'Elevada'], ['ornamental', 'Ornamental']],
  dropLines: [['2', '2 líneas'], ['3', '3 líneas'], ['4', '4 líneas']],
  chapter: [['versalitas', 'Versalitas'], ['ornamento', 'Con ornamento'], ['cursiva', 'Cursiva'], ['moderno', 'Moderno']],
  level: [['auto', 'Automático'], ['1', '#'], ['2', '##']],
  breaks: [['titulos', 'Todos los títulos'], ['capitulos', 'Solo capítulos']],
  quote: [['cursiva', 'Cursiva'], ['clasica', 'Clásica'], ['linea', 'Con línea'], ['comillas', 'Con comillas']],
  scene: [['asterismo', '⁂'], ['asteriscos', '* * *'], ['hoja', '❦'], ['blanco', 'En blanco']],
  notes: [['numeros', '¹ ² ³'], ['bordo', '¹ ² ³ en bordó'], ['simbolos', '* † ‡']],
  olStyle: [['decimal', '1.'], ['paren', '1)'], ['alpha', 'a.'], ['roman', 'i.']],
  ulStyle: [['disc', '•'], ['dash', '—'], ['circle', '◦']],
  para: [['sangria', 'Sangría'], ['amplia', 'Sangría amplia'], ['nada', 'Sin sangría'], ['espacio', 'Espacio entre párrafos']],
  page: [['a5', 'Novela A5'], ['6x9', '6 × 9 in'], ['a4', 'A4'], ['continuo', 'Sin páginas']],
};
const PRESETS = {
  tinta: { name: 'Capital', desc: 'Sobria y legible', font: 'Gelasio', size: 17, leading: 1.85, dropcap: 'none', firstline: false, chapter: 'versalitas', para: 'amplia', justify: false },
  clasico: { name: 'Clásico', desc: 'Novela tradicional', font: 'EB Garamond', size: 17, leading: 1.6, dropcap: 'clasica', firstline: true, chapter: 'ornamento', para: 'sangria', justify: true },
  antiguo: { name: 'Edición antigua', desc: 'Imprenta de época', font: 'IM Fell English', size: 17, leading: 1.65, dropcap: 'ornamental', firstline: true, chapter: 'versalitas', para: 'sangria', justify: true },
  moderno: { name: 'Contemporáneo', desc: 'Limpio y actual', font: 'Literata', size: 16.5, leading: 1.75, dropcap: 'elevada', firstline: false, chapter: 'moderno', para: 'sangria', justify: false },
};
const PAGE_SIZES = { a5: [148, 210], '6x9': [152.4, 228.6], a4: [210, 297] };
const STYLE_KEYS = ['font', 'size', 'leading', 'dropcap', 'firstline', 'chapter', 'para', 'justify'];
const presetValues = (p) => Object.fromEntries(STYLE_KEYS.map((k) => [k, p[k]]));
const STYLE_DEFAULTS = { preset: 'tinta', ...presetValues(PRESETS.tinta), page: 'a5', folios: true, chapterSpace: true, level: 'auto', breaks: 'titulos', dropLines: '3', olStyle: 'decimal', ulStyle: 'disc', quote: 'cursiva', scene: 'asterismo', notes: 'numeros' };
// Opciones que no forman parte de los estilos predefinidos: cambiarlas no deselecciona el estilo
const LOOSE_KEYS = ['page', 'level', 'breaks', 'dropLines', 'olStyle', 'ulStyle', 'quote', 'scene', 'notes'];
// Un párrafo con solo este signo es un cambio de escena (se escribe *** y Enter)
const SCENE = '⁂';
let style = { ...STYLE_DEFAULTS };

/* ---------- Guardado de preferencias ---------- */
function pref(key, fallback) {
  try { const v = localStorage.getItem('tinta:' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem('tinta:' + key, JSON.stringify(value)); } catch (e) {}
}
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tinta', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(key, value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const store = db.transaction('kv', value === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    const q = value === undefined ? store.get(key) : store.put(value, key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

/* ---------- Ajustes compartidos entre equipos ---------- */
// Se guardan también en "capital-ajustes.json", dentro de la carpeta abierta. Si esa carpeta está en
// Google Drive, las palabras del diccionario, los estilos propios y el estilo de cada archivo pasan
// solos a la otra computadora. Al leer se mezclan: gana el cambio más reciente de cada cosa.
const SYNC_FILE = 'capital-ajustes.json';
const SYNC_KEYS = ['spellWords', 'myStyles', 'bookStyles'];

function setSyncedPref(key, value) { setPref(key, value); scheduleSync(); }
function scheduleSync() { clearTimeout(scheduleSync.timer); scheduleSync.timer = setTimeout(syncNow, 1500); }

function mergeSync(a, b) {
  const newer = (x, y) => (!x ? y : !y ? x : (y.t || 0) > (x.t || 0) ? y : x);
  const byKey = (x = {}, y = {}) => { const out = { ...x }; for (const k in y) out[k] = newer(x[k], y[k]); return out; };
  return {
    spellWords: [...new Set([...(a.spellWords || []), ...(b.spellWords || [])])].sort((x, y) => x.localeCompare(y, 'es')),
    myStyles: byKey(a.myStyles, b.myStyles),
    bookStyles: byKey(a.bookStyles, b.bookStyles),
  };
}

function syncNow() {
  // Una sincronización por vez
  syncNow.chain = (syncNow.chain || Promise.resolve()).then(syncOnce).catch((e) => console.warn('Ajustes compartidos:', e));
  return syncNow.chain;
}

async function syncOnce() {
  const root = state.root;
  if (!root) return;
  let remote = {};
  try { remote = JSON.parse(await (await (await root.getFileHandle(SYNC_FILE)).getFile()).text()); } catch (e) { /* todavía no existe */ }
  const local = Object.fromEntries(SYNC_KEYS.map((k) => [k, pref(k, k === 'spellWords' ? [] : {})]));
  const merged = mergeSync(local, remote);
  if (SYNC_KEYS.some((k) => JSON.stringify(merged[k]) !== JSON.stringify(local[k]))) {
    for (const k of SYNC_KEYS) setPref(k, merged[k]);
    applySynced();
  }
  if (SYNC_KEYS.some((k) => JSON.stringify(merged[k]) !== JSON.stringify(remote[k]))) {
    const w = await (await root.getFileHandle(SYNC_FILE, { create: true })).createWritable();
    await w.write(JSON.stringify({ app: 'Capital', nota: 'Ajustes de Capital compartidos entre tus equipos. No hace falta abrirlo.', ...merged }, null, 1));
    await w.close();
  }
}

// Lo que llegó del otro equipo se ve enseguida
function applySynced() {
  renderPresets();
  paintSpell();
  const b = bookOf(state.file);
  const saved = b && pref('bookStyles', {})[b.key];
  if (saved) {
    const { t, ...s } = saved;
    if (JSON.stringify({ ...STYLE_DEFAULTS, ...s }) !== JSON.stringify(style)) loadBookStyle();
  }
}

/* ---------- Avisos ---------- */
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}
function setSaveState(text) { $('saveState').textContent = text; }

/* ---------- Estilo y páginas ---------- */
function applyStyle() {
  const f = FONTS.find((x) => x.id === style.font) || FONTS[0];
  const root = document.documentElement.style;
  root.setProperty('--font-body', `'${f.id}', Georgia, serif`);
  root.setProperty('--lh', style.leading);
  root.setProperty('--dc-lines', style.dropLines);
  const d = document.body.dataset;
  d.dropcap = style.dropcap;
  d.chapter = style.chapter;
  d.para = style.para;
  d.justify = style.justify ? 'yes' : 'no';
  d.firstline = style.firstline ? 'yes' : 'no';
  d.folios = style.folios ? 'yes' : 'no';
  d.chapterSpace = style.chapterSpace ? 'yes' : 'no';
  d.breaks = style.breaks;
  d.ol = style.olStyle;
  d.ul = style.ulStyle;
  d.quote = style.quote;
  d.scene = style.scene;
  d.notes = style.notes;
  setPref('style', style);
  // Cada archivo recuerda su estilo (con la hora del cambio, para saber cuál es el más nuevo entre equipos)
  const b = bookOf(state.file);
  if (b) {
    const all = pref('bookStyles', {});
    const { t, ...old } = all[b.key] || {};
    if (JSON.stringify(old) !== JSON.stringify(style)) { all[b.key] = { ...style, t: Date.now() }; setSyncedPref('bookStyles', all); }
  }
  layout();
}

// Clave del estilo de cada archivo; `folder` es la de la versión anterior, que guardaba un estilo por carpeta
function bookOf(file) {
  if (!file) return null;
  const name = file.handle.name.replace(/\.(md|markdown|txt)$/i, '');
  if (file.single || !state.root) return { key: 'archivo:' + file.handle.name, name };
  const i = file.path.lastIndexOf('/');
  const dir = i < 0 ? '' : file.path.slice(0, i);
  return { key: state.root.name + '/' + file.path, folder: state.root.name + '/' + dir, name };
}

function loadBookStyle() {
  const b = bookOf(state.file);
  const all = pref('bookStyles', {});
  const saved = b && (all[b.key] || (b.folder !== undefined && all[b.folder]));
  if (saved) { const { t, ...s } = saved; style = { ...STYLE_DEFAULTS, ...s }; }
  $('drawerBook').textContent = b ? 'Estilo de «' + b.name + '»' : '';
  refreshStyle();
}

function layout() {
  const paged = PAGES_OK && style.page !== 'continuo';
  document.body.dataset.paged = paged ? 'yes' : 'no';
  const [mw, mh] = PAGE_SIZES[style.page] || PAGE_SIZES.a5;
  // El zoom agranda la hoja y la letra juntas, así cada página conserva el mismo texto
  const base = style.page === 'a4' ? 760 : 640;
  const fit = (desk.clientWidth - 32) / base;
  const z = state.zoom > 1 ? state.zoom : Math.max(280 / base, Math.min(state.zoom, fit));
  const W = Math.round(base * z);
  const f = FONTS.find((x) => x.id === style.font) || FONTS[0];
  document.documentElement.style.setProperty('--fs', (style.size * (f.scale || 1) * z).toFixed(2) + 'px');
  document.documentElement.style.setProperty('--zoom', z);
  const H = Math.round(W * mh / mw);
  const narrow = W < 520;
  const top = Math.round(H * (narrow ? 0.06 : 0.09));
  const bottom = Math.round(H * (narrow ? 0.07 : 0.1));
  const side = Math.round(W * (narrow ? 0.07 : 0.13));
  const gap = narrow ? 24 : 40;
  const s = document.documentElement.style;
  s.setProperty('--page-w', W + 'px');
  s.setProperty('--page-h', H + 'px');
  s.setProperty('--m-top', top + 'px');
  s.setProperty('--m-bottom', bottom + 'px');
  s.setProperty('--m-side', side + 'px');
  s.setProperty('--content-h', (H - top - bottom) + 'px');
  s.setProperty('--gap', gap + 'px');
  printSetup(mw, mh, f);
  state.step = paged ? H + gap : 0;
  state.contentH = H - top - bottom;
  state.gap = gap;
  paginate();
  // Si la hoja es más ancha que la ventana, centrar el desplazamiento horizontal
  desk.scrollLeft = (desk.scrollWidth - desk.clientWidth) / 2;
}

// Dibuja una hoja de papel detrás de cada página que ocupa el texto
function paginate() {
  const pre = editorRoot();
  if (!pre || state.source) return;
  document.body.dataset.level = chapterLevel(pre);
  markScenes();
  if (!state.step) {
    pagesEl.innerHTML = '';
    book.style.height = '';
  } else {
    const rowGap = state.step - state.contentH;
    const n = Math.max(1, Math.round((pre.offsetHeight + rowGap) / state.step));
    while (pagesEl.children.length < n) {
      const page = document.createElement('div');
      page.className = 'page';
      page.innerHTML = '<span class="folio"></span>';
      pagesEl.append(page);
    }
    while (pagesEl.children.length > n) pagesEl.lastChild.remove();
    [...pagesEl.children].forEach((page, i) => {
      page.style.top = i * state.step + 'px';
      page.firstChild.textContent = i + 1;
    });
    book.style.height = (n * state.step - state.gap) + 'px';
  }
  renderOutline();
  schedulePosition();
  updateToEnd();
}

// Página real para el PDF: mismo tamaño, márgenes y letra que en pantalla, en milímetros
function printSetup(mw, mh, f) {
  const top = mh * 0.09, bottom = mh * 0.1, side = mw * 0.13;
  const base = style.page === 'a4' ? 760 : 640;
  const fsMm = style.size * (f.scale || 1) * mw / base;
  const contentMm = mh - top - bottom;
  const s = document.documentElement.style;
  s.setProperty('--fs-print', fsMm.toFixed(2) + 'mm');
  s.setProperty('--chapter-space-print', (contentMm * 0.22).toFixed(1) + 'mm');
  s.setProperty('--title-space-print', (contentMm * 0.3).toFixed(1) + 'mm');
  const folio = style.folios
    ? `@bottom-center { content: counter(page); font-family: '${f.id}', Georgia, serif; font-size: ${(fsMm * 0.72).toFixed(2)}mm; color: #8a8378; vertical-align: top; padding-top: ${(bottom * 0.18).toFixed(1)}mm; }`
    : '';
  $('printPage').textContent =
    `@page { size: ${mw}mm ${mh}mm; margin: ${top.toFixed(1)}mm ${side.toFixed(1)}mm ${bottom.toFixed(1)}mm; ${folio} }`;
}

function exportPdf() {
  if (state.source) toggleSource();
  closeMenus();
  if (document.activeElement) document.activeElement.blur();
  const prev = document.title;
  if (state.file) document.title = state.file.handle.name.replace(/\.(md|markdown|txt)$/i, '');
  toast('Elegí "Guardar como PDF" como destino');
  setTimeout(() => { window.print(); document.title = prev; }, 150);
}

// Automático: si hay un solo # (el título del libro) y algún ##, los capítulos son ##
function chapterLevel(pre) {
  if (style.level !== 'auto') return style.level;
  const h1 = pre.querySelectorAll(':scope > h1').length;
  const h2 = pre.querySelectorAll(':scope > h2').length;
  return h1 <= 1 && h2 > 0 ? '2' : '1';
}

function setZoom(z) {
  state.zoom = Math.round(Math.min(2, Math.max(0.5, z)) * 100) / 100;
  setPref('zoom', state.zoom);
  $('zoomRange').value = Math.round(state.zoom * 100);
  $('zoomOut').textContent = $('zoomLabel').textContent = Math.round(state.zoom * 100) + ' %';
  const anchor = desk.scrollTop / Math.max(1, desk.scrollHeight);
  layout();
  desk.scrollTop = anchor * desk.scrollHeight;
}

function pageOf(el) {
  if (!state.step) return null;
  const y = el.getBoundingClientRect().top - pagesEl.getBoundingClientRect().top;
  return Math.floor(y / state.step) + 1;
}

/* Panel de estilo */
function seg(key, title) {
  return `<section><h3>${title}</h3><div class="seg" data-key="${key}">` +
    OPTIONS[key].map(([v, label]) => `<button type="button" data-val="${v}">${label}</button>`).join('') + '</div>';
}
function check(key, label) {
  return `<label class="check"><input type="checkbox" data-key="${key}" id="opt-${key}"> ${label}</label>`;
}
function buildDrawer() {
  $('drawerBody').innerHTML =
    '<section><h3>Estilos</h3><div class="presets" id="presetGrid"></div>' +
      '<button type="button" class="save-style" id="saveStyleBtn">+ Guardar el estilo actual</button></section>' +
    '<section><h3>Fuente</h3><div class="fonts">' +
      FONTS.map((f) => `<button type="button" class="font-opt" data-font="${f.id}" style="font-family:'${f.id}'"><span class="aa">Aa</span><span class="fn">${f.id}</span><span class="fd">${f.note}</span></button>`).join('') +
    '</div>' +
    '<label class="range">Tamaño <input type="range" id="opt-size" data-key="size" min="13" max="24" step="0.5"><output id="out-size"></output></label>' +
    '<label class="range">Interlineado <input type="range" id="opt-leading" data-key="leading" min="1.3" max="2.2" step="0.05"><output id="out-leading"></output></label>' +
    '</section>' +
    seg('dropcap', 'Letra capitular') + check('firstline', 'Primera línea en versalitas') + '</section>' +
    seg('dropLines', 'Alto de la capitular') + '</section>' +
    seg('chapter', 'Títulos de capítulo') + check('chapterSpace', 'Espacio antes de cada capítulo') + '</section>' +
    seg('level', 'Los capítulos se marcan con') +
      '<p class="hint">En automático, si hay un solo # lo toma como título del libro y los capítulos pasan a ser ##.</p></section>' +
    seg('breaks', 'Hoja nueva antes de') +
      '<p class="hint">Un título que va justo debajo de otro sigue en la misma hoja.</p></section>' +
    seg('para', 'Párrafos') + check('justify', 'Texto justificado') +
      '<p class="hint">Con Tab al principio de un párrafo le ponés sangría a mano, aunque elijas Sin sangría.</p></section>' +
    seg('quote', 'Citas') +
      '<p class="hint">Un párrafo que empieza con &gt; y un espacio es una cita.</p></section>' +
    seg('scene', 'Cambio de escena') +
      '<p class="hint">Escribí *** y Enter para separar escenas dentro de un capítulo, sin cambiar de hoja.</p></section>' +
    seg('notes', 'Notas') +
      '<p class="hint">Escribí [^1] donde va la llamada y, en una línea aparte, [^1]: y el texto de la nota. Las notas se juntan al final del texto.</p></section>' +
    seg('olStyle', 'Listas numeradas') +
      '<p class="hint">Escribí 1 y un espacio al principio de un párrafo para empezar una lista; con Enter sigue sola.</p></section>' +
    seg('ulStyle', 'Viñetas') + '</section>' +
    seg('page', 'Página') + check('folios', 'Números de página') +
      (PAGES_OK ? '' : '<p class="note">Para ver páginas, actualizá Chrome o Edge a la última versión.</p>') + '</section>';

  const body = $('drawerBody');
  renderPresets();
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) return deleteMyStyle(del.dataset.del);
    const p = e.target.closest('[data-preset]');
    if (p) {
      const id = p.dataset.preset;
      const mine = myStyles()[id];
      style = mine ? { ...style, ...mine.values, preset: id } : { ...style, ...presetValues(PRESETS[id]), preset: id };
      return refreshStyle();
    }
    const f = e.target.closest('[data-font]');
    if (f) { style.font = f.dataset.font; style.preset = null; return refreshStyle(); }
    const b = e.target.closest('.seg button');
    if (b) { style[b.parentElement.dataset.key] = b.dataset.val; if (!LOOSE_KEYS.includes(b.parentElement.dataset.key)) style.preset = null; refreshStyle(); }
  });
  $('saveStyleBtn').onclick = saveMyStyle;
  body.addEventListener('input', (e) => {
    const k = e.target.dataset.key;
    if (!k) return;
    style[k] = e.target.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
    if (k !== 'folios') style.preset = null;
    refreshStyle();
  });
  syncDrawer();
}
/* Estilos propios: guardan todas las opciones del panel con un nombre */
// Los borrados quedan marcados (deleted) para que el otro equipo también los borre
function myStyles() { return Object.fromEntries(Object.entries(pref('myStyles', {})).filter(([, m]) => !m.deleted)); }
function renderPresets() {
  if (!$('presetGrid')) return;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('presetGrid').innerHTML =
    Object.entries(PRESETS).map(([id, p]) =>
      `<button type="button" class="preset" data-preset="${id}"><span class="pn" style="font-family:'${p.font}'">${p.name}</span><span class="pd">${p.desc}</span></button>`).join('') +
    Object.entries(myStyles()).map(([id, m]) =>
      `<button type="button" class="preset mine" data-preset="${id}"><span class="pn" style="font-family:'${m.values.font}'">${esc(m.name)}</span><span class="pd">Tuyo · ${esc(m.values.font)}</span>` +
      `<span class="del" data-del="${id}" title="Borrar este estilo" aria-label="Borrar ${esc(m.name)}">×</span></button>`).join('');
  syncDrawer();
}
function saveMyStyle() {
  const btn = $('saveStyleBtn');
  const input = document.createElement('input');
  input.className = 'new-input style-name';
  input.placeholder = 'Nombre del estilo';
  btn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const name = input.value.trim();
    input.replaceWith(btn);
    if (!ok || !name) return;
    const id = 'mine-' + Date.now().toString(36);
    const { preset, ...values } = style;
    setSyncedPref('myStyles', { ...pref('myStyles', {}), [id]: { name, values, t: Date.now() } });
    style.preset = id;
    applyStyle();
    renderPresets();
    toast('Estilo «' + name + '» guardado');
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}
function deleteMyStyle(id) {
  const all = pref('myStyles', {});
  if (!all[id] || all[id].deleted || !confirm('¿Borrar el estilo «' + all[id].name + '»? Tus textos no cambian.')) return;
  all[id] = { deleted: true, t: Date.now() };
  setSyncedPref('myStyles', all);
  if (style.preset === id) { style.preset = null; applyStyle(); }
  renderPresets();
}

function syncDrawer() {
  const body = $('drawerBody');
  body.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.preset === style.preset));
  body.querySelectorAll('[data-font]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.font === style.font));
  body.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.val === style[s.dataset.key])));
  body.querySelectorAll('input[data-key]').forEach((i) => { if (i.type === 'checkbox') i.checked = !!style[i.dataset.key]; else i.value = style[i.dataset.key]; });
  $('out-size').textContent = style.size + ' px';
  $('out-leading').textContent = Number(style.leading).toFixed(2);
}
function refreshStyle() { applyStyle(); syncDrawer(); }
function toggleStyle() {
  const d = $('drawer');
  d.hidden = !d.hidden;
  $('styleBtn').setAttribute('aria-pressed', !d.hidden);
  document.body.classList.toggle('drawer-open', !d.hidden);
  $('styleToggle').setAttribute('aria-pressed', !d.hidden);
}

/* ---------- Editor ---------- */
function initEditor() {
  return new Promise((resolve) => {
    state.editor = new Vditor('editor', {
      cdn: 'vendor/vditor',
      mode: 'ir',
      lang: 'es_ES',
      icon: 'ant',
      height: 'auto',
      value: WELCOME,
      placeholder: 'Empezá a escribir…',
      toolbarConfig: { hide: true },
      cache: { enable: false },
      counter: { enable: false },
      preview: {
        theme: { current: 'light', path: 'vendor/vditor/dist/css/content-theme' },
        hljs: { style: 'github', lineNumber: false },
      },
      input: onInput,
      after: resolve,
    });
  });
}

function onInput() {
  if (state.loading) return;
  state.dirty = true;
  setSaveState(state.file ? 'Sin guardar' : 'Sin archivo · Ctrl+S para guardar');
  clearTimeout(onInput.timer);
  if (state.file) onInput.timer = setTimeout(save, 900);
  clearTimeout(onInput.outline); onInput.outline = setTimeout(renderOutline, 300);
  scheduleCounts();
  markScenes();
  scheduleSpell();
}

function editorRoot() { return document.querySelector('#editor .vditor-ir pre.vditor-reset'); }

function setText(md) {
  state.loading = true;
  state.editor.setValue(md, true);
  state.loading = false;
  state.dirty = false;
  if (state.source) { $('source').value = md; fitSource(); }
  renderOutline();
  desk.scrollTop = 0;
  // "Palabras de esta sesión" cuenta desde que se abre el archivo
  state.baseWords = null;
  updateCounts();
  scheduleSpell(300);
}

// Texto actual, venga del editor visual o del código fuente
function currentText() { return state.source ? $('source').value : state.editor.getValue(); }

/* ---------- Corrector ortográfico ---------- */
// Diccionario RLA-ES (español de Argentina) en spell-worker.js. A diferencia del de Chrome,
// subraya solo después de una pausa al escribir y nunca la palabra donde está el cursor.
// El subrayado usa CSS Custom Highlights, así que no toca el texto del editor.
const spell = { worker: null, pending: new Map(), seq: 0, verdict: new Map(), ranges: [], timer: 0, paintTimer: 0 };
const spellOn = () => pref('spell', true);
// Palabras agregadas al diccionario, más algunas que usa la propia app
const myWords = () => new Set(['Markdown', 'Enter', 'Ctrl', 'Shift', 'Tab', 'PDF', ...pref('spellWords', [])]);

function spellAsk(msg) {
  if (!spell.worker) {
    spell.worker = new Worker('spell-worker.js');
    spell.worker.onmessage = (e) => { const done = spell.pending.get(e.data.id); spell.pending.delete(e.data.id); if (done) done(e.data); };
  }
  const id = ++spell.seq;
  return new Promise((resolve) => { spell.pending.set(id, resolve); spell.worker.postMessage({ id, ...msg }); });
}

function applySpell() {
  const on = spellOn();
  const pre = editorRoot();
  if (pre) { pre.spellcheck = false; pre.lang = 'es'; }
  // En código fuente queda el de Chrome: ahí no se pueden dibujar subrayados propios
  const ta = $('source');
  ta.spellcheck = on;
  ta.lang = 'es';
  $('spellItem').classList.toggle('checked', on);
  if (on) scheduleSpell(0);
  else { clearTimeout(spell.timer); spell.ranges = []; if (window.CSS && CSS.highlights) CSS.highlights.delete('capital-spell'); }
}

function scheduleSpell(delay = 900) { clearTimeout(spell.timer); spell.timer = setTimeout(runSpell, delay); }

// Cada palabra del texto con su lugar, salteando marcas de Markdown, código y llamadas de nota
function spellTokens() {
  const pre = editorRoot();
  const out = [];
  if (!pre) return out;
  const skip = '.vditor-ir__marker, .vditor-ir__marker--hide, .vditor-ir__preview, code, [data-type="code-block"], [data-type="math-block"], [data-type="html-block"], [data-type="footnotes-ref"]';
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const m of n.data.matchAll(/\p{L}+/gu)) {
      const w = m[0];
      // Siglas mezcladas como "McDonald" o "iPhone" no se revisan
      if (w.length < 2 || /\p{Lu}/u.test(w.slice(1)) && w !== w.toUpperCase()) continue;
      out.push({ node: n, start: m.index, end: m.index + w.length, word: w });
    }
  }
  return out;
}

async function runSpell() {
  if (!spellOn() || state.source || !(window.CSS && CSS.highlights)) return;
  const mine = myWords();
  const unknown = [...new Set(spellTokens().map((t) => t.word))].filter((w) => !spell.verdict.has(w) && !mine.has(w) && !mine.has(w.toLowerCase()));
  if (unknown.length) {
    const { wrong } = await spellAsk({ check: unknown });
    const bad = new Set(wrong);
    for (const w of unknown) spell.verdict.set(w, !bad.has(w));
  }
  paintSpell();
}

function paintSpell() {
  if (!spellOn() || state.source || !(window.CSS && CSS.highlights)) return;
  const mine = myWords();
  const sel = getSelection();
  const caret = sel.rangeCount ? sel.getRangeAt(0) : null;
  spell.ranges = [];
  for (const t of spellTokens()) {
    if (spell.verdict.get(t.word) !== false || mine.has(t.word) || mine.has(t.word.toLowerCase())) continue;
    // La palabra que se está escribiendo no se marca hasta salir de ella
    if (caret && caret.startContainer === t.node && caret.startOffset >= t.start && caret.startOffset <= t.end) continue;
    const r = new Range();
    r.setStart(t.node, t.start);
    r.setEnd(t.node, t.end);
    spell.ranges.push(r);
  }
  CSS.highlights.set('capital-spell', new Highlight(...spell.ranges));
}

/* Menú de sugerencias (clic derecho sobre una palabra subrayada) */
function spellRangeAt(x, y) {
  const pos = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
  if (!pos) return null;
  return spell.ranges.find((r) => r.startContainer === pos.startContainer && pos.startOffset >= r.startOffset && pos.startOffset <= r.endOffset) || null;
}

function closeSpellMenu() { $('spellMenu').hidden = true; }

async function openSpellMenu(range, x, y) {
  const menu = $('spellMenu');
  const word = range.toString();
  menu.innerHTML = '<p class="sm-word"></p><div class="sm-list"><span class="sm-wait">Buscando…</span></div><hr>' +
    '<button type="button" data-act="add">Agregar al diccionario</button>';
  menu.querySelector('.sm-word').textContent = word;
  menu.hidden = false;
  const place = () => {
    menu.style.left = Math.min(x, innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = (y + menu.offsetHeight + 8 > innerHeight ? y - menu.offsetHeight : y) + 'px';
  };
  place();
  menu.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    closeSpellMenu();
    if (b.dataset.act === 'add') {
      setSyncedPref('spellWords', [...new Set([...pref('spellWords', []), word])]);
      paintSpell();
      toast('«' + word + '» agregada al diccionario');
      return;
    }
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, b.dataset.word);
  };
  const { suggestions } = await spellAsk({ suggest: word });
  if (menu.hidden || menu.querySelector('.sm-word').textContent !== word) return;
  const list = menu.querySelector('.sm-list');
  list.innerHTML = suggestions.length ? '' : '<span class="sm-wait">Sin sugerencias</span>';
  for (const s of suggestions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm-sug';
    b.dataset.word = b.textContent = s;
    list.append(b);
  }
  place();
}

/* ---------- Código fuente (Ctrl+/) ---------- */
function fitSource() {
  const ta = $('source');
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function toggleSource() {
  const ta = $('source');
  const on = !state.source;
  // Mantener aproximadamente la misma zona del texto a la vista
  const ratio = desk.scrollTop / Math.max(1, desk.scrollHeight - desk.clientHeight);
  if (on) {
    ta.value = state.editor.getValue();
    state.source = true;
    document.body.dataset.source = 'yes';
    book.style.height = '';
    fitSource();
    ta.focus({ preventScroll: true });
  } else {
    const wasDirty = state.dirty;
    state.loading = true;
    state.editor.setValue(ta.value, true);
    state.loading = false;
    state.dirty = wasDirty;
    state.source = false;
    document.body.dataset.source = 'no';
    paginate();
    focusEditor();
    scheduleSpell(300);
  }
  desk.scrollTop = ratio * (desk.scrollHeight - desk.clientHeight);
  updatePosition();
  updateSelection();
}

/* ---------- Archivos ---------- */
async function save() {
  clearTimeout(onInput.timer);
  if (!state.file) return saveAs();
  if (!state.dirty) return;
  const text = currentText();
  try {
    setSaveState('Guardando…');
    const w = await state.file.handle.createWritable();
    await w.write(text);
    await w.close();
    if (currentText() === text) { state.dirty = false; setSaveState('Guardado'); }
  } catch (e) {
    setSaveState('No se pudo guardar');
    toast('No se pudo guardar: ' + (e.message || e.name));
  }
}

async function saveAs() {
  if (!('showSaveFilePicker' in window)) { toast('Este navegador no puede guardar archivos. Usá Chrome o Edge.'); return; }
  try {
    const handle = await showSaveFilePicker({
      suggestedName: 'sin-titulo.md',
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    });
    state.file = { handle, path: handle.name, single: true };
    state.dirty = true;
    await save();
    showDocName();
    if (state.root) refreshDir(state.root, tree.querySelector('li[data-path=""] > ul'), '');
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo guardar: ' + e.message); }
}

async function openFile(handle, path, single = false) {
  if (state.dirty && state.file) await save();
  try {
    const text = await (await handle.getFile()).text();
    state.file = { handle, path, single };
    loadBookStyle();
    setText(text);
    showDocName();
    setSaveState('Guardado');
    setPref('lastFile', path);
    markActive();
    if (innerWidth <= 640) { shell.classList.add('no-side'); syncBars(); }
    focusEditor();
  } catch (e) {
    toast('No se pudo abrir el archivo: ' + e.message);
  }
}

function showDocName() {
  const name = state.file ? state.file.path : '';
  $('docName').textContent = name;
  document.title = state.file ? state.file.handle.name.replace(/\.(md|markdown|txt)$/i, '') + ' — Capital' : 'Capital';
}

function focusEditor() {
  const el = editorRoot();
  if (el) el.focus({ preventScroll: true });
}

/* ---------- Árbol de carpetas ---------- */
async function countTexts(dir) {
  let n = 0;
  try { for await (const h of dir.values()) if (h.kind === 'file' && /\.(md|markdown|txt)$/i.test(h.name)) n++; } catch (e) {}
  return n;
}

async function listDir(dir) {
  const items = [];
  for await (const handle of dir.values()) {
    if (handle.name.startsWith('.')) continue;
    if (handle.kind === 'directory' || /\.(md|markdown|txt)$/i.test(handle.name)) items.push(handle);
  }
  return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1)
    || a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));
}

function dirItem(handle, path, isRoot) {
  const li = document.createElement('li');
  li.dataset.path = path;
  li.setAttribute('role', 'treeitem');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'row dir';
  row.innerHTML = '<span class="caret">›</span><span class="label"></span><span class="count"></span>';
  row.querySelector('.label').textContent = handle.name;
  if (!isRoot) countTexts(handle).then((n) => { row.querySelector('.count').textContent = n ? n : ''; });
  const ul = document.createElement('ul');
  ul.setAttribute('role', 'group');
  li.append(row, ul);
  row.addEventListener('click', async () => {
    setTarget(handle, ul, path, row);
    if (isRoot) return;
    const open = !li.classList.contains('open');
    li.classList.toggle('open', open);
    open ? state.openDirs.add(path) : state.openDirs.delete(path);
    setPref('openDirs', [...state.openDirs]);
    if (open) await refreshDir(handle, ul, path);
    else ul.innerHTML = '';
  });
  return li;
}

function fileItem(handle, path) {
  const li = document.createElement('li');
  li.dataset.path = path;
  li.setAttribute('role', 'treeitem');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'row file';
  row.innerHTML = '<span class="label"></span>';
  row.querySelector('.label').textContent = handle.name.replace(/\.(md|markdown)$/i, '');
  row.title = handle.name;
  row.addEventListener('click', () => openFile(handle, path));
  li.append(row);
  return li;
}

async function refreshDir(dir, ul, path) {
  if (!ul) return;
  const items = await listDir(dir);
  ul.innerHTML = '';
  for (const h of items) {
    const p = path ? path + '/' + h.name : h.name;
    if (h.kind === 'directory') {
      const li = dirItem(h, p, false);
      ul.append(li);
      if (state.openDirs.has(p)) { li.classList.add('open'); await refreshDir(h, li.querySelector('ul'), p); }
    } else {
      ul.append(fileItem(h, p));
    }
  }
  markActive();
}

function setTarget(handle, ul, path, row) {
  state.target = { handle, ul, path };
  tree.querySelectorAll('.row.target').forEach((r) => r.classList.remove('target'));
  if (row) row.classList.add('target');
}

function markActive() {
  tree.querySelectorAll('.row.file').forEach((r) => {
    r.classList.toggle('active', !!state.file && r.parentElement.dataset.path === state.file.path);
  });
}

async function mountRoot(handle) {
  state.root = handle;
  $('sideTitle').textContent = handle.name;
  state.openDirs = new Set(pref('openDirs', []));
  $('treeEmpty').hidden = true;
  $('sideFoot').hidden = false;
  tree.innerHTML = '';
  const li = dirItem(handle, '', true);
  li.classList.add('open');
  tree.append(li);
  const ul = li.querySelector('ul');
  setTarget(handle, ul, '', li.querySelector('.row'));
  await syncNow();
  await refreshDir(handle, ul, '');
  const last = pref('lastFile', null);
  if (last) {
    const h = await resolvePath(handle, last).catch(() => null);
    if (h) await openFile(h, last);
  }
}

async function resolvePath(root, path) {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return dir.getFileHandle(parts[parts.length - 1]);
}

async function openFolder() {
  if (!FS_OK) { toast('Este navegador no puede abrir carpetas. Usá Chrome o Edge.'); return; }
  try {
    const handle = await showDirectoryPicker({ id: 'tinta', mode: 'readwrite' });
    if (state.dirty && state.file) await save();
    state.file = null;
    setPref('lastFile', null);
    setPref('openDirs', []);
    await kv('root', handle).catch(() => {});
    await mountRoot(handle);
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo abrir la carpeta: ' + e.message); }
}

async function openOneFile() {
  if (!('showOpenFilePicker' in window)) { toast('Este navegador no puede abrir archivos. Usá Chrome o Edge.'); return; }
  try {
    const [handle] = await showOpenFilePicker({
      id: 'tinta-file',
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
    });
    await openFile(handle, handle.name, true);
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo abrir el archivo: ' + e.message); }
}

async function restoreRoot() {
  if (!FS_OK) {
    $('treeEmpty').querySelector('p').textContent = 'Este navegador no permite abrir carpetas. Usá Chrome o Edge.';
    $('openFolderBtn').hidden = true;
    return;
  }
  const handle = await kv('root').catch(() => null);
  if (!handle) return;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return mountRoot(handle);
  const btn = $('reopenBtn');
  btn.textContent = 'Seguir en «' + handle.name + '»';
  btn.hidden = false;
  btn.onclick = async () => {
    if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') mountRoot(handle);
  };
}

/* Nuevo archivo / carpeta: campo de texto dentro del árbol */
function askName(kind) {
  if (!state.root) { openFolder(); return; }
  const target = state.target || { handle: state.root, ul: tree.querySelector('li[data-path=""] > ul'), path: '' };
  const li = target.ul.closest('li');
  if (li && !li.classList.contains('open')) li.querySelector('.row').click();
  const input = document.createElement('input');
  input.className = 'new-input';
  input.placeholder = kind === 'file' ? 'Nombre del archivo' : 'Nombre de la carpeta';
  target.ul.prepend(input);
  input.focus();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const name = input.value.trim().replace(/[\\/:*?"<>|]/g, '-');
    input.remove();
    if (!ok || !name) return;
    try {
      if (kind === 'file') {
        const fname = /\.(md|markdown|txt)$/i.test(name) ? name : name + '.md';
        if (await target.handle.getFileHandle(fname).then(() => true, () => false)) { toast('Ya existe un archivo con ese nombre'); return; }
        const h = await target.handle.getFileHandle(fname, { create: true });
        await refreshDir(target.handle, target.ul, target.path);
        await openFile(h, target.path ? target.path + '/' + fname : fname);
        setText('');
        focusEditor();
      } else {
        await target.handle.getDirectoryHandle(name, { create: true });
        await refreshDir(target.handle, target.ul, target.path);
      }
    } catch (e) { toast('No se pudo crear: ' + e.message); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/* ---------- Índice ---------- */
// Todos los niveles de # en familias: cada título agrupa a los de nivel más profundo que lo siguen
function renderOutline() {
  const list = $('outline');
  list.innerHTML = '';
  const root = editorRoot();
  const hs = root ? [...root.querySelectorAll(':scope > :is(h1, h2, h3, h4, h5, h6)')] : [];
  const top = { level: 0, children: [] };
  const stack = [top];
  for (const h of hs) {
    const copy = h.cloneNode(true);
    copy.querySelectorAll('.vditor-ir__marker').forEach((m) => m.remove());
    const text = copy.textContent.trim();
    if (!text) continue;
    const item = { h, text, level: +h.tagName[1], children: [] };
    while (stack[stack.length - 1].level >= item.level) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  if (!top.children.length) {
    list.innerHTML = '<li class="none">Los capítulos que escribas con # aparecen acá.</li>';
    return;
  }
  const build = (items, into, depth, parentKey) => {
    for (const it of items) {
      const key = parentKey + '/' + it.text;
      const li = document.createElement('li');
      li.className = 'toc-item depth-' + Math.min(depth, 2);
      const row = document.createElement('div');
      row.className = 'toc-row';
      const caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'toc-caret';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toc';
      b.innerHTML = '<span class="t"></span><span class="dots"></span><span class="pg"></span>';
      b.querySelector('.t').textContent = it.text;
      b.title = it.text;
      const pg = pageOf(it.h);
      if (pg) b.querySelector('.pg').textContent = pg;
      else b.querySelector('.dots').hidden = true;
      b.onclick = () => it.h.scrollIntoView({ block: 'start', behavior: 'smooth' });
      row.append(caret, b);
      li.append(row);
      if (it.children.length) {
        const sub = document.createElement('ol');
        build(it.children, sub, depth + 1, key);
        li.append(sub);
        const closed = state.tocClosed.has(key);
        li.classList.toggle('closed', closed);
        caret.textContent = '›';
        caret.setAttribute('aria-expanded', !closed);
        caret.setAttribute('aria-label', closed ? 'Desplegar' : 'Plegar');
        caret.onclick = () => {
          const now = !li.classList.contains('closed');
          li.classList.toggle('closed', now);
          caret.setAttribute('aria-expanded', !now);
          caret.setAttribute('aria-label', now ? 'Desplegar' : 'Plegar');
          now ? state.tocClosed.add(key) : state.tocClosed.delete(key);
        };
      } else {
        caret.tabIndex = -1;
        caret.disabled = true;
      }
      into.append(li);
    }
  };
  build(top.children, list, 0, '');
}

/* ---------- Tipografía al escribir: « », guion de diálogo y listas ---------- */
// Devuelve [caracteres a borrar antes del cursor, texto a insertar] o null.
// `before` es el texto del bloque (o de la línea, en código fuente) antes del cursor.
function smartTyping(before, ch, isParagraph) {
  if (ch === '<' && before.endsWith('<')) return [1, '«'];
  // ">" solo al principio de la línea es una cita; ">>" ahí sigue siendo cita anidada
  if (ch === '>' && before.endsWith('>') && before.trim() !== '>') return [1, '»'];
  // Dentro de una frase, el tercer guion ya es raya
  if (ch === '-' && before.endsWith('--') && before.length > 2) return [2, '—'];
  // Al principio de la línea "---" sigue siendo salto de página hasta que se escribe otra cosa
  if (ch !== '-' && before === '---') return [3, '—' + ch];
  // "1" y espacio al principio de un párrafo empieza una lista numerada
  if (ch === ' ' && before === '1' && isParagraph) return [0, '. '];
  return null;
}

function onEditorBeforeInput(e) {
  if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1 || e.isComposing) return;
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const caret = sel.getRangeAt(0);
  const node = caret.startContainer;
  const block = (node.nodeType === 1 ? node : node.parentElement).closest('p, li, h1, h2, h3, h4, h5, h6, td, th');
  if (!block || !editorRoot().contains(block)) return;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(node, caret.startOffset);
  const rule = smartTyping(pre.toString(), e.data, block.tagName === 'P');
  if (!rule) return;
  const [remove, insert] = rule;
  // Solo si lo que hay que borrar está en el mismo nodo de texto
  if (remove && (node.nodeType !== 3 || caret.startOffset < remove)) return;
  e.preventDefault();
  if (remove) {
    const r = document.createRange();
    r.setStart(node, caret.startOffset - remove);
    r.setEnd(node, caret.startOffset);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  document.execCommand('insertText', false, insert);
}

/* ---------- Cambio de escena y sangría a mano ---------- */
// Sangría a mano: un espacio de 1,5 em al principio del párrafo, que se guarda en el texto
const INDENT = '  ';

// Marca los párrafos de cambio de escena para dibujarles el ornamento elegido
function markScenes() {
  const pre = editorRoot();
  if (!pre) return;
  for (const p of pre.querySelectorAll(':scope > p')) {
    const on = p.textContent.trim() === SCENE;
    if (on !== p.hasAttribute('data-scene')) p.toggleAttribute('data-scene', on);
  }
}

function caretBlock() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.anchorNode;
  const block = (node.nodeType === 1 ? node : node.parentElement).closest('p');
  return block && block.parentElement === editorRoot() ? { sel, block } : null;
}

function onEditorKeydown(e) {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  // *** y Enter: el párrafo pasa a ser un cambio de escena (antes de que el editor lo convierta en salto de página)
  if (e.key === 'Enter' && !e.shiftKey) {
    const c = caretBlock();
    if (!c || c.block.textContent.trim() !== '***') return;
    c.block.textContent = SCENE;
    const r = document.createRange();
    r.selectNodeContents(c.block);
    r.collapse(false);
    c.sel.removeAllRanges();
    c.sel.addRange(r);
  }
  // Tab al principio de un párrafo: sangría a mano
  if (e.key === 'Tab' && !e.shiftKey) {
    const c = caretBlock();
    if (!c || !c.sel.isCollapsed) return;
    const before = document.createRange();
    before.setStart(c.block, 0);
    before.setEnd(c.sel.anchorNode, c.sel.anchorOffset);
    if (before.toString().replace(/​/g, '') !== '') return;
    e.preventDefault();
    e.stopPropagation();
    document.execCommand('insertText', false, INDENT);
  }
}

function onSourceBeforeInput(e) {
  if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1 || e.isComposing) return;
  const ta = e.target;
  if (ta.selectionStart !== ta.selectionEnd) return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(ta.value.lastIndexOf('\n', pos - 1) + 1, pos);
  const rule = smartTyping(before, e.data, true);
  if (!rule) return;
  e.preventDefault();
  ta.setSelectionRange(pos - rule[0], pos);
  document.execCommand('insertText', false, rule[1]);
}

/* ---------- Barra inferior: palabras, páginas y otros datos ---------- */
// Cada dato se puede mostrar u ocultar desde el botón de ajustes de la barra
const STATS = [
  { id: 'chapter', label: 'Capítulo actual', on: true, left: true },
  { id: 'selection', label: 'Palabras seleccionadas', on: true },
  { id: 'session', label: 'Palabras escritas en esta sesión', on: false },
  { id: 'page', label: 'Página', on: true },
  { id: 'words', label: 'Palabras', on: true },
  { id: 'chars', label: 'Caracteres', on: false },
  { id: 'paras', label: 'Párrafos', on: false },
  { id: 'reading', label: 'Tiempo de lectura', on: true },
];
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const countWords = (s) => (s.match(WORD_RE) || []).length;
const fmt = (n) => n.toLocaleString('es-AR');
const plural = (n, one, many) => fmt(n) + ' ' + (n === 1 ? one : many);
let statsOn = {};

// El texto tal como se lee, sin las marcas de Markdown
function plainText(md) {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+)+/gm, '')
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/[*_~`]/g, '');
}

function readingTime(words) {
  const min = Math.round(words / 230);
  if (min < 1) return words ? 'menos de 1 min de lectura' : '';
  if (min < 60) return min + ' min de lectura';
  return Math.floor(min / 60) + ' h ' + (min % 60 ? (min % 60) + ' min ' : '') + 'de lectura';
}

function setStat(id, text) {
  const el = document.querySelector(`.sb-item[data-stat="${id}"]`);
  if (!el) return;
  el.textContent = text;
  el.hidden = !statsOn[id] || !text;
}

function buildStatusBar() {
  statsOn = Object.fromEntries(STATS.map((s) => [s.id, s.on]));
  Object.assign(statsOn, pref('stats', {}));
  for (const s of STATS) {
    const el = document.createElement('span');
    el.className = 'sb-item';
    el.dataset.stat = s.id;
    el.hidden = true;
    $(s.left ? 'sbLeft' : 'sbRight').append(el);
  }
  const pop = $('statsPop');
  pop.innerHTML = '<h4>Mostrar</h4>' + STATS.map((s) =>
    `<label><input type="checkbox" data-stat="${s.id}"${statsOn[s.id] ? ' checked' : ''}> ${s.label}</label>`).join('');
  pop.addEventListener('change', (e) => {
    statsOn[e.target.dataset.stat] = e.target.checked;
    setPref('stats', statsOn);
    updateCounts(); updatePosition(); updateSelection();
  });
  const btn = $('statsBtn');
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', !pop.hidden); };
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !e.target.closest('.sb-menu')) { pop.hidden = true; btn.setAttribute('aria-expanded', false); }
  });
}

// Palabras, caracteres y párrafos: se recalculan un rato después de dejar de escribir
function updateCounts() {
  if (!state.editor) return;
  const md = currentText();
  const text = plainText(md);
  const words = countWords(text);
  if (state.baseWords == null) state.baseWords = words;
  const paras = md.split(/\n[ \t]*\n/).filter((b) => b.trim() && !/^[ \t]*(#{1,6}[ \t]|([-*_])(?:[ \t]*\2){2,}[ \t]*$)/.test(b.trim())).length;
  const delta = words - state.baseWords;
  setStat('words', plural(words, 'palabra', 'palabras'));
  setStat('chars', plural([...text.replace(/\s*\n\s*/g, ' ').trim()].length, 'carácter', 'caracteres'));
  setStat('paras', plural(paras, 'párrafo', 'párrafos'));
  setStat('reading', readingTime(words));
  setStat('session', delta ? (delta > 0 ? '+' : '−') + plural(Math.abs(delta), 'palabra', 'palabras') + ' en esta sesión' : '');
}
function scheduleCounts() { clearTimeout(scheduleCounts.timer); scheduleCounts.timer = setTimeout(updateCounts, 400); }

// Página y capítulo que se están leyendo (a un tercio de la altura de la ventana)
function updatePosition() {
  const pre = editorRoot();
  if (!pre || state.source) { setStat('page', ''); setStat('chapter', ''); return; }
  const line = desk.getBoundingClientRect().top + desk.clientHeight / 3;
  const total = pagesEl.children.length;
  if (state.step && total) {
    const n = Math.min(total, Math.max(1, Math.floor((line - pagesEl.getBoundingClientRect().top) / state.step) + 1));
    setStat('page', `Página ${n} de ${total}`);
  } else setStat('page', '');
  let current = null;
  for (const h of pre.querySelectorAll(`:scope > h${document.body.dataset.level || 1}`)) {
    if (h.getBoundingClientRect().top > line) break;
    current = h;
  }
  let title = '';
  if (current) {
    const copy = current.cloneNode(true);
    copy.querySelectorAll('.vditor-ir__marker').forEach((m) => m.remove());
    title = copy.textContent.trim();
  }
  setStat('chapter', title);
}
function schedulePosition() {
  if (schedulePosition.frame) return;
  schedulePosition.frame = requestAnimationFrame(() => { schedulePosition.frame = 0; updatePosition(); });
}

// Último bloque con texto (las notas al final no cuentan como "lo último escrito")
function lastWritten() {
  const pre = editorRoot();
  if (!pre) return null;
  for (let el = pre.lastElementChild; el; el = el.previousElementSibling) {
    if (el.matches('[data-type="footnotes-block"]') || !el.textContent.trim()) continue;
    return el;
  }
  return null;
}

// "Ir al final": deja la última línea escrita en el medio de la pantalla, con el cursor ahí
function goToEnd() {
  const el = lastWritten();
  if (!el) return;
  const bottom = el.getBoundingClientRect().bottom - desk.getBoundingClientRect().top + desk.scrollTop;
  desk.scrollTo({ top: Math.max(0, bottom - desk.clientHeight / 2), behavior: 'smooth' });
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  editorRoot().focus({ preventScroll: true });
}

// El botón se esfuma mientras la última línea escrita está a la vista
function updateToEnd() {
  const el = state.source ? null : lastWritten();
  let near = true;
  if (el) {
    const y = el.getBoundingClientRect().bottom - desk.getBoundingClientRect().top;
    near = y > 0 && y < desk.clientHeight - 40;
  }
  $('toEnd').classList.toggle('gone', near);
}

function updateSelection() {
  let text = '';
  const ta = $('source');
  if (state.source) text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  else {
    const sel = getSelection();
    const root = editorRoot();
    if (sel.rangeCount && !sel.isCollapsed && root && root.contains(sel.anchorNode)) text = sel.toString();
  }
  const n = text ? countWords(text) : 0;
  setStat('selection', n ? plural(n, 'palabra seleccionada', 'palabras seleccionadas') : '');
}

// Tildes del menú y botones de la barra inferior, según qué barras están a la vista
function syncBars() {
  const side = !shell.classList.contains('no-side');
  const zoom = !$('zoomBar').hidden;
  $('sideItem').classList.toggle('checked', side);
  $('zoomItem').classList.toggle('checked', zoom);
  $('statusItem').classList.toggle('checked', !document.body.classList.contains('no-status'));
  $('sideToggle').setAttribute('aria-pressed', side);
  $('zoomToggle').setAttribute('aria-pressed', zoom);
}

function showTab(which) {
  const files = which === 'files';
  $('tabFiles').setAttribute('aria-selected', files);
  $('tabOutline').setAttribute('aria-selected', !files);
  $('panelFiles').hidden = !files;
  $('panelOutline').hidden = files;
  shell.classList.remove('no-side');
  syncBars();
  setPref('tab', which);
}

/* ---------- Modo concentración ---------- */
function markCurrentBlock() {
  const root = editorRoot();
  if (!root || !shell.classList.contains('focus')) return;
  const sel = getSelection();
  let node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  while (node && node.parentNode !== root) node = node.parentNode;
  root.querySelectorAll('[data-tinta-current]').forEach((el) => { if (el !== node) el.removeAttribute('data-tinta-current'); });
  if (node && node.nodeType === 1) node.setAttribute('data-tinta-current', '');
}
function toggleFocus() {
  const on = shell.classList.toggle('focus');
  if (!on) editorRoot()?.querySelectorAll('[data-tinta-current]').forEach((el) => el.removeAttribute('data-tinta-current'));
  else markCurrentBlock();
  setPref('focus', on);
}

/* ---------- Menús y atajos ---------- */
const COMMANDS = {
  openFolder,
  openOneFile,
  newFile: () => askName('file'),
  newFolder: () => askName('folder'),
  save,
  toggleSidebar: () => { shell.classList.toggle('no-side'); setPref('side', !shell.classList.contains('no-side')); syncBars(); },
  toggleStatus: () => { const off = document.body.classList.toggle('no-status'); setPref('status', !off); syncBars(); },
  toggleSource,
  exportPdf,
  toggleSpell: () => { setPref('spell', !pref('spell', true)); applySpell(); toast(pref('spell', true) ? 'Corrector ortográfico activado' : 'Corrector ortográfico desactivado'); },
  toggleZoomBar: () => { const z = $('zoomBar'); z.hidden = !z.hidden; setPref('zoomBar', !z.hidden); syncBars(); },
  showFiles: () => showTab('files'),
  showOutline: () => showTab('outline'),
  focusMode: toggleFocus,
  toggleStyle,
};

document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
  closeMenus();
  COMMANDS[b.dataset.cmd]();
}));

function closeMenus() { document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')); }
document.querySelectorAll('.menu-btn').forEach((btn) => {
  const menu = btn.parentElement;
  btn.addEventListener('click', (e) => { e.stopPropagation(); const was = menu.classList.contains('open'); closeMenus(); menu.classList.toggle('open', !was); });
  btn.addEventListener('mouseenter', () => { if (document.querySelector('.menu.open') && !menu.classList.contains('open')) { closeMenus(); menu.classList.add('open'); } });
});
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') closeMenus();
  if (mod && !e.shiftKey && k === 's') { e.preventDefault(); save(); }
  else if (mod && !e.shiftKey && k === 'n') { e.preventDefault(); askName('file'); }
  else if (mod && !e.shiftKey && k === 'o') { e.preventDefault(); openOneFile(); }
  else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); COMMANDS.toggleSidebar(); }
  else if (e.key === 'F8') { e.preventDefault(); toggleFocus(); }
  else if (mod && !e.shiftKey && e.key === '/') { e.preventDefault(); toggleSource(); }
  else if (mod && !e.shiftKey && k === 'p') { e.preventDefault(); exportPdf(); }
}, true);

$('tabFiles').onclick = () => showTab('files');
$('tabOutline').onclick = () => showTab('outline');
$('openFolderBtn').onclick = openFolder;
$('openFileBtn').onclick = openOneFile;
document.addEventListener('selectionchange', () => {
  markCurrentBlock();
  updateSelection();
  // Al salir de una palabra, se revisa (la que tenía el cursor no estaba marcada)
  if (spell.ranges && spellOn()) { clearTimeout(spell.paintTimer); spell.paintTimer = setTimeout(paintSpell, 500); }
});
$('editor').addEventListener('contextmenu', (e) => {
  const r = spellRangeAt(e.clientX, e.clientY);
  if (!r) return;
  e.preventDefault();
  openSpellMenu(r, e.clientX, e.clientY);
});
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#spellMenu')) closeSpellMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSpellMenu(); });
desk.addEventListener('scroll', closeSpellMenu, { passive: true });
$('source').addEventListener('select', updateSelection);
$('source').addEventListener('keyup', updateSelection);
$('source').addEventListener('mouseup', updateSelection);
desk.addEventListener('scroll', () => { schedulePosition(); updateToEnd(); }, { passive: true });
$('toEnd').onclick = goToEnd;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.dirty && state.file) save();
  // Al volver a la app, traer lo que haya cambiado en la otra computadora
  if (!document.hidden) syncNow();
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) { save(); e.preventDefault(); } });

/* ---------- Arranque ---------- */
(async function start() {
  if (pref('side', true) === false) shell.classList.add('no-side');
  if (pref('focus', false)) shell.classList.add('focus');
  if (pref('tab', 'files') === 'outline') showTab('outline');
  setSaveState('');
  style = { ...STYLE_DEFAULTS, ...pref('style', {}) };
  state.zoom = pref('zoom', 1);
  $('zoomRange').addEventListener('input', (e) => setZoom(e.target.value / 100));
  $('zoomMinus').onclick = () => setZoom(state.zoom - 0.1);
  $('zoomPlus').onclick = () => setZoom(state.zoom + 0.1);
  $('zoomOut').onclick = () => setZoom(1);
  $('zoomBar').hidden = pref('zoomBar', true) === false;
  if (pref('status', true) === false) document.body.classList.add('no-status');
  buildStatusBar();
  syncBars();
  document.body.dataset.source = 'no';
  $('source').addEventListener('input', () => { fitSource(); onInput(); });
  $('source').addEventListener('beforeinput', onSourceBeforeInput);
  $('editor').addEventListener('beforeinput', onEditorBeforeInput, true);
  $('editor').addEventListener('keydown', onEditorKeydown, true);
  $('source').addEventListener('keydown', (e) => {
    const ta = e.target;
    const lineStart = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const line = ta.value.slice(lineStart, ta.selectionStart);
    if (e.key === 'Enter' && !e.shiftKey && line.trim() === '***' && ta.value[ta.selectionStart] !== '*') {
      ta.setSelectionRange(lineStart, ta.selectionStart);
      document.execCommand('insertText', false, SCENE);
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    // Al principio de una línea, la misma sangría que en el libro (un tabulador ahí sería un bloque de código)
    document.execCommand('insertText', false, line === '' ? INDENT : '\t');
  });
  $('zoomRange').value = Math.round(state.zoom * 100);
  $('zoomOut').textContent = $('zoomLabel').textContent = Math.round(state.zoom * 100) + ' %';
  buildDrawer();
  applyStyle();
  await initEditor();
  applySpell();
  layout();
  updateCounts();
  new ResizeObserver(() => paginate()).observe(editorRoot());
  // El ancho del escritorio cambia al mostrar u ocultar la barra lateral o al cambiar la ventana
  let lastDeskW = 0;
  new ResizeObserver(() => { if (desk.clientWidth && desk.clientWidth !== lastDeskW) { lastDeskW = desk.clientWidth; layout(); } }).observe(desk);
  document.fonts.addEventListener('loadingdone', paginate);
  await restoreRoot().catch((e) => console.warn(e));

  // Abrir un .md con doble clic cuando la app está instalada
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async (params) => {
      const h = params.files && params.files[0];
      if (h) await openFile(h, h.name, true);
    });
  }
  watchUpdates();
})();

/* ---------- Actualizaciones ---------- */
// Busca una versión nueva al abrir la app y cada vez que vuelve a primer plano.
// Cuando llega, avisa con una barra; al aceptar, guarda y recarga.
function watchUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  // La versión visible en Ayuda sale del nombre de la caché que arma sw.js
  const showVersion = () => caches.keys().then((keys) => {
    const v = keys.map((k) => k.match(/^capital-v(\d+)$/)).filter(Boolean).map((m) => +m[1]).sort((a, b) => b - a)[0];
    if (v) $('appVersion').textContent = 'Versión ' + v;
  }).catch(() => {});
  showVersion();
  navigator.serviceWorker.addEventListener('controllerchange', showVersion);
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('updateBar').hidden = false;
  });
  $('updateBtn').onclick = async () => {
    if (state.dirty && state.file) await save();
    location.reload();
  };
}
