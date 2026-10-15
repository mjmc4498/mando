# Ficha para la Chrome Web Store — Presentazo

> Desde la versión 1.1.0 la extensión se llama **Presentazo** (antes «Mando»). El nombre de la ficha se actualiza solo al publicarse la 1.1.0, porque sale del paquete.

Todo lo que pide el [Panel del desarrollador](https://chrome.google.com/webstore/devconsole), listo para copiar y pegar.

---

## 1. Paquete

| Campo | Valor |
|---|---|
| Primera publicación (en revisión) | `dist/mando-1.0.0.zip` · versión 1.0.0, con el nombre «Mando» |
| Actualización lista para subir | `dist/mando-1.1.0.zip` · versión 1.1.0 (ver `CHANGELOG.md`) |
| Autor | Miguel Mogrovejo |

---

## 2. Pestaña «Ficha de la tienda»

### Idioma: Español

**Nombre** (viene del manifiesto, 39 caracteres)
```
Presentazo: control remoto de presentaciones
```

**Resumen** (viene del manifiesto, 112/132 caracteres)
```
Controla tus presentaciones desde el celular: escanea un QR y usa avance, puntero láser, mouse remoto y teclado.
```

**Descripción**
```
Convierte tu celular en el control remoto de tus presentaciones. Sin apps, sin cuentas y sin cables: escanea un código QR y listo.

▶ DIAPOSITIVAS
• Avanza y retrocede con botones grandes o deslizando el dedo.
• Inicia la presentación, activa la pantalla completa o sal de ella.
• Pantalla negra para captar la atención del público.
• Cronómetro de la charla en el celular.

● PUNTERO
• Láser con estela suave, visible incluso en pantalla completa.
• Modo foco: oscurece la pantalla y resalta un círculo de luz.
• Lápiz de colores para dibujar sobre la diapositiva, con deshacer y borrar.
• Modo aire: apunta moviendo el celular (giroscopio).

🖱 MOUSE REMOTO
• Panel táctil completo: mover, clic, doble clic, clic derecho y arrastrar.
• Desplázate con dos dedos o con la barra lateral.

⌨ TECLADO
• Escribe en la computadora en tiempo real desde el teclado del celular.
• Teclas especiales: Esc, Tab, flechas, borrar e Intro.

CÓMO FUNCIONA
1. Abre tu presentación en Chrome.
2. Haz clic en el ícono de Presentazo (o pulsa Alt+Shift+M) y escanea el código QR.
3. El control se abre en el navegador del celular. ¡A presentar!

COMPATIBLE CON
Google Slides, PowerPoint para la web, Canva, Pitch, Figma Slides, Gamma, Prezi, reveal.js, Keynote en iCloud y cualquier página que use el teclado para avanzar.

PRIVADO Y SEGURO
• Conexión directa y cifrada de extremo a extremo (WebRTC) entre tu celular y tu computadora.
• Sin cuentas, sin anuncios, sin analítica. Presentazo no recopila datos personales.
• Los scripts solo se activan mientras hay una sesión iniciada.
• Genera un código nuevo en cualquier momento para desconectar a todos.

DETALLES CUIDADOS
• Diseño minimalista con modo oscuro en el celular.
• La pantalla del celular se mantiene encendida mientras presentas.
• Reconexión automática si la red se interrumpe.
• Vibración al pulsar (en celulares compatibles).

Creado por Miguel Mogrovejo.
```

**Categoría:** Productividad › Herramientas

**Idioma:** Español

---

## 3. Recursos gráficos

| Recurso | Archivo | Tamaño |
|---|---|---|
| Ícono de la tienda | `store/icon-128.png` | 128×128 |
| Captura 1 | `store/screenshots/1-presenta-desde-tu-celular.png` | 1280×800 |
| Captura 2 | `store/screenshots/2-conecta-con-un-qr.png` | 1280×800 |
| Captura 3 | `store/screenshots/3-puntero-y-lapiz.png` | 1280×800 |
| Captura 4 | `store/screenshots/4-mouse-y-teclado.png` | 1280×800 |
| Captura 5 | `store/screenshots/5-ajustes.png` | 1280×800 |
| Mosaico promocional pequeño | `store/promo-small-440x280.png` | 440×280 |
| Mosaico de marquesina (opcional) | `store/promo-marquee-1400x560.png` | 1400×560 |

---

## 4. Enlaces

| Campo | Valor |
|---|---|
| Sitio web oficial | `https://mjmc4498.github.io/mando/` |
| URL de asistencia | `https://github.com/mjmc4498/mando/issues` |
| Política de privacidad | `https://mjmc4498.github.io/mando/privacy.html` |

> Estas direcciones funcionan después de publicar el repositorio `mando` en GitHub con Pages activado (ver README).

---

## 5. Pestaña «Prácticas de privacidad»

**Descripción del propósito único**
```
Presentazo permite controlar desde el celular la presentación abierta en una pestaña de Chrome: avanzar y retroceder diapositivas, mostrar un puntero láser o un foco, dibujar, mover un mouse remoto y escribir texto. El celular se conecta escaneando un código QR.
```

**Justificación de permisos**

`offscreen`
```
Mantiene en segundo plano la conexión WebRTC con el celular del usuario. Los service workers no pueden usar WebRTC, por eso se usa un documento offscreen con el motivo WEB_RTC.
```

`scripting`
```
Registra los scripts de contenido de Presentazo solo mientras hay una sesión iniciada y los inyecta en la pestaña de la presentación (incluidos sus iframes) para ejecutar las órdenes del celular: teclas para cambiar de diapositiva, clics, desplazamiento, texto y la capa visual del puntero. Al detener la sesión, los scripts se desregistran.
```

`storage`
```
Guarda los ajustes del usuario (color y tamaño del puntero, tecla de avance, etc.) y el identificador aleatorio de la sesión para que el celular pueda reconectarse.
```

Permiso de host (`<all_urls>`)
```
Las presentaciones pueden estar en cualquier sitio (Google Slides, PowerPoint para la web, Canva, Pitch, archivos locales, etc.) y a menudo dentro de iframes de otros dominios. Presentazo necesita acceso a la pestaña que el usuario elige controlar para simular teclas y clics y dibujar el puntero encima. No lee ni transmite el contenido de las páginas; solo envía al celular del usuario el título de la pestaña controlada.
```

**¿Usas código remoto?** → **No.** Todo el JavaScript va incluido en el paquete (PeerJS y el generador de QR están en `lib/`). La conexión con el servidor de señalización de PeerJS solo intercambia datos, no código.

**Uso de datos** — marca:
- ☑ **Contenido del sitio web** — el título de la pestaña controlada se muestra en el celular del propio usuario (viaja cifrado de punto a punto; no llega al desarrollador).

Y las tres certificaciones:
- ☑ No vendo ni transfiero datos de usuarios a terceros fuera de los casos de uso aprobados.
- ☑ No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único del elemento.
- ☑ No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni para otorgar préstamos.

---

## 6. Instrucciones para el revisor (campo «Notas para el revisor», opcional)

```
1. Abre cualquier presentación de Google Slides (o https://revealjs.com/demo/).
2. Haz clic en el ícono de Presentazo: se muestra un código QR.
3. Escanéalo con un celular, o pulsa «Copiar enlace» y ábrelo en otra ventana o dispositivo.
4. En la página que se abre, usa «Siguiente», la pestaña «Puntero», «Mouse» o «Teclado».
No se necesita cuenta ni credenciales.
```

---

## 7. Distribución

- **Visibilidad:** Pública
- **Regiones:** Todas
- **Precio:** Gratis
