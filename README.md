<p align="center">
  <img src="extension/icons/icon-128.png" width="96" alt="Presentazo">
</p>

<h1 align="center">Presentazo</h1>
<p align="center">Controla tus presentaciones de Chrome desde el celular.<br>
Escanea un QR y usa avance de diapositivas, puntero láser, lápiz, mouse remoto y teclado.</p>
<p align="center"><sub>Creado por <b>Miguel Mogrovejo</b> · v1.1.0 · antes llamado «Mando»</sub></p>
<p align="center"><a href="https://www.facebook.com/presentazo/">Facebook</a> · <a href="https://www.instagram.com/presentazo/">Instagram</a> · <a href="https://www.tiktok.com/@presentazo">TikTok</a> · <a href="https://www.youtube.com/@presentazo">YouTube</a> · <a href="https://x.com/presentazo">X</a></p>

---

> **Nombre:** desde la versión 1.1.0 la app se llama **Presentazo**. Las direcciones (`mjmc4498.github.io/mando`, el repositorio `mando` y el Worker `mando-turn`) se mantienen para que la versión 1.0.0 siga funcionando.

## Funciones

| | |
|---|---|
| **Diapositivas** | Siguiente/anterior (botón grande o deslizando), iniciar presentación, pantalla completa, pantalla negra, salir. Cronómetro en el celular. |
| **Puntero** | Láser con estela, foco de luz, lápiz de colores (deshacer/borrar) y *modo aire* con giroscopio. Se ve encima de la presentación incluso en pantalla completa. |
| **Mouse remoto** | Panel táctil: mover, clic, doble clic, clic derecho (dos dedos), arrastrar y desplazamiento. |
| **Teclado** | Escritura en vivo desde el teclado del celular y teclas especiales (Esc, Tab, flechas, ⌫, ↵). |
| **Conexión** | WebRTC directo y cifrado; retransmisión de Cloudflare para redes restrictivas; reconexión automática; código QR nuevo en cada sesión; varios celulares a la vez. |
| **Detalles** | Pantalla del celular siempre encendida, vibración, todo en español, modo claro/oscuro en la extensión, atajo `Alt+Shift+M`. |

Probado de principio a fin (38 comprobaciones automáticas) y verificado con **Google Slides** (iniciar, avanzar, retroceder y salir del modo presentación) y **reveal.js**.

## Cómo funciona

```
┌──────────── Chrome (computadora) ────────────┐          ┌──────── Celular ────────┐
│                                               │          │                         │
│  popup.html ── muestra el QR                  │   QR     │  remote/ (GitHub Pages) │
│      │                                        │ ───────▶ │  index.html + app.js    │
│      ▼                                        │          │          │              │
│  background.js (service worker)               │          │          │              │
│      │  crea / coordina                       │  WebRTC  │          │              │
│      ▼                                        │ ◀══════▶ │  PeerJS (cliente)       │
│  offscreen.html  ── PeerJS (anfitrión)        │ cifrado  └─────────────────────────┘
│      │  valida y reenvía cada orden           │
│      ▼                                        │        Señalización: 0.peerjs.com
│  content/isolated.js ── capa visual, mouse,   │        (solo para establecer la
│      │                  iframes               │         conexión; no ve las órdenes)
│      ▼                                        │
│  content/main.js ── teclas con keyCode        │
│                     (Slides, PowerPoint…)     │
└───────────────────────────────────────────────┘
```

- El QR contiene `https://…/mando/#id=<sesión>&k=<clave>`. La clave viaja en el fragmento `#` (nunca llega a un servidor) y el celular la borra de la barra de direcciones al conectarse.
- **Permisos mínimos:** Presentazo usa `activeTab`, así que solo actúa en la pestaña donde se pulsa su ícono. El acceso a todos los sitios es **opcional** (`optional_host_permissions`) y se pide con un clic solo para «Seguir la pestaña activa» o para presentaciones incrustadas desde otro sitio; se puede quitar en Ajustes.
- Los scripts de contenido **solo actúan mientras hay una sesión iniciada** y se retiran al detenerla.
- La capa visual se dibuja en la capa superior del navegador (elemento `popover`), por eso el láser se ve encima de presentaciones en pantalla completa.
- Si la presentación está dentro de un iframe de otro dominio (p. ej. PowerPoint para la web), las órdenes se enrutan a ese iframe con una sonda de un solo uso a través del service worker.

## Estructura

```
mando/
├── extension/           ← lo que se empaqueta y sube a la Chrome Web Store
│   ├── manifest.json
│   ├── background.js    service worker
│   ├── offscreen.*      conexión WebRTC
│   ├── popup.*          panel con el QR
│   ├── options.*        ajustes y bienvenida
│   ├── content/         scripts que actúan sobre la presentación
│   ├── lib/             PeerJS, generador de QR, i18n
│   ├── _locales/        textos en español
│   └── icons/
├── remote/              ← control del celular (se publica en GitHub Pages)
│   └── privacy.html     política de privacidad (URL pública para la tienda)
├── cloudflare/          ← Worker que entrega credenciales de retransmisión (TURN)
├── store/               ← imágenes y textos para la ficha de la tienda (LISTING.md)
├── design/              logos SVG y composiciones de las imágenes de la tienda
├── scripts/             build.sh, render.py, capture-store.mjs
├── test/                prueba de punta a punta y página de prueba
└── dist/                paquetes generados (.zip / .crx)
```

## Publicación paso a paso

### 1. Publica el control del celular (una sola vez)

El QR abre `https://mjmc4498.github.io/mando/`, así que esa página debe existir:

```bash
cd mando
git init -b main && git add . && git commit -m "Presentazo 1.0.0"
gh repo create mjmc4498/mando --public --source . --push
gh api -X POST repos/mjmc4498/mando/pages -f build_type=workflow
```

El flujo `.github/workflows/pages.yml` publica la carpeta `remote/` en cada cambio. En 1–2 minutos estarán disponibles:

- Control: `https://mjmc4498.github.io/mando/`
- Privacidad: `https://mjmc4498.github.io/mando/privacy.html`

> ¿Otra dirección? Cambia `REMOTE_URL` en `extension/config.js` (y `homepage_url` en el manifiesto) y vuelve a empaquetar. También puede cambiarse en **Ajustes › Avanzado** sin reempaquetar.

### 2. Prueba la extensión en tu Chrome

1. Ejecuta `./scripts/build.sh`.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar extensión sin empaquetar**.
3. Elige la carpeta `dist/mando/` (su ruta no cambia entre versiones).
4. Abre una presentación, haz clic en el ícono de Presentazo y escanea el QR.

### 3. Empaqueta

```bash
./scripts/build.sh
```

Genera `dist/mando-<versión>.zip` para la tienda y la carpeta `dist/mando/` para «Cargar extensión sin empaquetar» (valida manifiesto, íconos, idiomas y scripts antes de comprimir).

Para un `.crx` instalable fuera de la tienda: `./scripts/build.sh --crx` (la clave queda en `keys/mando.pem`; guárdala y no la subas a git). **La Chrome Web Store solo acepta el ZIP**; ella firma el paquete final.

### 4. Sube a la Chrome Web Store

1. Entra al [Panel del desarrollador](https://chrome.google.com/webstore/devconsole) (registro único de USD 5).
2. **Nuevo elemento** → sube el ZIP más reciente de `dist/` (hoy `dist/mando-1.1.0.zip`).
3. Completa las pestañas copiando los textos de [`store/LISTING.md`](store/LISTING.md) y sube las imágenes de `store/`.
4. **Enviar para revisión.** Como la extensión pide acceso a todos los sitios, la revisión puede tardar algunos días; las justificaciones de permisos ya están redactadas en `LISTING.md`.

### Nuevas versiones

1. Sube `version` en `extension/manifest.json` (p. ej. de `1.1.0` a `1.1.1`).
2. Anota los cambios en `CHANGELOG.md`.
3. `./scripts/build.sh` y sube el nuevo ZIP en el panel (**Paquete › Subir nuevo paquete**). Espera a que la versión anterior termine su revisión.
4. En Chrome, pulsa **Actualizar** en la página de Extensiones: la carpeta `dist/mando/` siempre tiene la última versión.

## Desarrollo

```bash
npm install                 # instala Puppeteer (solo para pruebas y capturas)
npm run serve               # servidor local en http://localhost:8765 (otra terminal)
npm run test:e2e            # prueba completa con activeTab (instalación normal)
npm run test:e2e:todos      # la misma prueba con el acceso opcional a todos los sitios concedido
npm run icons               # regenera íconos desde design/*.svg
npm run store:capture       # capturas reales de la extensión
npm run store:images        # compone las imágenes de la tienda
```

- Vista previa del control sin computadora: `http://localhost:8765/remote/?demo` (añade `&view=pointer`, `mouse` o `keys`).
- Prueba local con el celular: en **Ajustes › Avanzado** pon `http://<IP-de-tu-computadora>:8765/remote/` (misma red Wi-Fi).

### Retransmisión con Cloudflare (redes restrictivas)

Algunas redes (de empresa, hoteles, Wi-Fi públicos) bloquean la conexión directa entre el celular y la computadora. Para esos casos Presentazo usa el servidor TURN de **Cloudflare Realtime**, que retransmite el tráfico ya cifrado sin poder leerlo.

- La carpeta `cloudflare/` contiene un **Worker** (`https://mando-turn.mjmc4498.workers.dev`) que entrega credenciales temporales (4 h). La clave de TURN vive solo como secreto del Worker; nunca está en la extensión ni en el celular.
- La extensión y el celular piden las credenciales al conectarse. Si el Worker no responde, siguen con la conexión directa de siempre.
- **Costo:** gratis hasta 1.000 GB al mes; Presentazo gasta pocos megabytes por presentación.
- **Protección contra cobros:** cada 15 minutos el Worker mide el consumo del mes. Al llegar a **900 GB** pausa la retransmisión, revoca las credenciales activas y se reactiva solo el día 1 del mes siguiente (Presentazo sigue con conexión directa). Además limita los pedidos a 10 por minuto por dirección IP.
- **Consumo del mes:** <https://mando-turn.mjmc4498.workers.dev/estado>. El límite se cambia en `MONTHLY_LIMIT_GB` (`cloudflare/wrangler.toml`).
- **Freno de emergencia:** borra la clave en dash.cloudflare.com › Realtime › TURN Server; la retransmisión se apaga al instante.

Actualizar o volver a desplegar el Worker:

```bash
cd cloudflare
npx wrangler deploy
```

Secretos del Worker (se guardan una vez; nunca van en el código):

```bash
npx wrangler secret put TURN_KEY_ID          # ID de la clave TURN (32 caracteres)
npx wrangler secret put TURN_KEY_API_TOKEN   # API Token de la clave TURN (64 caracteres)
npx wrangler secret put CF_ANALYTICS_TOKEN   # token de solo lectura «Account Analytics»
```

### Servidor de señalización propio (opcional)

Presentazo usa el servidor público gratuito de PeerJS. Para no depender de él, despliega un [PeerServer](https://github.com/peers/peerjs-server) y pasa `{ host, port, path, secure }` al crear `new Peer(...)` en `extension/offscreen.js` y `remote/app.js`.

## Limitaciones

- Chrome no permite extensiones en `chrome://`, en la Chrome Web Store ni en su visor de PDF integrado.
- Los eventos son sintéticos: funcionan con las apps web de presentaciones, pero no pueden abrir menús nativos del sistema ni selectores de archivos.
- PowerPoint o Keynote de escritorio no están en Chrome, así que no se pueden controlar.

## Redes sociales

Síguenos en nuestras redes oficiales:

- **Facebook:** <https://www.facebook.com/presentazo/>
- **Instagram:** <https://www.instagram.com/presentazo/>
- **TikTok:** <https://www.tiktok.com/@presentazo>
- **YouTube:** <https://www.youtube.com/@presentazo>
- **X:** <https://x.com/presentazo>

## Licencia

© 2026 Miguel Mogrovejo. Incluye PeerJS y QR Code Generator (MIT) — ver `extension/THIRD_PARTY_NOTICES.txt`.
