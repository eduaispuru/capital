// Corrector ortográfico de Capital: lee un diccionario Hunspell (RLA-ES, español de Argentina)
// y responde, fuera del hilo principal, qué palabras no existen y qué sugerencias hay.
// Las formas no se expanden: se busca la raíz quitando prefijos y sufijos, como hace Hunspell.

let words = null;      // raíz → banderas
const sfx = new Map(); // terminación agregada → reglas de sufijo
const pfx = new Map(); // comienzo agregado → reglas de prefijo
let maxSfx = 0, maxPfx = 0;
let rep = [];          // reemplazos de errores frecuentes (ll → y, etc.)
let tryChars = '';
let mapGroups = [];    // letras que suelen confundirse (a/á, n/ñ…)
const ready = load();

async function load() {
  const [aff, dic] = await Promise.all(['dict/es_AR.aff', 'dict/es_AR.dic'].map((u) => fetch(u).then((r) => r.text())));
  const heads = {};
  for (const raw of aff.split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'TRY') tryChars = p[1];
    else if (p[0] === 'REP' && p.length === 3) rep.push([p[1], p[2]]);
    else if (p[0] === 'MAP' && p.length === 2 && isNaN(+p[1])) mapGroups.push([...p[1]]);
    else if ((p[0] === 'SFX' || p[0] === 'PFX') && p.length >= 4) {
      const key = p[0] + p[1];
      if (!heads[key]) { heads[key] = { cross: p[2] === 'Y' }; continue; }
      const [add, cont = ''] = p[3].split('/');
      const rule = {
        flag: p[1], cross: heads[key].cross, cont,
        strip: p[2] === '0' ? '' : p[2],
        add: add === '0' ? '' : add,
        cond: p[4] && p[4] !== '.' ? new RegExp(p[0] === 'SFX' ? p[4] + '$' : '^' + p[4], 'u') : null,
      };
      const index = p[0] === 'SFX' ? sfx : pfx;
      if (!index.has(rule.add)) index.set(rule.add, []);
      index.get(rule.add).push(rule);
      if (p[0] === 'SFX') maxSfx = Math.max(maxSfx, rule.add.length);
      else maxPfx = Math.max(maxPfx, rule.add.length);
    }
  }
  words = new Map();
  const lines = dic.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const slash = line.indexOf('/');
    const w = slash < 0 ? line : line.slice(0, slash);
    const f = slash < 0 ? '' : line.slice(slash + 1).split(/\s/)[0];
    words.set(w, (words.get(w) || '') + f);
  }
}

const has = (w, flag) => { const f = words.get(w); return f !== undefined && f.includes(flag); };

// Quita un sufijo; `need` pide que la regla tenga esa bandera de continuación (sufijo doble)
function stripSuffix(word, test) {
  for (let n = Math.min(word.length, maxSfx); n >= 0; n--) {
    const rules = sfx.get(word.slice(word.length - n));
    if (!rules) continue;
    const head = word.slice(0, word.length - n);
    for (const r of rules) {
      const base = head + r.strip;
      if (!base || (r.cond && !r.cond.test(base))) continue;
      if (test(base, r)) return true;
    }
  }
  return false;
}

function knownForm(word) {
  if (words.has(word)) return true;
  // Raíz + sufijo, o raíz + sufijo + sufijo (cuando el primero permite el segundo)
  const bySuffix = (w, extra) => stripSuffix(w, (base, r) =>
    (has(base, r.flag) && (!extra || has(base, extra)))
    || (!extra && stripSuffix(base, (base2, r2) => r2.cont.includes(r.flag) && has(base2, r2.flag))));
  if (bySuffix(word)) return true;
  // Prefijo (y, si se puede combinar, también sufijo)
  for (let n = Math.min(word.length, maxPfx); n >= 1; n--) {
    const rules = pfx.get(word.slice(0, n));
    if (!rules) continue;
    for (const r of rules) {
      const base = r.strip + word.slice(n);
      if (r.cond && !r.cond.test(base)) continue;
      if (has(base, r.flag)) return true;
      if (r.cross && stripSuffix(base, (b, s) => s.cross && has(b, s.flag) && has(b, r.flag))) return true;
    }
  }
  return false;
}

function check(word) {
  if (knownForm(word)) return true;
  const lower = word.toLowerCase();
  if (lower !== word) {
    // "Casa" al principio de una oración, o "CASA" en mayúsculas
    if (knownForm(lower)) return true;
    if (word === word.toUpperCase()) { const cap = lower[0].toUpperCase() + lower.slice(1); if (knownForm(cap)) return true; }
  }
  return false;
}

function suggest(word) {
  const lower = word.toLowerCase();
  const isCap = word[0] !== lower[0];
  const out = new Map(); // sugerencia → puntaje (menor es mejor)
  const add = (w, score) => { if (w !== lower && w.length && (!out.has(w) || out.get(w) > score) && check(w)) out.set(w, score); };
  // Errores frecuentes: tildes, ll/y, b/v, z/s, c/s…
  const confusions = (w) => {
    const v = [];
    for (const [a, b] of rep) for (let i = w.indexOf(a); i >= 0; i = w.indexOf(a, i + 1)) v.push(w.slice(0, i) + b + w.slice(i + a.length));
    for (const group of [...mapGroups, ['s', 'c', 'z'], ['b', 'v'], ['y', 'i']]) {
      for (let i = 0; i < w.length; i++) {
        if (!group.includes(w[i])) continue;
        for (const c of group) if (c !== w[i] && c === c.toLowerCase()) v.push(w.slice(0, i) + c + w.slice(i + 1));
      }
    }
    return v;
  };
  const first = confusions(lower);
  for (const v of first) add(v, 0);
  // A una letra de distancia: cambiar, sacar, agregar o invertir (tocar la primera letra es menos probable)
  const letters = [...new Set(tryChars.toLowerCase())];
  const edits = (w, base) => {
    for (let i = 0; i <= w.length; i++) {
      const s = base + (i === 0 ? 1 : 0);
      if (i < w.length) {
        add(w.slice(0, i) + w.slice(i + 1), w[i] === 'h' ? base : s + 1);
        if (i + 1 < w.length) add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), s);
        for (const c of letters) if (c !== w[i]) add(w.slice(0, i) + c + w.slice(i + 1), s + 1);
      }
      for (const c of letters) add(w.slice(0, i) + c + w.slice(i), c === 'h' ? base : s + 1);
    }
  };
  edits(lower, 1);
  // Si casi no hay, dos errores: dos confusiones, o una confusión y otra letra
  if (out.size < 3) {
    for (const v of first) {
      for (const v2 of confusions(v)) add(v2, 3);
      if (v.length <= 14) edits(v, 4);
    }
  }
  // Dos palabras pegadas
  for (let i = 1; i < lower.length - 1; i++) {
    const a = lower.slice(0, i), b = lower.slice(i);
    if (i === 1 && !'aoyeu'.includes(a)) continue;
    if (check(a) && check(b)) out.set(a + ' ' + b, 3);
  }
  return [...out].sort((x, y) => x[1] - y[1]).slice(0, 6)
    .map(([w]) => (isCap ? w[0].toUpperCase() + w.slice(1) : w));
}

self.onmessage = async (e) => {
  await ready;
  const { id, check: list, suggest: one } = e.data;
  if (list) self.postMessage({ id, wrong: list.filter((w) => !check(w)) });
  else self.postMessage({ id, suggestions: suggest(one) });
};
