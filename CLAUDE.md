# Capital

Editor de Markdown literario, estilo Typora, hecho como PWA. Se publica con GitHub Pages en https://eduaispuru.github.io/capital/ desde la rama `main`.

El dueño la usa en Windows y en una Chromebook. Sus textos están en una carpeta "Capital Escritorio" sincronizada por Google Drive, que la app abre con la File System Access API.

## Cómo trabajar

- Hablale en español rioplatense, con voseo.
- Publicá vos: commit en `main`, push, y después chequeá que Pages haya terminado (`gh api repos/eduaispuru/capital/pages/builds/latest --jq '.status'` tiene que decir `built`).
- En cada cambio de la app subí `VERSION` en `sw.js`; si no, los usuarios no reciben la versión nueva. Si agregás archivos que la app necesita sin conexión, sumalos a `CORE`.
- Los mensajes de commit terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Probá en un navegador antes de publicar. Para servir la app alcanza con cualquier servidor estático en esta carpeta.
- Explicá los cambios sin jerga: el dueño escribe, no programa.

## Cómo está hecha

- `index.html`, `styles.css`, `app.js` (casi toda la lógica), `fonts.css` + `fonts/` (fuentes literarias de Google Fonts guardadas localmente, licencia OFL), `sw.js` (service worker de red primero: funciona sin conexión).
- Editor: Vditor 3.11.2 en modo IR, copiado en `vendor/vditor/`. Lo que se agrega al DOM del editor (atributos, estilos en línea) no pasa al Markdown.
- Paginado tipo libro con CSS multicolumna (`column-height` + `column-wrap: wrap`); las hojas se dibujan aparte en `#pages`. Funciones clave: `layout()` y `paginate()`.
- Notas al pie al final de cada página: `layoutNotes()`, dibujadas en `#notesLayer`. Les hace lugar con `widows` o, si el párrafo no estaba cortado, con un truco de padding-bottom y margen negativo.
- El PDF reproduce la pantalla: en `beforeprint`, `layout()` usa el tamaño real del papel (96 px/in) y `printSetupPaged()` arma el `@page` con el folio.
- Panel de Estilo con estilos guardables. Cada archivo recuerda su estilo (`bookStyles`, clave `carpeta/ruta`).
- Corrector ortográfico propio: `spell-worker.js` lee el Hunspell RLA-ES de `dict/` (afijos, REP/MAP para sugerencias). Suma formas de voseo generadas, prefijos y diminutivos, y las palabras de `dict/capital-extra.txt` (formato `palabra/modelo`). Subraya con la CSS Custom Highlight API (`::highlight(capital-spell)`) y tiene su propio menú de sugerencias.
- Sincronización entre computadoras: `capital-ajustes.json` en la carpeta abierta guarda las palabras agregadas, los estilos guardados y el estilo de cada archivo. Gana el cambio más nuevo y los borrados quedan marcados.
- Otros: barra inferior con datos ocultables, botón flotante para ir al final, `***` + Enter crea un cambio de escena (párrafo con ⁂) y Tab al inicio del párrafo pone sangría.
- Las preferencias van en `localStorage` con el prefijo `tinta:` (nombre viejo del proyecto).

## Historia

- Se probó un rediseño llamado "Gabinete" y se descartó. El diseño actual es el clásico; el respaldo previo a Gabinete está en la rama `clasico` y en la etiqueta `clasico-v22`.
