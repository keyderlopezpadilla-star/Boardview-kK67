# Boardview KK67 Pro

Visor profesional de **boardviews** para diagnóstico y reparación de placas de portátiles. Aplicación web 100 % local (ningún archivo sale del navegador), con render a 60 fps sobre placas de +100k pines, enlace bidireccional con esquemáticos PDF y registro de mediciones de banco.

> Proyecto original. No contiene código, claves ni recursos de FlexBV u otros visores comerciales. La lógica de formatos se implementó a partir de la documentación pública de OpenBoardView (MIT).

## Arranque rápido

```bash
npm install
npm run dev        # http://localhost:5173  (añade ?demo para abrir la placa de muestra)
npm run build      # build estático en dist/ — desplegable en cualquier hosting estático
npm test           # tests de parsers, criptografía y pipeline
```

## Aplicaciones nativas

| Plataforma | Artefacto | Cómo se genera |
|---|---|---|
| Windows 10/11 x64 | `Boardview-KK67-Pro-Setup-x.y.z.exe` (instalador, asocia `.brd/.cad/.bdv/.fz/.pcb/…`) y `…-portable.exe` | `npm run dist:win` (en Linux requiere Wine 32+64 bits) |
| Android / Chromebook | `app-release.apk` (Android 6+, target SDK 35) | `npm run dist:android` (JDK 21 + Android SDK 35) |
| Chromebook / cualquier navegador | PWA instalable y offline | `npm run build` y servir `dist/` por HTTPS → *Instalar app* |

- **Electron** (`electron/`): sirve `dist/` por un esquema privilegiado `app://` (workers y pdf.js igual que en web), instancia única, abre los archivos recibidos por doble clic o línea de comandos, sin acceso a Node desde la página (`contextIsolation`, `sandbox`).
- **Capacitor** (`android/`): misma build web empaquetada; el selector de archivos acepta cualquier extensión (Android no conoce `.brd`/`.cad`).
- **Firma Android**: `android/keystore.properties` + `android/keystore/*.jks` (no versionados). Guarda ese keystore: todas las actualizaciones futuras del APK deben firmarse con él.

## Formatos soportados

| Formato | Extensión | Notas |
|---|---|---|
| BRD (Test_Link / OBV) | `.brd` | Texto plano y variante cifrada (`0x23 0xE2 0x63 0x28`), variante Lenovo (redes desde nails) |
| BRD2 | `.brd` | `BRDOUT:` (Gigabyte, MSI) con caras y espejado |
| BDV | `.bdv` | HONHAN, desofuscación incluida |
| ASC (TSICT) | `format.asc` + `pins.asc` + `nails.asc` | Sueltos o dentro de ZIP |
| BVR / BVR3 | `.bvr` | BVRAW_FORMAT_1 y BVRAW_FORMAT_3 (outline segmentado) |
| GenCAD 1.4 | `.cad` `.gcd` | Pads, padstacks, shapes con rotación/espejo, señales, vías, dispositivos |
| Panel CAD | `.cad` | `COMP` / `C_PIN` / `N_VIA` |
| FZ (ASUS) | `.fz` | Variante zlib sin cifrar directa; cifrada RC6 con **clave del usuario** |
| XZZ | `.pcb` | Descifrado DES de bloques de componentes con **clave del usuario** |
| CST | `.cst` | Castw binario |
| ZIP | `.zip` | Recursivo (zip dentro de zip). Si contiene PDF, se abre como esquemático |
| PDF | `.pdf` | Esquemático en panel lateral |

Las claves FZ/XZZ **no se distribuyen**: se introducen en *Ajustes → Claves de formato*, se validan por paridad y se guardan solo en el navegador.

## Funcionalidades

- **Navegación fluida**: zoom anclado al cursor con suavizado crítico, arrastre directo, pinch en táctil, trackpad, minimapa interactivo.
- **Caras**: Top / Bottom (espejado automático) / Ambas (inferior atenuada), rotación 90°, espejo manual.
- **Redes**: clic en pin → resaltado de la red con *ratsnest* (árbol de expansión mínima). `Shift+clic` fija hasta 5 redes en colores distintos para comparar.
- **Clasificación automática de redes**: alimentación, masa, señal y NC (heurística para nomenclaturas Apple, Quanta, Compal, Wistron…).
- **Búsqueda global** (`Ctrl/⌘+K`): componentes, redes y pines (`U1000.A12`) con coincidencia difusa.
- **Esquemático PDF enlazado**: al seleccionar un componente/red se busca en el PDF; al seleccionar o hacer doble clic en un texto del PDF se localiza en la placa.
- **Mediciones de banco**: diodo, tensión, resistencia y notas por pin/componente/red; se dibujan sobre la placa. Exportables/importables en JSON.
- **Herramienta de medición** de distancias (mil/mm) con *snap* a centros de pad.
- **Contornos inteligentes**: rectángulo orientado de área mínima (rotating calipers) y tamaño de pad automático por vecino más cercano.
- **Temas**: Carbon, Midnight y Paper (claro, apto para impresión). Captura PNG.

## Atajos

| Tecla | Acción |
|---|---|
| `Ctrl/⌘ K` · `/` | Búsqueda global |
| `Ctrl/⌘ O` | Abrir |
| `Espacio` | Alternar Top / Bottom |
| `B` | Ambas caras |
| `R` / `Shift R` | Rotar ± 90° |
| `X` | Espejo |
| `F` / `Shift F` | Encuadrar placa / selección |
| `M` | Medir |
| `P` | Panel PDF |
| `[` · `]` | Ocultar listas / inspector |
| `Esc` | Limpiar selección |

## Arquitectura

```
src/
├── core/        modelo de placa, normalización, búsqueda, store, anotaciones
├── parsers/     un módulo por formato + detección por firma y expansión de ZIP
├── crypto/      RC6 (FZ) y DES por tablas (XZZ), validados con vectores FIPS
├── worker/      parsing en Web Worker (UI nunca se bloquea)
├── render/      cámara, índice espacial, renderer Canvas2D por tiles + LOD, minimapa
├── ui/          sidebar virtualizada, inspector, paleta, panel PDF (pdf.js), modales
└── demo/        placa procedural determinista (se serializa como BRD real)
```

**Rendimiento** — geometría estática precocinada en `Path2D` por *tile × cara × clase de red*; solo se dibujan los tiles visibles. Con pads sub-píxel se usan cuadrados (LOD). Durante el movimiento se omiten glow y etiquetas finas, y se pinta un frame nítido al detenerse. Referencia (Chromium headless, raster por software): placa de 120 000 pines → mediana 16,7 ms/frame; parse + normalización 245 ms; DES 69 ms/MB.

## Esquemático de muestra

`public/demo/KK67-DEMO-schematic.pdf` es un esquemático original generado con `scripts/make-demo-schematic.cjs` (requiere Playwright) y casa con la placa procedural de la demo.

## Licencias de terceros

- [pdf.js](https://github.com/mozilla/pdf.js) — Apache-2.0 (incluye reglas CSS de su capa de texto).
- [fflate](https://github.com/101arrowz/fflate) — MIT.
