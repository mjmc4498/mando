# Registro de cambios

Todas las versiones de Presentazo: la extensión de Chrome y la app de escritorio. En la
extensión, el número de versión de cada paquete debe ser mayor que el anterior para que
la Chrome Web Store lo acepte.

## App de escritorio 1.0.0 (16 de octubre de 2026)

- **Primera versión para Windows y Mac** (Intel y chip M). Controla desde el celular
  PowerPoint, Keynote, Acrobat, Vista Previa, Presentaciones de Google o cualquier
  programa: el celular usa el mismo control remoto que la extensión.
- **Elige qué controlar:** una pantalla, un programa o una pestaña del navegador
  (Chrome, Edge, Brave, Firefox o Safari). Presentazo los trae al frente antes de
  cada orden; en automático controla lo que esté al frente.
- Puntero láser, foco, lápiz y pantalla negra encima de cualquier programa. Con un
  proyector o monitor externo conectado, el puntero aparece en esa pantalla.
- Mouse remoto y teclado con tildes y ñ.
- Reconoce el programa al frente para iniciar la presentación con el atajo correcto
  y muestra en el celular qué se está controlando.
- Queda en la barra de menú (Mac) o junto al reloj (Windows), con opción de abrirse
  al encender la computadora.
- Instaladores en `instaladores/`, separados por sistema y por tipo.

## 1.1.0 (15 de octubre de 2026)

- **Nuevo nombre: Presentazo** (antes «Mando»). Las direcciones web y el
  funcionamiento no cambian.
- **Más privada:** ya no pide acceso a todos los sitios al instalarse. Actúa
  solo en la pestaña donde pulsas su ícono (`activeTab`). El acceso amplio es
  opcional y se pide con un clic solo para «Seguir la pestaña activa» o para
  presentaciones incrustadas desde otro sitio (p. ej. PowerPoint para la web).
- Enlaces a las redes oficiales de Presentazo en la página de Ajustes.
- **Funciona en redes restrictivas.** Si una red (de empresa, de un hotel o un
  Wi-Fi público) bloquea la conexión directa, Presentazo usa el servidor de
  retransmisión de Cloudflare. El tráfico sigue cifrado de extremo a extremo.
  Para evitar cobros, la retransmisión se pausa sola si el consumo del mes se
  acerca a la cuota gratuita de Cloudflare, y se reactiva el mes siguiente.
- **Código QR nuevo en cada sesión** (opción activada por defecto en Ajustes):
  el código anterior deja de servir cada vez que inicias una sesión.
- La extensión ya no muestra el aviso «Lost connection to server» en la página
  de Extensiones de Chrome: es un corte breve que Presentazo resuelve solo.
- Reconexión más segura: si el servidor tarda en liberar la sesión, Presentazo
  reintenta sin desconectar a los celulares que ya están conectados.

## 1.0.0 (15 de octubre de 2026)

Primera versión, publicada con el nombre «Mando»: control de diapositivas, puntero láser, foco, lápiz, mouse
remoto y teclado desde el celular, conectado por código QR.
