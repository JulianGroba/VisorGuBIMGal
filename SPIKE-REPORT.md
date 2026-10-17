# SPIKE-REPORT.md — Fase 0 (spike de IFC-Lite)

Entregable obligatorio del §12 de `SPEC_IFCLITE_BIM_GIS_VIEWER.md`.
Fecha: 17 de octubre de 2026. Autor: Julián Groba.

> **Decisión: CONTINUAR con IFC-Lite**, con las condiciones del §8.
> La Fase 0 se aprueba **por partes**: las demos 1 a 5 están demostradas; las
> demos 6 a 8 (CAD real, Vercel, portátil sin WebGPU) siguen pendientes y se
> detallan abajo sin adornos.

---

## 1. Qué se ha construido

Spike mínimo de TypeScript + Vite sobre IFC-Lite. No usa la plantilla oficial
de IFC-Lite: se ha escrito una estructura propia, mínima, alineada con §5 de la
especificación, para no arrastrar una plantilla cuyo andamiaje habría que
desmontar en la Fase 1.

| Fichero del spike | Responsabilidad | Equivalente en §5 |
|---|---|---|
| `src/viewer.ts` | Adaptador IFC-Lite: parseo, geometría, escena federada, selección, propiedades, georreferenciación | `src/infrastructure/ifclite` |
| `src/controls.ts` | Navegación 3D sobre la cámara del renderer | `src/ui` (cámara) |
| `src/drawing.ts` | Plantas, secciones, SVG, DXF, codificación Windows-1252 | `src/infrastructure/drawing` |
| `src/ui.ts` | Interfaz (sin framework), registro, diagnóstico | `src/ui` |
| `src/main.ts` | Arranque y búfer de eventos previos al montaje de la UI | `src/main` |
| `spike-fixtures/spike-test.ifc` | Fixture propio de 3 KB (muro + losa + pset + CRS) | `fixtures/` |

Sin framework de UI a propósito: el spike no debe decidir todavía el de la Fase 1.

## 2. Entorno en el que se ha probado

| Elemento | Valor |
|---|---|
| SO | Windows 11 (`win32`) |
| Node | **v26.12.0** (npm 11.20.0) |
| Navegador | Chromium 152 (Electron 44.4.5) |
| GPU | `amd / gcn-5` (adaptador obtenido, `renderer.getAdapterInfo()`) |
| WebGPU | disponible · `crossOriginIsolated: true` · `SharedArrayBuffer` disponible |
| Servido con | `vite preview` (producción) y `vite dev` — ambos verificados |

**No se ha probado** en el «portátil de referencia» del §12 ni en un equipo sin
WebGPU: la ruta degradada está implementada pero **no verificada** (ver §7).

## 3. Versiones fijadas y licencias

`package-lock.json` guardado. Versiones exactas, sin rangos:

| Paquete | Versión | Licencia |
|---|---|---|
| `@ifc-lite/parser` | 9.5.1 | MPL-2.0 |
| `@ifc-lite/geometry` | 7.8.1 | MPL-2.0 |
| `@ifc-lite/renderer` | 6.4.0 | MPL-2.0 |
| `@ifc-lite/drawing-2d` | 4.2.0 | MPL-2.0 |
| `vite` | 7.3.7 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

Dependencias transitivas relevantes que aparecen solas: `@ifc-lite/spatial`
1.15.0 (índices espaciales), `@ifc-lite/pointcloud` 0.12.0, `@ifc-lite/data`
6.2.0, `@ifc-lite/ifcx` 4.4.0, `@ifc-lite/wasm` 10.4.0.

**Nota para la revisión:** `@ifc-lite/query` (que la especificación menciona)
**no hace falta** para leer propiedades: el parser exporta
`extractPropertiesOnDemand()` y `extractQuantitiesOnDemand()`. Se ha evitado
añadir una dependencia que no aporta nada al spike.

Vite 8 y TypeScript 7 se descartaron a propósito: en un spike la incertidumbre
del toolchain no compra nada.

## 4. Cómo reproducirlo

```bash
npm install
npm run build        # tsc --noEmit && vite build
npm run dev          # http://localhost:5173
npm run preview      # sirve dist/ con COOP+COEP
```

Comprobado: `npm run build` pasa limpio (sin errores ni avisos) en 9,8–13,3 s.

## 5. Resultados medidos

### 5.1 Peso del artefacto (`dist/`, 42 ficheros)

| Fichero | Tamaño | Gzip |
|---|---|---|
| `ifc-lite_bg-*.wasm` | 9.979.156 B (9,98 MB) | 3,34 MB |
| `index-*.js` (código de la librería) | 5.397.396 B (5,40 MB) | 698,5 kB |
| `geometry.worker-*.js` | 114.442 B | — |
| `laz-perf-*.wasm` | 214.351 B | 73,8 kB |
| `index-*.js` (código propio del spike) | 53.190 B | — |
| **Total `dist/`** | **32,62 MB** | — |
| Total sin `.map` | ≈15,4 MB | ≈4,1 MB |

Los `.map` suman **17,2 MB** y no deben publicarse (ver §6 H10). El núcleo
propio del visor son 53 kB: prácticamente todo el peso es IFC-Lite + su WASM.

### 5.2 Tiempos con el fixture propio (3 KB, 52 entidades, IFC4)

| Etapa | Primera carga | Segunda carga (mismo proceso) |
|---|---|---|
| Parseo columnar | 36 ms | 34 ms |
| Geometría (WASM) | 29 ms | 1 ms |
| Subida a GPU | 3 ms | 1 ms |
| **Total percibido** | **≈70 ms** | **≈36 ms** |

Con un IFC de 3 KB estos números sólo dicen que el camino funciona y que la
WASM queda caliente. **No sirven para dimensionar nada**: falta el IFC real
(ver §7).

### 5.3 Planos y exportación

- Planta a cota 1,2 m y sección X en 5 m: generadas sin error.
- SVG: `width="420mm" height="297mm"` (A3 apaisado), 6.783 B.
- Vista previa: 1587 × 1123 px, mostrada como objeto URL en un `<img>`
  (nunca con `innerHTML`, ver `REVIEW_SPEC_IFCLITE.md` M3).
- DXF: 3.512 B, **R12 (`$ACADVER` = `AC1009`)**, `$DWGCODEPAGE` = `ANSI_1252`,
  1 comentario `999`, 3 secciones, 20 `LINE` + 2 `POLYLINE`, `$EXTMIN`/`$EXTMAX`
  coherentes con la sección. `encodeDxfCp1252()` devolvió `hadUnmappable: false`.

## 6. Hallazgos

### H1 — Defecto en `@ifc-lite/geometry@7.8.1`: el worker no se publica bien (bloqueante)

El paquete publica `dist/geometry.worker.js`, pero `dist/geometry-worker-pool.js:32`
lo referencia como `.ts`:

```js
return new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
```

Su script de publicación sólo parchea la extensión en `index.js`,
`geometry-parallel.js` y `remesh/remesh-client.js`, y **se dejó ese fichero**.
Consecuencia: el `vite build` falla con
`Could not resolve entry module "…/geometry.worker.ts"`. Cualquier bundler falla.

- **Solución en el spike:** plugin de Vite (`ifc-lite-worker-extension-fix`) que
  reescribe `.worker.ts` → `.worker.js` en el código de `@ifc-lite`, más
  `optimizeDeps.exclude` para que el plugin vea el código original.
- **Hay que reportarlo aguas arriba** y borrar el plugin cuando se corrija.

### H2 — La guía no documenta la API de cámara; existe y es completa

La guía no describe `Camera`, y por eso el spike empezó sondeando la cámara en
tiempo de ejecución. Al leer los `.d.ts` publicados: `Renderer.getCamera(): Camera`
con `orbit()`, `pan()`, `zoom()`, `fitToBounds()`, `setPresetView()`,
`animateTo()`, `update(dt): boolean`, `setProjectionMode()`, `getPosition()`,
`getTarget()`… El sondeo se ha eliminado y `src/controls.ts` usa la API real.
`update(dt)` es además lo que permite redibujar sólo cuando la cámara se anima.

### H3 — La federación está soportada: `pick()` devuelve `modelIndex`

`PickResult` = `{ expressId, modelIndex?, worldXYZ?, geometryItemId? }`, y
`MeshData` lleva `modelIndex`. `Renderer.getScene()` expone
`hasMeshData(expressId, modelIndex)`, `getMeshDataPieces(expressId, modelIndex)`,
`setModelTranslation/Rotation(modelIndex, …)`. La identidad de selección es el
**par (modelIndex, expressId)**.

**Limitación encontrada:** `RenderOptions.selectedIds` sólo acepta `Set<number>`
de expressIds, **sin modelIndex**. Con ids repetidos entre modelos, el resaltado
no se puede acotar a un modelo. Resuelto en el spike a base de avisar al usuario;
queda como pregunta abierta (§8 P4).

### H4 — Federación demostrada con ids locales coincidentes

Se cargó **el mismo fichero dos veces** (peor caso: ids idénticos). Resultado:
modelos con `modelIndex` 0 y 1, selección del muro devuelve `expressId` 37 **y**
`modelIndex` 0, el tipo y las propiedades se resuelven contra el store correcto,
y el aviso de «el mismo expressId existe en otro modelo» se dispara. Esto cubre
el criterio de salida del §12 (carga federada) y el TC-002.

### H5 — Propiedades sin `@ifc-lite/query`

`extractPropertiesOnDemand(store, expressId)` devuelve los psets con nombre y
valores. Probado sobre el muro:

```
PSET_WALLCOMMON  ·  FireRating = REI 120  ·  IsExternal = true  ·  ThermalTransmittance = 0.28
```

El índice de tipos (`store.entityIndex.byType`) se invierte a expressId → tipo
**bajo demanda**, al seleccionar, no en cada carga. En un modelo grande hay que
medir el coste de memoria de ese `Map` (del orden de 100.000 entradas).

### H6 — Georreferenciación: existe, pero el EPSG no es un campo

`extractGeoreferencingOnDemand(store)` devuelve `hasGeoreference`,
`mapConversion` (eastings, northings, orthogonalHeight, escala, rotación) y
`projectedCRS` (nombre, datum, uso, unidad). Probado con el fixture: detecta
`ETRS89 / UTM zone 29N`, `Origen del mapa = 539000, 4776000, 120`, origen
`mapConversion`.

Dos avisos importantes para la Fase 3:

1. **No hay campo de código EPSG**: el código sólo aparece dentro del nombre o
   la descripción del CRS. El spike lo extrae con una expresión regular
   (`EPSG:25829`) — es exactamente el dato que hay que alimentar a Proj4js.
   Depender de una cadena de texto es frágil: hay que asumirlo y probarlo.
2. `GeoreferenceInfo` **no incluye latitud/longitud** de `IfcSite`
   (`RefLatitude`/`RefLongitude`), sólo un `source: 'siteLocation'`. Para
   TC-009/TC-010 hará falta leer esas coordenadas aparte.

Ayudas disponibles en el paquete: `transformToWorld`, `transformToLocal`,
`computeTransformMatrix`, `computeAngleToGridNorth`.

### H7 — COOP/COEP y aislamiento de origen

Con `Cross-Origin-Opener-Policy: same-origin` y
`Cross-Origin-Embedder-Policy: credentialless` en `vite.config.ts`
(dev y preview) y en `vercel.json`: `crossOriginIsolated === true` y
`SharedArrayBuffer` disponible en Chromium 152. Funciona igual en dev y en
producción. Sin verificar en Firefox/Safari, y `credentialless` no aísla en
Safari (ver `REVIEW_SPEC_IFCLITE.md` §7).

### H8 — DXF R12: no hay campo de unidades

El exportador produce DXF R12 (`AC1009`) con `$DWGCODEPAGE ANSI_1252`. R12 **no
tiene `$INSUNITS`**: las unidades van en un comentario `999` y en `$EXTMIN/$EXTMAX`.
Un CAD que abra el fichero asumirá su unidad por defecto (normalmente mm). Para
TC-008 hay que decidir y documentar la unidad de dibujo; no basta con «metros»
en un comentario. Es un riesgo real de interoperabilidad.

### H9 — El paquete arrastra lectores de nubes de puntos

En `dist/` aparecen `las`, `laz`, `copc-worker-host`, `e57`, `ply`, `pcd`
(código dividido, se cargan bajo demanda) y `laz-perf.wasm` (214 kB). También
viaja `@ifc-lite/spatial`. Para el §Fase 3 (GIS) es una ventaja; para el peso
inicial, conviene saber que está ahí y que Vite ya lo parte en trozos.

### H10 — Sourcemaps: 17,2 MB

Con `build.sourcemap: true`, los mapas pesan más que todo el código junto. Para
producción: desactivarlos o subirlos aparte.

### H11 — El renderer es sólo WebGPU

`@ifc-lite/renderer` no tiene ruta WebGL. En el equipo probado funciona; en un
equipo sin WebGPU el visor debe degradar (parseo, propiedades, planos y DXF
siguen operativos). El spike implementa esa degradación pero **no la ha
verificado** (§7). TC-013 sigue abierto.

### H12 — Aviso de `npm` sobre scripts de instalación
`npm 11.20.0` avisa de que `esbuild` tiene un `postinstall` no aprobado
(`allowScripts`). El build funcionó igualmente, pero en CI conviene dejarlo
resuelto de forma explícita para no depender de que el binario venga del
paquete opcional.

### H13 — El `.gitignore` no ignora `*.ifc`

`.gitignore` cubre `node_modules/`, `dist/`, `.vercel/`… pero **no** `*.ifc`.
Cargar un modelo de prueba en `spike-fixtures/` puede acabar en un commit con un
fichero grande y, posiblemente, con datos de un cliente. Propuesta:

```gitignore
*.ifc
!spike-fixtures/*.ifc
```

El fixture `spike-fixtures/spike-test.ifc` (3 KB, escrito a mano para este spike)
sí conviene versionarlo: sirve como fixture de regresión.

### H14 — El zoom de rueda tenía un error de escala de 100× (y el tope nominal es la mitad)

El primer control de rueda pasaba `deltaY / 100` a `Camera.zoom`. La librería
normaliza con `ZOOM_SENSITIVITY = 0,001` y topa en `MAX_ZOOM_DELTA = 0,1`: espera
**píxeles**, y con 100 el paso ya está saturado. Cada muesca hacía un **0,1 %** en
vez del 10 % nominal, así que el zoom parecía roto. Corregido pasando píxeles,
normalizando `deltaMode` (Firefox entrega líneas, no píxeles), añadiendo precisión
con Ctrl (×0,25) y dolly puro con Mayús (`fastZoom`).

Medido sobre el renderer real (`Camera.getDistance()`), con el fixture cargado:

| Gesto | Cambio de distancia |
|---|---|
| 1 muesca (100 px) | **+5,00 %** |
| Ctrl + muesca | +1,25 % |
| Mayús + muesca | 0 % (dolly puro: desplaza posición y objetivo a la vez) |
| Muesca hacia dentro | −5,00 % |
| 200 px o 1000 px | +5,00 % (mismo tope) |

El 5 % es **correcto y está documentado en el código** de la librería:
`zoomPerspective()` aplica medio paso como avance de cámara y medio como reducción
de distancia («half dolly + half distance reduction - gives zoom-to-cursor»). El
zoom además ancla el punto bajo el cursor, así que el ratón se queda «pegado» al
sitio que señala.

**Idea no implementada** (requiere trabajo asíncrono): `Camera.zoom()` acepta un
último parámetro `surfacePoint` que hace que al acercar la cámara se aproxime a la
superficie **real** bajo el cursor en vez de al plano del objetivo (#5393). El
punto se obtiene con `pick().worldXYZ`, pero es una lectura de GPU por evento de
rueda y hay que limitarla; se deja para la Fase 1.

## 7. Qué NO se ha probado (huecos honestos)

1. **Un IFC real.** Sólo se ha probado con el fixture propio de 3 KB. El §12 pide
   «un IFC real» y el criterio de salida habla de «un IFC de prueba
   representativo». **Pendiente y bloqueante para cerrar la Fase 0**: hace falta
   un IFC gallego real (o, en su defecto, `AC20-FZK-Haus.ifc`) y los mismos
   números de §5.2 sobre él.
2. **Ausencia de WebGPU** (TC-013) y el portátil de referencia del §12.
3. **IFC2X3, IfcZip y ficheros corruptos** (TC-005).
4. **Apertura del DXF en un CAD** (TC-008): sólo se ha validado la cabecera, la
   codificación y los recuentos de entidades.
5. **Despliegue real en Vercel** (TC-012): `vercel.json` está escrito y las
   cabeceras se han verificado con `vite preview`, pero no hay despliegue.
6. **Ocultar/mostrar por modelo** (TC-003): retirar un modelo funciona; ocultar
   uno entero no está implementado. `RenderOptions.hiddenIds` sólo acepta
   expressIds, igual que `selectedIds`, así que **ocultar un modelo exige
   enumerar todas sus entidades**: es una decisión de diseño para §5, no un
   detalle (P4 de §8).
7. **Parser multihilo** (`WorkerParser`): el spike usa el parseo normal. Aunque
   hay aislamiento de origen, no se ha medido la diferencia.
8. **Modelos grandes** (memoria, tiempos, `Map` de tipos, retirada repetida:
   TC-014). Todo lo medido es de 3 KB.

## 8. Preguntas abiertas para la revisión

- **P1.** Convenciones numéricas de `camera.orbit/pan/zoom`: **resuelto para el
  zoom** (ver H14). No están en la guía, pero sí en el código publicado
  (`constants.js`): `ORBIT_SENSITIVITY = 0,01` rad/px,
  `PAN_SPEED_MULTIPLIER = 0,001 × distancia` y `ZOOM_SENSITIVITY = 0,001` con
  `MAX_ZOOM_DELTA = 0,1`. Las tres esperan **píxeles de ratón**. Queda por
  decidir, contra el visor de referencia, si 5 % por muesca es la sensación
  deseada: el tope lo fija el paquete, no la aplicación.
- **P2.** ¿`loadGeometry()` reasigna `MeshData.modelIndex` o respeta el que trae
  la malla? El spike asigna `modelIndex` a mano y la federación funciona, pero la
  vía incremental (`addMeshes`) debe confirmarse.
- **P3.** ¿Cuál es el contrato de federación de ids cuando un IFC trae
  `expressId` solapados y queremos visibilidad independiente por modelo?
- **P4.** `selectedIds`/`hiddenIds`/`isolatedIds` son conjuntos de expressId sin
  `modelIndex`. ¿Hay una vía pública para acotarlos por modelo, o hay que
  mantener en la aplicación un mapa de ids por modelo?
- **P5.** Forma exacta de `PropertyValue` (unión) y de los psets anidados
  (`IfcComplexProperty`) para construir el panel de propiedades de la Fase 1.
- **P6.** ¿Qué aporta `@ifc-lite/query` sobre los extractores bajo demanda del
  parser? Si no aporta, se elimina de la especificación.
- **P7.** ¿Se asume la dependencia del **texto** del CRS para el EPSG, o se pide
  al proveedor de datos que lo declare de forma explícita?
- **P8.** Unidad de dibujo del DXF (H8): ¿metros, milímetros o configurable?

## 9. Decisión

**Continuar con IFC-Lite.** Lo que el spike tenía que demostrar —carga federada
con ids coincidentes y exportación DXF— está demostrado y con evidencia. Los
paquetes son MPL-2.0 (compatibles con el uso previsto) y las APIs que hacen
falta existen, aunque la documentación esté por detrás del código.

Condiciones para cerrar la Fase 0 y arrancar la Fase 1:

1. Repetir las medidas de §5.2 con **un IFC real** (incluido IFC2X3).
2. Verificar la **ruta sin WebGPU** (TC-013) en el portátil de referencia.
3. Abrir el DXF en un **CAD** y cerrar la decisión de unidades (H8/TC-008).
4. Desplegar en **Vercel** y comprobar cabeceras y WASM (TC-012).
5. Reportar H1 aguas arriba y decidir si el plugin de Vite se queda como deuda
   técnica documentada.
6. Resolver las preguntas P2–P4 antes de fijar el contrato del adaptador de §5.

Las correcciones a la especificación que se derivan de todo esto están en
`REVIEW_SPEC_IFCLITE.md`.
