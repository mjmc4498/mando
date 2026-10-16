# Presentazo para Windows y Mac

Presentazo también funciona como app para tu computadora. Con ella controlas desde el celular cualquier presentación: PowerPoint, Keynote, Presentaciones de Google, un PDF o el programa que uses. En el celular se abre el mismo control remoto que usa la extensión de Chrome.

## Qué archivo usar

Cada sistema tiene dos versiones: **instalador** (la app se instala como cualquier programa) y **portable** (se abre directo, sin instalar).

| Computadora | Instalador | Portable |
|---|---|---|
| Windows 10 u 11 | `windows/instalador/Presentazo-1.0.0-Windows-Instalador.exe` | `windows/portable/Presentazo-1.0.0-Windows-Portable.exe` |
| Mac con procesador Intel | `mac-intel/instalador/Presentazo-1.0.0-Mac-Intel.dmg` | `mac-intel/portable/Presentazo-1.0.0-Mac-Intel.zip` |
| Mac con chip M (M1, M2, M3, M4…) | `mac-chip-m/instalador/Presentazo-1.0.0-Mac-Chip-M.dmg` | `mac-chip-m/portable/Presentazo-1.0.0-Mac-Chip-M.zip` |

Para saber qué Mac tienes, abre el menú Apple › Acerca de esta Mac. Si dice "Chip Apple M…", usa la versión de chip M. Si dice "Procesador Intel", la de Intel.

## Windows

1. Abre el instalador. Como la app todavía no tiene firma digital, Windows puede mostrar "Windows protegió tu PC". Pulsa **Más información** y luego **Ejecutar de todas formas**.
2. Sigue los pasos. Se crean accesos directos en el escritorio y en el menú Inicio.
3. Abre Presentazo y escanea el código QR con el celular.

La versión portable sirve para usar Presentazo desde una memoria USB o en una computadora donde no puedes instalar programas.

## Mac

1. Abre el `.dmg` y arrastra Presentazo a la carpeta Aplicaciones.
2. La primera vez, macOS avisa que no puede verificar al desarrollador. Abre **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre Presentazo y pulsa **Abrir igualmente**.
3. Para pasar diapositivas y mover el mouse, macOS pide el permiso de Accesibilidad. En Presentazo pulsa **Dar permiso** y activa Presentazo en **Privacidad y seguridad › Accesibilidad**.

El `.zip` es la misma app sin instalador: descomprímelo y abre Presentazo.

Si después de actualizar la app el celular deja de pasar diapositivas, quita Presentazo de la lista de Accesibilidad y vuelve a activarlo.

## Cómo se usa

1. Abre Presentazo. Aparece un código QR.
2. Escanéalo con la cámara del celular. Se abre el control remoto, no hay que instalar nada.
3. Abre tu presentación y contrólala: pasar diapositivas, puntero láser, foco, lápiz, pantalla negra, mouse y teclado.

### Elegir qué controlar

En el panel de Presentazo, en **Qué vas a controlar**, pulsa **Cambiar**:

- **Pantalla:** el puntero aparece en esa pantalla y las teclas van a lo que se muestra ahí. Útil con un proyector. El botón **Identificar** muestra el número en cada pantalla.
- **Programa:** elige la ventana de tu presentación (PowerPoint, Keynote, un PDF…). Si otra ventana queda al frente, Presentazo la vuelve a traer antes de pasar la diapositiva.
- **Pestaña:** elige una pestaña de Chrome, Edge, Brave, Firefox o Safari. Presentazo cambia a esa pestaña antes de cada orden.
- **Automático:** controla lo que esté al frente. Es la opción de siempre.

En Mac, ver la lista de programas y pestañas también necesita el permiso de Accesibilidad.

Al conectar el celular, la ventana de Presentazo se oculta para dejar tu presentación al frente. La app sigue en la barra de menú (Mac) o junto al reloj (Windows); desde ahí puedes ver el código, crear uno nuevo o salir.

Con un proyector o un monitor externo conectado, el puntero aparece en esa pantalla, salvo que elijas otra.

En Keynote, si no ves el puntero durante la presentación, abre Keynote › Ajustes › Pase de diapositivas y activa la opción que permite que otras apps usen la pantalla.

## Comprobar los archivos

`SHA256.txt` tiene la huella SHA-256 de cada archivo. Para compararla:

- Mac: `shasum -a 256 nombre-del-archivo`
- Windows (PowerShell): `Get-FileHash nombre-del-archivo`

## Volver a generar los instaladores

Desde la carpeta `escritorio` del proyecto, en una Mac:

```bash
npm install
npm run instaladores
```

Para generar solo algunos: `npm run instaladores -- windows mac-intel mac-chip-m`.
