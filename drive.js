'use strict';
/* Google Drive como carpeta de Capital.
   En Android no se puede abrir una carpeta del equipo, y Drive tampoco se deja abrir como carpeta.
   Acá Capital entra directo a tu Drive con tu cuenta de Google. DriveDir y DriveFile imitan las
   carpetas y archivos del equipo (los que da "Abrir carpeta"), así el resto de la app funciona igual:
   árbol, guardado, versiones y ajustes compartidos. */
const DRIVE_CLIENT_ID = '884756440470-mc3jcn4t03j13iuerc9tbp1urbqblce4.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/';
const drive = { token: null, expires: 0, client: null, cache: new Map(), signingIn: null };

class DriveAuthError extends Error {
  constructor() { super('Se cortó la conexión con Google Drive'); this.name = 'DriveAuthError'; }
}

function loadGoogleScript() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo conectar con Google. ¿Hay internet?'));
    document.head.append(s);
  });
}

// Abre la ventanita de Google para dar permiso (la primera vez pregunta; después se cierra sola).
// Tiene que llamarse desde un clic: si no, el navegador bloquea la ventana.
function driveSignIn() {
  if (drive.signingIn) return drive.signingIn;
  drive.signingIn = loadGoogleScript().then(() => new Promise((resolve, reject) => {
    if (!drive.client) {
      drive.client = google.accounts.oauth2.initTokenClient({ client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE, callback: () => {} });
    }
    drive.client.callback = (r) => {
      if (r.error) { reject(new Error(r.error_description || r.error)); return; }
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
        reject(new Error('Para usar tu Drive, Capital necesita el permiso para ver y editar tus archivos.'));
        return;
      }
      drive.token = r.access_token;
      drive.expires = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
      hideDriveBar();
      resolve();
    };
    drive.client.error_callback = (e) => reject(new Error(e && e.type === 'popup_closed' ? 'Se cerró la ventana de Google' : 'No se pudo entrar a Google'));
    drive.client.requestAccessToken({ prompt: '' });
  })).finally(() => { drive.signingIn = null; });
  return drive.signingIn;
}

const driveConnected = () => !!drive.token && Date.now() < drive.expires;

async function driveFetch(url, opts = {}) {
  if (!driveConnected()) { showDriveBar(); throw new DriveAuthError(); }
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } });
  } catch (e) { throw new Error('Sin conexión con Google Drive'); }
  if (res.status === 401) { drive.token = null; showDriveBar(); throw new DriveAuthError(); }
  if (!res.ok) {
    let msg = res.status + '';
    try { msg = (await res.json()).error.message || msg; } catch (e) { /* sin detalle */ }
    throw new Error('Google Drive: ' + msg);
  }
  return res;
}
const driveJson = (path, method, body) => driveFetch(DRIVE_API + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

// Lo que hay adentro de una carpeta (se recuerda unos segundos para no preguntar a cada rato)
async function driveList(id) {
  const hit = drive.cache.get(id);
  if (hit && Date.now() - hit.at < 20000) return hit.items;
  const items = [];
  let page = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const url = `${DRIVE_API}files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000&orderBy=modifiedTime desc&spaces=drive${page ? '&pageToken=' + page : ''}`;
    const r = await (await driveFetch(url)).json();
    items.push(...r.files);
    page = r.nextPageToken;
  } while (page);
  drive.cache.set(id, { at: Date.now(), items });
  return items;
}
const driveForget = (id) => drive.cache.delete(id);
const isGoogleDoc = (f) => f.mimeType.startsWith('application/vnd.google-apps.') && f.mimeType !== DRIVE_FOLDER;
const mimeFor = (name) => (/\.json$/i.test(name) ? 'application/json' : /\.txt$/i.test(name) ? 'text/plain' : 'text/markdown');

class DriveDir {
  constructor(id, name) { this.kind = 'directory'; this.id = id; this.name = name; this.drive = true; }
  async *values() {
    // Si Drive tiene dos con el mismo nombre, vale el modificado más recientemente
    const seen = new Set();
    for (const f of await driveList(this.id)) {
      if (isGoogleDoc(f) || seen.has(f.name)) continue;
      seen.add(f.name);
      yield f.mimeType === DRIVE_FOLDER ? new DriveDir(f.id, f.name) : new DriveFile(f, this.id);
    }
  }
  async find(name, folder) {
    return (await driveList(this.id)).find((f) => f.name === name && (f.mimeType === DRIVE_FOLDER) === folder && !isGoogleDoc(f));
  }
  async getDirectoryHandle(name, { create } = {}) {
    let f = await this.find(name, true);
    if (!f && create) {
      f = await driveJson('files?fields=id,name,mimeType,modifiedTime', 'POST', { name, mimeType: DRIVE_FOLDER, parents: [this.id] });
      driveForget(this.id);
    }
    if (!f) throw new DOMException('No existe la carpeta ' + name, 'NotFoundError');
    return new DriveDir(f.id, f.name);
  }
  async getFileHandle(name, { create } = {}) {
    let f = await this.find(name, false);
    if (!f && create) {
      f = await driveJson('files?fields=id,name,mimeType,modifiedTime', 'POST', { name, mimeType: mimeFor(name), parents: [this.id] });
      driveForget(this.id);
    }
    if (!f) throw new DOMException('No existe el archivo ' + name, 'NotFoundError');
    return new DriveFile(f, this.id);
  }
  // Lo borrado va a la papelera de Drive (se puede recuperar durante 30 días)
  async removeEntry(name) {
    const f = (await driveList(this.id)).find((x) => x.name === name);
    if (!f) throw new DOMException('No existe ' + name, 'NotFoundError');
    await driveJson('files/' + f.id + '?fields=id', 'PATCH', { trashed: true });
    driveForget(this.id);
  }
}

class DriveFile {
  constructor(f, parent) { this.kind = 'file'; this.id = f.id; this.name = f.name; this.modified = f.modifiedTime; this.parent = parent; this.drive = true; }
  async getFile() {
    const text = await (await driveFetch(DRIVE_API + 'files/' + this.id + '?alt=media')).text();
    return { text: async () => text, lastModified: Date.parse(this.modified) || Date.now() };
  }
  async createWritable() {
    const parts = [];
    return {
      write: async (data) => { parts.push(data); },
      close: async () => {
        await driveFetch(DRIVE_UPLOAD + 'files/' + this.id + '?uploadType=media', {
          method: 'PATCH', headers: { 'Content-Type': mimeFor(this.name) + '; charset=UTF-8' }, body: parts.join(''),
        });
        driveForget(this.parent);
      },
    };
  }
}

/* Aviso cuando se corta la conexión (Google la da por una hora; volver a entrar es un clic) */
function showDriveBar() { const b = document.getElementById('driveBar'); if (b) b.hidden = false; }
function hideDriveBar() { const b = document.getElementById('driveBar'); if (b) b.hidden = true; }

/* Elegir la carpeta de Drive donde están tus textos */
function pickDriveFolder() {
  return new Promise((resolve) => {
    const box = document.getElementById('drivePick');
    const list = document.getElementById('dpList');
    const crumbs = document.getElementById('dpCrumbs');
    const path = [{ id: 'root', name: 'Mi unidad' }];
    const done = (value) => { box.hidden = true; resolve(value); };
    const show = async () => {
      const here = path[path.length - 1];
      crumbs.textContent = path.map((p) => p.name).join(' › ');
      // Toda la unidad no: hay que entrar a una carpeta (por ejemplo, Capital Escritorio)
      const use = document.getElementById('dpUse');
      use.disabled = path.length === 1;
      use.textContent = path.length > 1 ? 'Usar «' + here.name + '»' : 'Entrá a una carpeta';
      list.innerHTML = '<p class="dp-wait">Buscando carpetas…</p>';
      try {
        // "Capital Escritorio" (o la que se usó antes) va primero
        const fav = (f) => (f.id === (pref('driveRoot', {}) || {}).id || /capital/i.test(f.name) ? 0 : 1);
        const folders = (await driveList(here.id)).filter((f) => f.mimeType === DRIVE_FOLDER)
          .sort((a, b) => fav(a) - fav(b) || a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));
        list.innerHTML = '';
        if (path.length > 1) {
          const up = document.createElement('button');
          up.type = 'button'; up.className = 'dp-item dp-up'; up.textContent = '‹ Volver';
          up.onclick = () => { path.pop(); show(); };
          list.append(up);
        }
        for (const f of folders) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'dp-item' + (fav(f) ? '' : ' dp-fav'); b.textContent = f.name;
          b.onclick = () => { path.push({ id: f.id, name: f.name }); show(); };
          list.append(b);
        }
        if (!folders.length) list.insertAdjacentHTML('beforeend', '<p class="dp-wait">No hay carpetas adentro.</p>');
      } catch (e) { list.innerHTML = '<p class="dp-wait"></p>'; list.firstChild.textContent = e.message; }
    };
    document.getElementById('dpUse').onclick = () => { const here = path[path.length - 1]; if (path.length > 1) done({ id: here.id, name: here.name }); };
    box.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => done(null); });
    box.hidden = false;
    show();
  });
}
