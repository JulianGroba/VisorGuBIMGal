# Revisión crítica — `SPEC_IFCLITE_BIM_GIS_VIEWER.md`

**Documento revisado:** `SPEC_IFCLITE_BIM_GIS_VIEWER.md`
**Commits revisados:** `6747db6` y `8c245dd` (repo `gubimgalicia/VisorGuBIMGal`, rama `main`)
**Autor de la spec:** Andrés
**Fecha de la revisión:** 2026-10-17 (**§7 añadido tras el commit `8c245dd`**)
**Revisor:** Julián Groba (sesión GuBIM Galicia)
**Método:** lectura línea a línea + contraste de las afirmaciones técnicas contra las fuentes primarias (repo `LTplus-AG/ifc-lite`, documentación en `ifclite.dev`, y la página de la organización `@ifc-lite` en npm).

---

## 0. Veredicto

Es un **documento técnico notable** para ser una propuesta inicial de una sesión colaborativa: el diagnóstico del ecosistema es correcto, la elección de motor está razonada y hay decisiones prudentes que evitan errores clásicos (no dar WebGL por resuelto, no inventar reproyecciones, no mezclar frameworks, no abstraer motores que aún no se usan).

Dicho eso, hay **tres problemas de fondo** y un problema de forma:

1. El proyecto se propone **construir desde cero algo que ya existe** aguas arriba (el visor de IFC-Lite cubre la mayor parte del MVP declarado), sin un ADR que lo justifique.
2. **GitHub Pages no permite `SharedArrayBuffer`**, y la spec no saca ninguna consecuencia de eso.
3. **Licencias**: las dependencias son **MPL-2.0**, y el repo se presenta como **MIT** sin analizarlo.
4. La spec **incumple sus propias reglas SDD**: no hay `FR-###`, no hay trazabilidad FR ↔ TC y hay NFR sin criterio medible.

Clasificación de hallazgos por severidad:

| ID | Severidad | Título |
|---|---|---|
| C1 | **Crítica** → **en revisión** | Aislamiento cross-origin y `SharedArrayBuffer`: bloqueante en GitHub Pages, **parcialmente resuelto con el cambio a Vercel** (ver anexo §7). El conflicto con WMS/terceros sigue abierto |
| C2 | **Crítica** | El “fallback WebGL” no es un adaptador, es un segundo visor; y el MVP no define la experiencia degradada |
| C3 | **Alta** | Dependencia joven, de un solo mantenedor y con rotación de *majors* alta |
| C4 | **Alta** | Licencias: dependencias MPL-2.0 frente a un entregable declarado MIT |
| C5 | **Alta** | No se evalúa “reutilizar antes que reconstruir” el visor upstream |
| C6 | **Alta** | El documento no cumple sus propias reglas de trazabilidad |
| M1–M10 | Media | Contratos duplicados, georreferenciación irreal, seguridad, i18n, gobernanza, fixtures… |

---

## 1. Lo que está bien (y debe conservarse)

- **Elección de motor razonada y verificada.** `@ifc-lite/*` existe y cubre lo que la spec asume: parser Rust/WASM (IFC2X3 / IFC4 / IFC4X3), geometría, renderer WebGPU, `drawing-2d` (SVG + DXF), y paquetes de `query`, `spatial`, `bcf`, `ids`, `clash`, `diff`, `collab`.
- **Las afirmaciones sobre DXF, que son las más fáciles de equivocar, son correctas.** Verificado en la documentación de `@ifc-lite/drawing-2d`:
  - Exporta **DXF ASCII R12 (`AC1009`)**; R12 **no tiene `$INSUNITS`**, así que unidades y CRS van en un comentario `999` → la spec lo dice bien.
  - Declara `$DWGCODEPAGE ANSI_1252` y exige `encodeDxfCp1252()` antes de escribir el fichero; escribir UTF-8 produce *mojibake* → la spec lo advierte explícitamente. Punto alto.
  - Capas `IFC-CUT` / `IFC-PROJECTION` / `IFC-HIDDEN`, nombre de capa según reglas estrictas de R12, y opción `coordinateTransform` para georreferenciar → coincide con lo que la spec planifica (§9.2).
- **Prudencia metodológica correcta:** exigir `SPIKE-REPORT.md` antes de la arquitectura completa (§12 Fase 0), no declarar WebGL como fallback hasta probarlo (§10), no fingir alineación entre modelos sin transformación (§7), separar anotaciones de geometría derivada (§9.3) y pedir liberación de recursos GPU/WASM al retirar modelos (§7).
- **§7 (federación) detecta el riesgo real:** `expressId` **no es único globalmente**. Coincide con cómo lo resuelve IFClite, que usa un **ID global federado** en el renderer (`@ifc-lite/renderer` expone `FederationRegistry` con rangos de IDs por modelo) y devuelve ese ID global en el *picking*.

---

## 2. Hallazgos críticos

### C1 · GitHub Pages no permite `SharedArrayBuffer` → se pierde el parseo multihilo

**Evidencia (documentación oficial de IFClite):**

> Para *multi-threaded parsing with Web Workers* se necesita `SharedArrayBuffer`, y `SharedArrayBuffer` **requiere aislamiento cross-origin**: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`.
> `WorkerParser` “takes a `SharedArrayBuffer` (…), which requires a cross-origin-isolated page”.

**GitHub Pages no permite enviar cabeceras HTTP personalizadas.** Por tanto, en el hosting elegido por la spec (§2 “Hosting | GitHub Pages mediante GitHub Actions”, NFR-02, TC-012):

- `WorkerParser` **no es usable** → el parseo cae al modo **single-thread en el hilo principal**, con riesgo de UI congelada. Esto choca frontalmente con NFR-07 (“la UI debe seguir respondiendo… durante operaciones costosas”).
- `performance.measureUserAgentSpecificMemory()` —la vía real para “detectar… memoria disponible de forma aproximada” (§1)— **también exige aislamiento cross-origin**, y además es solo Chrome. La capacidad prometida no es alcanzable en Pages.
- **Conflicto con el módulo GIS:** activar COEP (`require-corp`) bloquea recursos de terceros que no envíen `Cross-Origin-Resource-Policy`, es decir, **rompe la carga de teselas y servicios WMS/WMTS externos** que la propia spec quiere soportar (§3.1 punto 9, §8.3). El aislamiento que acelera el BIM es el que rompe el mapa. Cabe mitigarlo con `COEP: credentialless` (Chrome/Edge) o servidor *proxy*, pero **nada de eso está analizado**.

**Recomendaciones:**

1. ADR “hosting y aislamiento”: comparar **GitHub Pages (sin SAB, single-thread)** frente a **Netlify / Cloudflare Pages** (permiten fichero `_headers`, así que sí pueden servir COOP/COEP → SAB disponible), con el coste de la dependencia de la plataforma.
2. Si se mantiene Pages, **documentarlo como limitación de rendimiento asumida** y presupuestar tiempos con parseo single-thread.
3. Medir el impacto real en la Fase 0 (tiempo de parseo con y sin SAB sobre el fixture de referencia). Sin ese número, NFR-07 no es verificable.

---

### C2 · El “fallback WebGL” no es un adaptador, es un segundo visor; y la experiencia degradada está sin definir

**Evidencia:**

- `@ifc-lite/renderer` es **WebGPU-only**: “`@ifc-lite/renderer` is WebGPU-only, so it has no built-in WebGL renderer”. La salida documentada es usar las plantillas `threejs`/`babylonjs` (parsing y geometría de IFClite, render de un motor externo).
- Matriz de soporte real de WebGPU: **Chrome 113+, Edge 113+, Firefox 141+, Safari 18+**.

**Dos problemas:**

1. **Se subestima el coste.** El renderer de IFClite no es solo “pintar”: aporta *picking* por GPU, planos de sección, resaltado de selección, *ghosting*, culling por frustum e indexación espacial. Un camino WebGL implica reimplementar todo eso en Three.js/Babylon → **dos caminos de render que mantener**, y la abstracción de puertos no lo resuelve (los contratos del §6 no cubren picking ni geometría de sección). La spec lo plantea como “evaluar si hace falta”; en realidad es una decisión binaria de producto.
2. **El MVP no define qué ocurre sin WebGPU.** TC-013 solo pide “un mensaje sin pantalla en blanco”. Pero sin WebGPU **sí** se puede entregar valor, porque parsing, geometría, propiedades, árbol y `drawing-2d` son **WASM/CPU**:
   - Cargar el IFC y mostrar **propiedades y árbol espacial**.
   - Generar **planos/secciones 2D** y **exportar SVG/DXF**.
   - Mostrar el **mapa GIS** y el registro CRS del modelo.
   Es decir: “sin 3D” no equivale a “sin visor”. Y esto importa mucho para el público objetivo: en el sector AEC/AAPP es habitual trabajar en **escritorio remoto / VDI / Citrix**, donde WebGPU no existe aunque el equipo sea moderno.

**Recomendaciones:**

1. Definir en el MVP la **matriz de capacidades degradadas sin WebGPU** (arriba) y sus TC correspondientes.
2. Decidir el camino WebGL **en la Fase 0**, no en la Fase 5, con criterio de coste/beneficio.
3. Añadir a la matriz de compatibilidad: VDI/escritorio remoto, macOS no-Sequoia, navegadores corporativos gestionados.

---

### C3 · Dependencia joven, de un solo mantenedor y con alta rotación de versiones

**Datos verificados hoy (2026-10-17):**

| Paquete | Versión | Notas |
|---|---|---|
| `@ifc-lite/renderer` | 6.4.0 | Creado 2026-01-12, actualizado 2026-10-14; ~5.176 descargas/semana; licencia MPL-2.0 |
| `@ifc-lite/geometry` | 7.8.1 | Publicado hace 5 días |
| `@ifc-lite/drawing-2d` | 4.2.0 | Publicado hace 5 días |
| `@ifc-lite/parser` | — | IFC2X3 / IFC4 / IFC4X3 |
| Organización npm `@ifc-lite` | **57 paquetes listados** | El README del repo aún dice “36 npm packages” |

Lectura: ~10 meses de vida, **6-7 *majors* en ese tiempo**, un único autor (Louis True / LTplus-AG) y una superficie creciente de paquetes. La spec lista como riesgo “las APIs de IFClite cambian entre versiones”, con la mitigación “fijar versiones; encapsular APIs; ADR y pruebas de contrato”, que es correcta pero **insuficiente para un entregable público**.

Además, la spec **no nombra ninguna versión ni ningún paquete concreto** que vaya a usar el MVP. “Fijar versiones” sin inventario es una intención, no una decisión.

**Recomendaciones:**

1. **Inventario exacto** de paquetes + versiones (tabla en la spec), con `lockfile` en Git.
2. **Política de actualización:** ventana de revisión, quién aprueba, Dependabot/Renovate, y pruebas de contrato del adaptador antes de subir de *major*.
3. **Análisis de coste de salida:** qué se rompe y cuánto cuesta migrar a That Open Engine / `web-ifc` si el proyecto se estanca. La spec descarta estas alternativas sin datos (“son alternativas válidas, pero…”), lo que contradice su propio principio de no prometer capacidades no probadas.
4. **Matriz de criterios ponderada** (madurez, cobertura de esquemas, WebGL, tamaño de bundle, comunidad, licencia, bus factor) antes de comprometerse, firmada como ADR-001.

---

### C4 · Licencias: dependencias MPL-2.0 frente a un entregable declarado MIT

**Evidencia:** en npm, `@ifc-lite/renderer` figura como **MPL-2.0** (autor Louis True). El `README.md` del repo declara **Licencia MIT** para el proyecto.

MPL-2.0 es copyleft **débil y a nivel de fichero**: permite distribuir el software dentro de una obra mayor, pero implica (a) que los ficheros cubiertos siguen siendo MPL-2.0, (b) poner a disposición el **código fuente de los ficheros cubiertos** y (c) conservar avisos. No es un bloqueo (el repo es público, lo que en la práctica satisface la disponibilidad de fuentes), pero **hoy la spec no menciona ni una sola licencia real**: NFR-10 se limita a pedir “comprobar compatibilidad de licencias”.

Riesgo añadido: si finalmente se **reutiliza o bifurca** la app React / el visor de IFClite (ver C5), esos ficheros **heredan MPL-2.0** y la afirmación “el proyecto es MIT” deja de ser exacta.

**Recomendaciones:**

1. Inventario SPDX de dependencias (empezando por el alcance `@ifc-lite/*`).
2. `THIRD-PARTY-NOTICES.md` en el repo, generado en CI.
3. ADR de licencia que diga con precisión: “código propio MIT + dependencias MPL-2.0; el repositorio permanece público, lo que satisface la disponibilidad de las fuentes cubiertas”. Si se bifurca código upstream, revisar la redacción del README.

---

### C5 · No se evalúa “reutilizar antes que reconstruir” (el hallazgo más importante)

**Evidencia:** aguas arriba ya existen, en `@ifc-lite/*`: jerarquía espacial, panel de propiedades, *picking* con identidad federada, planos de sección, generación de plantas/secciones/alzados, export **SVG y DXF**, anotaciones (medición de distancia y área, cuadros de texto, nubes de revisión), **hojas con cajetín, escala, norte y barra de escala**, referencias **DXF/PDF/imagen** con calibración, *graphic overrides* por presets (arquitectónico, MEP, estructural, incendios, monocromo), **BCF**, **IDS**, **clash**, **diff** y un **`@ifc-lite/embed-sdk`** para incrustar el visor vía iframe. Además el repo incluye una **app React completa** (`apps/viewer`) y una plantilla oficial `create-ifc-lite --template react`.

**Los puntos 1 a 8 y 11 de la lista de MVP son, esencialmente, ese visor.**

Escribir desde cero una arquitectura hexagonal (`domain` / `application` / `ports` / `infrastructure` / `ui`, con 8 reglas de dependencia) y reimplementar selección, propiedades, árbol y planos **antes** de aportar el valor diferencial —GIS, CRS por modelo, contexto territorial gallego, marca y UX propias, integración con servicios de la administración— es un riesgo alto de **no entregar nada** con un equipo voluntario y disponibilidad incierta. La propia spec advierte contra la abstracción prematura; aquí la aplica al revés: abstrae lo que ya funciona y reimplementa lo que ya está probado.

**Recomendaciones:**

1. **ADR “construir vs reutilizar”** con estas opciones valoradas: (a) partir de `create-ifc-lite --template react`; (b) bifurcar `apps/viewer`; (c) usar `@ifc-lite/embed-sdk` y construir alrededor; (d) construir desde cero con la arquitectura del §5. Criterios: coste, control, licencia resultante, facilidad de contribución, capacidad de adaptar UX.
2. Si la respuesta es “desde cero”, **escribir por qué** y qué se gana, con estimación de esfuerzo por fase.
3. Acotar el MVP a lo diferencial (GIS/CRS, contexto territorial, exportación georreferenciada, i18n gl/es/en) y declarar explícito qué se hereda del visor upstream.

---

### C6 · El documento no cumple sus propias reglas

La §1 promete “pruebas de aceptación trazables” y la §11 fija convenciones de IDs (`FR-###`, `NFR-###`, `ADR-###`, `TC-###`) y la regla “cada requisito debe tener al menos un criterio de aceptación verificable”. En el propio documento:

| Incumplimiento | Detalle |
|---|---|
| Sin `FR-###` | El MVP de §3.1 es una lista numerada 1-12 sin un solo identificador de requisito funcional. |
| Sin trazabilidad | No existe matriz FR ↔ TC; los TC-001…TC-014 no referencian ningún requisito. |
| NFR sin criterio medible | **NFR-07** (rendimiento) no fija ningún umbral; **NFR-09** (accesibilidad) no nombra estándar ni criterio, y no hay TC que la verifique. |
| TC no verificable | **TC-009** dice “según transformación verificada” **sin tolerancia** definida → no es reproducible ni automatizable. |
| Convención no aplicada al repo | La §11 propone `specs/000-vision.md … 080-deployment.md` + `adr/`, pero el repo tiene **un único fichero raíz** y el `specs.md` borrado estaba **vacío (0 bytes)**. |

**Recomendaciones:**

1. Convertir §3.1 en `FR-001…FR-012` (numerar y no renumerar nunca).
2. Añadir umbrales numéricos: p. ej. NFR-07 “con el fixture de referencia, primer render < N s y UI responsive (nunca bloqueada > 500 ms) en el equipo de referencia”; NFR-09 “WCAG 2.2 AA, acciones principales operables por teclado y verificables con `axe-core` en CI”.
3. TC-009 con tolerancia explícita (“ida y vuelta por `CoordinateService` con error < 1 cm en puntos de control”).
4. Añadir la matriz de trazabilidad FR ↔ NFR ↔ TC.
5. Decidir **una** convención de estructura documental y aplicarla en el repo.

---

## 3. Hallazgos medios

**M1 · Contratos de dominio que duplican lo que ya devuelve la librería.**
`DrawingDocument` / `DrawingLayer` / `DrawingEntity` (§6) reinventan el resultado de `@ifc-lite/drawing-2d`. Con una sola implementación, el puerto debe ser un **adaptador fino**; definir un modelo neutral propio solo se justifica si habrá un segundo productor (la propia spec se contradice con su principio de no abstraer prematuramente).

**M2 · La georreferenciación propuesta es irreal para los IFC que vamos a recibir.**
El flujo (§8.2) cubre IFC con `IfcProjectedCRS` / `IfcMapConversion`. En la práctica, una gran parte de los IFC que manejará un grupo gallego llegan **en coordenadas locales y sin información de mapa**: con la especificación actual, el punto 10 del MVP y NFR-06 quedarían **sin ejercitar**. Falta un flujo de colocación manual (por dos puntos, por coordenadas, por fichero de referencia) con criterios de aceptación, y falta decidir los CRS de referencia —para Galicia lo razonable es **ETRS89 / UTM 29N (`EPSG:25829`)** y, para ficheros históricos, **ED50 (`EPSG:23029`)**.

**M3 · Seguridad del contenido no confiable: no está tratada.**
La documentación de IFClite ilustra la exportación SVG con `document.getElementById('drawing').innerHTML = svg`. Un IFC es **contenido no confiable** (nombres de elementos, valores de propiedades, textos de anotación). Faltan requisitos explícitos: no usar `innerHTML` con datos del modelo, escapar propiedades en el DOM, y **CSP** en el sitio estático. Si el visor va a aceptar ficheros de terceros, esto es requisito, no detalle.

**M4 · Ni idioma ni accesibilidad.**
No hay **i18n (gl / es / en)** en un proyecto de Galicia con vocación pública, ni estándar de accesibilidad con criterio verificable. Del mismo modo, no se define el comportamiento en pantallas pequeñas, cuando el layout previsto (3D + propiedades + planos + mapa) es *desktop-first*.

**M5 · No hay usuarios, casos de uso ni métricas de éxito (§0 ausente).**
Consecuencia directa: las fases parecen arbitrarias. “Comparación entre versiones/modelos” se aparca a la Fase 5, cuando para un ayuntamiento (obra, modificados, as-built) puede ser **el** caso de uso principal. Tampoco hay **deep-linking** (“enviar este enlace con la vista”), casi obligatorio en un visor institucional, ni carga de modelos por URL.

**M6 · Alcance de esquemas IFC sin declarar.**
No se dice qué esquemas son objetivo. `@ifc-lite/parser` cubre IFC2X3 / IFC4 / IFC4X3 (IFC5 va en paquete aparte). Para el sector público español lo razonable es **IFC2X3 + IFC4** como obligatorios, con IFC4X3 como deseable. Debe ser requisito explícito con TC.

**M7 · CI y gobernanza llegan tarde, y la gobernanza no existe.**
El CI se coloca en la **Fase 4**, pero la Fase 0 ya exige verificar el despliegue en Pages: el CI mínimo (typecheck + build + deploy) pertenece a la **Fase 0**. Y no hay nada sobre **roles, mantenedores, protección de rama, CODEOWNERS, CONTRIBUTING ni plantillas de PR/issue**. Esto no es teoría: **el push a `main` del repo devuelve `403 Permission denied`** para la cuenta que está trabajando en él (ver §5). Un proyecto colaborativo sin dueño de permisos definido se bloquea solo.

**M8 · Fixtures y equipo de referencia sin definir.**
La Fase 0 exige medir con IFC reales, pero no dice **cuáles**, con qué **licencia**, ni en qué **equipo de referencia** (GPU/CPU/RAM/SO/navegador). Sin eso, `SPIKE-REPORT.md` no es comparable ni repetible, y las decisiones que dependen de él (WebGPU/WebGL, memoria, SAB) quedan sin base. Candidatos razonables: `AC20-FZK-Haus.ifc` y Duplex del corpus de pruebas de IFClite/IfcOpenShell, más un modelo gallego real con licencia verificada.

**M9 · Nubes de puntos: oportunidad no considerada.**
IFClite soporta nubes de puntos y el trazado de contornos de sección a DXF. Para patrimonio —cascos históricos, edificios protegidos, levantamientos— puede ser un **diferenciador real** del visor gallego. Ni se menciona en el alcance.

**M10 · Exactitud y vigencia de las referencias.**
Muchos enlaces apuntan a `blob/main/...`: con este ritmo de cambios se romperán en semanas. Deben apuntar a **tag o commit fijado** y usar `ifclite.dev/docs`. Detalles concretos: `@tarikjabiri/dxf` vive ahora en **`dxfjs/writer`** (MIT), aunque el enlace funciona; el “36 paquetes” del README ya no coincide con los **57** listados en npm. Y la nomenclatura: la spec escribe “IFClite” mientras el proyecto upstream se llama **IFC-Lite** (rompe búsquedas en un documento que aspira a ser referencia).

---

## 4. Cambios concretos solicitados antes de aprobar la spec

1. **§0 nuevo:** contexto, personas usuarias, casos de uso y 3 métricas de éxito. Sin esto no hay forma de priorizar lo demás.
2. **Trazabilidad real:** MVP como `FR-001…FR-012`, umbrales numéricos en NFR-07 y NFR-09 (WCAG 2.2 AA), tolerancia en TC-009 y matriz FR ↔ NFR ↔ TC. Es aplicar su propio §11.
3. **ADRs que faltan:** motor (matriz ponderada vs That Open Engine / `web-ifc`), licencias (MPL-2.0), *build vs reuse* del visor upstream, **hosting y aislamiento (C1)**, **estrategia WebGPU/WebGL y experiencia degradada (C2)**, y georreferenciación práctica sin CRS (M2).
4. **Inventario de dependencias** con versiones exactas + política de actualización + coste de salida.
5. **CI mínimo y gobernanza en Fase 0:** CODEOWNERS, protección de rama, CONTRIBUTING, plantillas de PR/issue y tabla de roles/permisos.
6. **Requisitos que faltan:** seguridad del contenido no confiable y CSP (M3), i18n gl/es/en y accesibilidad (M4), deep-linking (M5), esquemas IFC objetivo (M6).
7. **Plan de fixtures y equipos de referencia** con licencias declaradas (M8).
8. **Simplificar:** maqueta hexagonal solo donde exista una segunda implementación real; no reescribir `DrawingDocument` si solo hay un productor; decidir si el árbol `specs/` completo se justifica o basta este documento + ADRs.

**Preguntas para el autor (a resolver como issues):**

1. ¿Cuál es el caso de uso que justifica **no** partir del visor upstream?
2. ¿Aceptamos que sin WebGPU no hay 3D y solo hay datos, planos y exportación, o el camino WebGL entra en el MVP?
3. ¿Pages (sin `SharedArrayBuffer`, parseo single-thread) o un host con `_headers` (Netlify/Cloudflare Pages)? ¿Cómo afecta al WMS?
4. ¿Qué IFC reales gallegos tenemos, con qué esquema y con qué CRS? ¿Cuántos traen `IfcMapConversion`?
5. ¿Quién mantiene el repositorio y quién tiene permisos de escritura en la organización?

---

## 5. Contexto del repositorio (no es un problema de la spec, pero condiciona todo)

- El repo `gubimgalicia/VisorGuBIMGal` contiene, en `main`: la especificación (`SPEC_IFCLITE_BIM_GIS_VIEWER.md`, 409 líneas), un `README.md` (§8 de este anexo), un `.gitignore` y una regla para agentes en `.agents/rules/reglas-de-github.md`. Antes hubo un `specs.md` de **0 bytes**.
- En el árbol de trabajo local, pendiente de subir: `LICENSE` (MIT para el código propio) y este informe. **No hay fichero `LICENSE` en el remoto**, aunque el README declara licencia MIT. No hay CI, ni plantillas de contribución, ni protección de rama.
- **El push a `main` falla con `403 Permission denied`** para la cuenta que trabaja en él: la organización no ha concedido permiso de escritura. Cualquier trabajo de revisión o implementación queda bloqueado hasta que se resuelva. Es, precisamente, el hueco de gobernanza señalado en M7. Además, `.agents/rules/reglas-de-github.md` establece que **no se debe hacer push sin consentimiento explícito** del titular, norma que este informe respeta.

---

## 6. Fuentes consultadas

- Repo y documentación de IFC-Lite: `https://github.com/LTplus-AG/ifc-lite`, `https://ifclite.dev/docs/`
  - Quickstart, instalación y paquetes, requisitos de navegador (WebGPU, `SharedArrayBuffer`, aislamiento cross-origin), renderizado/`FederationRegistry`, guía de dibujos 2D y DXF R12 (`exportToDXF`, `encodeDxfCp1252`, `coordinateTransform`).
- Organización `@ifc-lite` en npm (versiones, licencia MPL-2.0 del renderer, número de paquetes).
- MDN / web.dev sobre `SharedArrayBuffer` y aislamiento cross-origin (COOP/COEP).
- `dxfjs/writer` (antes `tarikjabiri/dxf`), licencia MIT.
- Vercel: Fair Use Guidelines, Hobby Plan y Términos de Servicio (uso comercial, titularidad y disponibilidad del plan gratuito).

---

## 7. Anexo · Actualización tras el commit `8c245dd` (hosting: GitHub Pages → Vercel)

El 2026-10-17 a las 11:29, Andrés publicó el commit `8c245dd` (“docs: update deployment platform from GitHub Pages to Vercel”): 8 líneas cambiadas que sustituyen **GitHub Pages por Vercel** y añaden la exigencia de cabeceras de aislamiento (`COOP: same-origin` + `COEP: credentialless` o `require-corp`) configuradas en `vercel.json`. Archivos afectados: cabecera/objetivo, tabla §2 (Hosting), referencia de despliegue, **NFR-02**, Fase 0, Fase 4 (CI/CD) y **TC-012**. No queda ninguna mención a Pages en el documento.

**Efecto sobre los hallazgos previos:**

- **C1 pasa a “en revisión”.** Al permitir Vercel cabeceras HTTP personalizadas, el bloqueo de `SharedArrayBuffer` y de `WorkerParser` **se resuelve**: el parseo multihilo vuelve a estar disponible y `performance.measureUserAgentSpecificMemory()` también (en navegadores que lo soportan y solo en contexto aislado). **Pero el hallazgo no se cierra del todo:**
  1. **`COEP: credentialless` solo está soportado en navegadores Chromium** (Chrome/Edge 96+); **Firefox y Safari no lo implementan**. Con `credentialless`, en Firefox/Safari **no hay aislamiento cross-origin** → sin SAB → parseo single-thread, sin aviso claro al usuario salvo que se programe.
  2. **`COEP: require-corp` sí aísla en todos**, pero **bloquea los recursos de terceros que no envíen `Cross-Origin-Resource-Policy`**: exactamente las teselas y servicios **WMS/WMTS** de la sección §8.3. El conflicto “acelerar el BIM / poder cargar el mapa” sigue abierto y ahora está escrito en una decisión de arquitectura.
  3. **`COOP: same-origin` rompe la interacción con ventanas e iframes de otro origen**, lo que condiciona cualquier integración por iframe (incluido `@ifc-lite/embed-sdk`) y cualquier flujo de autenticación externa futuro.
  Por tanto, NFR-02 exige ahora **una elección explícita** (qué pareja de cabeceras y con qué consecuencias por navegador), no “una u otra”. Debe documentarse por navegador y cubrirse con un caso de prueba; hoy **TC-012 no lo comprueba en Firefox/Safari**.
- **C2 sigue intacto.** El cambio de hosting no afecta a la ausencia de *fallback* WebGL ni a la experiencia degradada sin WebGPU.
- **C3, C4, C5, C6 y M1–M10 siguen intactos.** En particular, el documento continúa sin `FR-###`, sin matriz de trazabilidad y sin ADRs.

**Hallazgos nuevos introducidos por el cambio:**

| ID | Severidad | Hallazgo |
|---|---|---|
| C7 | **Alta** | **Vercel Hobby es solo para uso no comercial.** Los Términos de Servicio y las *Fair Use Guidelines* lo dicen expresamente, e incluyen como uso comercial “recibir pago por crear, actualizar o alojar el sitio”. Un visor para administración pública o desarrollado por un profesional cobrando por ello **no cabe en el plan gratuito**; requeriría Pro/Enterprise o autohospedaje. Además Vercel se reserva el derecho de **desactivar o eliminar despliegues Hobby sin aviso ni motivo**, y el plan se ofrece “a su entera discreción”. Es un riesgo de continuidad del servicio público. |
| C8 | Media | **Dependencia de plataforma propietaria frente al principio de “código abierto” y a NFR-02.** El código sigue siendo abierto, pero la disponibilidad del visor pasa a depender de un tercero y de quién titularice la cuenta. NFR-02 debería exigir portabilidad real: la app debe funcionar igual en un hosting propio (nginx/Caddy también pueden enviar COOP/COEP) o en Netlify/Cloudflare Pages, y documentarlo. |
| C9 | Media | **Titularidad y gobernanza de la cuenta.** No se dice de quién es la cuenta/equipo de Vercel, quién administra los dominios ni qué pasa si esa persona sale del grupo. Es el mismo vacío de M7, agravado porque ahora hay una cuenta de terceros implicada. |
| C10 | Baja | **NFR-01 (privacidad) merece una frase más.** Sigue siendo cierto que los IFC no se envían, pero aparece un proveedor externo que ve metadatos de las peticiones; conviene declararlo y dejar fuera cualquier analítica por defecto. |

**Cambios de redacción solicitados a la spec (además de los del §4):**

1. NFR-02: fijar la pareja elegida (`credentialless` o `require-corp`), su comportamiento en **Chromium/Firefox/Safari**, y la **estrategia de teselas** (proxy same-origin, proveedores que envíen CORP, o mapa base en iframe exento). Exigir un hosting alternativo documentado.
2. TC-012: desdoblar en (a) despliegue con cabeceras correctas y (b) verificación del aislamiento y del parseo multihilo **en los tres motores de navegador**, incluido el comportamiento degradado cuando no hay aislamiento.
3. Nuevo ADR de **hosting, cabeceras y plan contratado**, con coste y titularidad.
4. NFR-01: mencionar explícitamente al proveedor de hosting como tercero y prohibir analítica/telemetría por defecto.

**Conclusión del anexo:** el cambio a Vercel es una **mejora real** —elimina el bloqueo más grave que había en la especificación (C1)— pero traslada el problema del navegador al hosting y añade un riesgo de continuidad y de coste que no está evaluado (C7–C9). La decisión debe cerrarse con un ADR que compare, como mínimo, Vercel Pro, Netlify/Cloudflare Pages y autohospedaje.

---

## 8. Anexo · Revisión del `README.md` añadido en `143bc05`

El 2026-10-17 a las 11:41, Andrés añadió `README.md`, `.gitignore` y `.agents/rules/reglas-de-github.md`. El README (35 líneas) mejora la cara pública del repo, pero conviene ajustar cuatro cosas.

**Lo que aporta y hay que conservar:**

- **Concreta el CRS de referencia:** *“Leaflet (WMS/WMTS) + **Proj4js (EPSG:25829 / UTM 29N a WGS84)**”*. Es un avance directo sobre el hallazgo **M2**, que pedía definir el CRS de trabajo. Debe trasladarse también a la especificación (§8.2), donde hoy `proj4js` aparece solo como sugerencia.
- Hoja de ruta visible, pila tecnológica explícita y enlace correcto a la especificación.

**Ajustes necesarios:**

| # | Ajuste | Motivo |
|---|---|---|
| 1 | Declarar la licencia con precisión y añadir el fichero `LICENSE` | El README dice *“MIT (o la que determine la organización GuBIM Galicia)”*: es una decisión **sin cerrar** y, además, **no existe `LICENSE`** en el repositorio. Ver **C4**: hay dependencias **MPL-2.0**, así que “MIT” aplica al código propio, no a todo el entregable. |
| 2 | Completar la hoja de ruta | Faltan la **Fase 5 (Extensiones)** de §12 y el detalle de que la Fase 0 produce un `SPIKE-REPORT.md` obligatorio. |
| 3 | Marcar las “características principales” como **objetivo**, no como estado | El repositorio no tiene código todavía: presentarlas como capacidades existentes puede inducir a error a quien llegue nuevo (y es el punto que alimenta **C5**). |
| 4 | Referenciar esta revisión y añadir el aviso de permisos | Sin enlace a `REVIEW_SPEC_IFCLITE.md`, el README oculta que la especificación está en revisión y sin aprobar; y sin aviso de permisos, cualquiera que clone descubrirá el `403` al intentar contribuir (**M7**). |

**Sobre `.agents/rules/reglas-de-github.md`:** es una regla para agentes de IA que operen en el repositorio (“no hacer push sin consentimiento”). Es una buena práctica para trabajo asistido —este informe la cumple—, pero conviene corregir las dos erratas (*“hags”* → “hagas”, *“gituhub”* → “github”) y, sobre todo, **complementarla con gobernanza humana**: roles, propietarios de la cuenta y política de PR (M7). Una regla que solo leen los agentes no arregla que hoy nadie pueda subir cambios.

**Sobre el `.gitignore` del remoto:** es correcto pero parcial: no cubre variables de entorno con comodines (`*.local`, `*.key`, `*.pem`), modelos pesados (`*.rvt`, `*.glb`, `*.obj`, `*.dwg`…), entradas de Python (`.venv/`, `__pycache__/`) ni la excepción para *fixtures* con licencia (`!tests/fixtures/**/*.ifc`) que requiere el plan de pruebas de la spec. Conviene una versión que sea la **unión** de ambas propuestas. Además, tal como está **no ignora `*.ifc`**, así que un modelo de prueba puede acabar confirmado por accidente (ver `SPIKE-REPORT.md` H13).

---

## 9. Anexo · Revisión de los tres documentos añadidos en `84c01fd` (2026-10-17)

Andrés ha integrado (PR #1, autoría de `NickNunes26`) tres documentos nuevos:
`RIESGOS.md`, `SPEC_CUSTOM_BIM_KERNEL.md` y
`DISTRIBUCION_TRABAJO_PARALELO_10_DEVS.md`. Este anexo los revisa con la
evidencia ya medida en el spike (`SPIKE-REPORT.md`), no con opiniones.

### 9.1 `RIESGOS.md` — coincide con esta revisión; dos de sus peticiones ya están respondidas con medidas

| Riesgo | Veredicto tras el spike |
|---|---|
| **RSK-01** RTC / temblor de vértices | **Ya está implementado en IFC-Lite**: `@ifc-lite/geometry` exporta `rtc-rebase` y `world-frame`, y `@ifc-lite/renderer` trabaja con un `RelativeToEyeFrame` (`getRelativeToEyeFrame()`). No es una tarea pendiente de la fase IFC-Lite. **Pero sigue sin verificar**: nuestro fixture declara el CRS y deja la geometría en el origen local, así que **no** lo somete a prueba. |
| **RSK-02** COOP/COEP y `credentialless` (pedía verificarlo en el spike) | **Verificado**: con las cabeceras exactas del documento, `crossOriginIsolated === true` y `SharedArrayBuffer` disponible en Chromium 152, tanto en servidor de desarrollo como en `preview`. Matiz que mejora el riesgo: `credentialless` **no** bloquea teselas de terceros sin CORP (las pide sin credenciales), así que es la opción correcta para la Fase 3 — a cambio de que Safari no la soporta y Firefox/Safari se quedan sin aislamiento. |
| **RSK-03** memoria y OOM | De acuerdo, y con un dato del spike que lo refuerza: al retirar un modelo **no se libera nada** (se conservan las mallas porque los planos las necesitan y no se llama a `destroy()`). TC-014 sigue abierto. |
| **RSK-04** límites de DXF R12 | **Confirmado con medidas** (AC1009 + `ANSI_1252`, 20 `LINE` + 2 `POLYLINE`), y con un dato que el documento no recoge: **R12 no tiene `$INSUNITS`**, así que las unidades no se declaran en ninguna cabecera; sólo van en un comentario `999` y en `$EXTMIN`/`$EXTMAX`. Un CAD asumirá su unidad por defecto. Es exactamente el tipo de detalle que hace fallar TC-008. |
| **RSK-05** huella GIS | De acuerdo con acotar a marcador + OBB en el MVP. Añadido: esa OBB ya está accesible por modelo (`getModelBounds()`, `getModelPlacementBounds(modelIndex)`) y la georreferenciación entrega eastings/northings/escala, así que el Nivel 1 es barato. |
| **RSK-06** transferibles en workers | De acuerdo; IFC-Lite ya tesela dentro de un worker (`geometry.worker.js`). |
| **RSK-07** WebGPU | El riesgo es **mayor** de lo que dice el documento: `@ifc-lite/renderer` no tiene ruta WebGL, así que el «fallback Three.js» implica sustituir el renderizador completo. Consecuencia de arquitectura: la geometría debe ser independiente del renderizador (nuestro adaptador ya separa parseo/geometría de render, y `MeshData` es agnóstico). Lo que el spike **no** hizo: probar el camino sin WebGPU, que el documento pedía como «primer objetivo». |

### 9.2 `SPEC_CUSTOM_BIM_KERNEL.md` — buena especificación, premisa que hay que corregir

1. **La premisa técnica no es «TypeScript frente a Rust/WASM».** IFC-Lite **ya es** un kernel Rust/WASM: el build incluye `ifc-lite_bg.wasm` (9,98 MB; el sufijo `_bg.wasm` es la convención de `wasm-bindgen`) y el paquete `@ifc-lite/wasm` 10.4.0 viaja como dependencia. La diferencia real con el kernel propuesto es **propiedad y licencia**, no tecnología. Si el argumento es soberanía, es legítimo y suficiente; si es rendimiento, hay que demostrarlo midiendo lo mismo sobre IFC-Lite (su hito M1 fija 50 MB en <300 ms nativo / <800 ms WASM: es una referencia medible y debería ejecutarse también contra IFC-Lite antes de decidir).
2. **MPL-2.0 no es «contagiosa».** Es copyleft **por fichero**: usar `@ifc-lite/*` como dependencia no obliga a publicar nuestro código bajo MPL. Lo único que obliga es publicar los ficheros de IFC-Lite que modifiquemos. El parche H1 del spike se aplica en tiempo de build sobre el texto del paquete; si se considera una modificación, basta con publicar ese cambio de una línea — y lo recomendable sigue siendo **reportarlo aguas arriba**, que es lo que propone `SPIKE-REPORT.md` §9.
3. **El kernel es complementario, no sustituto inmediato.** La Fase 0 sigue abierta (falta IFC real, apertura del DXF en CAD y despliegue en Vercel) y el §12 prohíbe empezar la arquitectura completa antes de cerrarla. Propuesta: tomar `SPIKE-REPORT.md` §6 como **entrada de requisitos** del kernel — H1 (defecto upstream), H3 (identidad `(modelIndex, expressId)`), H6 (georreferenciación sin campo EPSG), H8 (DXF sin unidades) — y no arrancar los hitos M1–M6 hasta que el kernel sea una decisión ratificada.
4. **Ajustes a la fachada `BimEngine`:** (a) `ElementRef` debe ser el par `{ modelId, expressId }`, que es justo lo que devuelve `pick()` en IFC-Lite, para que el intercambio sea invisible a la UI; (b) `getElementProperties` debe cubrir **cantidades** (`IfcElementQuantity`) y la **herencia del tipo** (`IfcRelDefinesByType`), no sólo psets directos; (c) conviene exponer la versión de esquema y el recuento de entidades, que la aplicación necesita para diagnosticar.
5. **Priorización interna:** el valor diferencial está en M1/M2/M5 (parseo streaming, árbol+propiedades, *slicer* con DXF AC1015, capas `IFC-CUT`/`IFC-PROJECTION` y UTF-8). M6 (renderizador WebGPU propio) es el hito más caro y el de menor ganancia inmediata: IFC-Lite ya resuelve *batching*, picking por GPU, planos de sección, RTE, LOD y presupuestos de residencia de memoria. No reescribir el renderizador sin un motivo funcional.

**Lo que el documento acierta** y conviene conservar: el diagnóstico del RTC, el objetivo de DXF **AC1015** (que es una mejora real sobre el R12 medido) y el búfer intercalado de 32 B con `expressId` + `modelId`, que coincide exactamente con lo que hemos medido en `MeshData` (`expressId`, `modelIndex`, `positions`, `normals`, `indices`, `color`).

### 9.3 `DISTRIBUCION_TRABAJO_PARALELO_10_DEVS.md` — bien planteado, dos fricciones y una idea aprovechable

1. **Secuencia.** Los squads 1–3 dan por hecho que la línea principal es el kernel propio. Choca con el criterio de salida de la Fase 0 y con el coste de que ocho personas construyan contra contratos aún no validados. Propuesta: Dev 09/10/11/12 (dominio, federación, GIS, UI, CI) pueden empezar ya contra los puertos; Dev 01–08 no deberían empezar a codificar hasta cerrar la Fase 0 y ratificar el kernel.
2. **Regla de no invasión.** «Las PRs que toquen ficheros fuera del módulo asignado serán rechazadas automáticamente» es incompatible con el repositorio actual: en la raíz conviven tres especificaciones y una revisión. Propuesta: `CODEOWNERS` por directorio y una carpeta `docs/` con excepción explícita para documentación.
3. **Idea aprovechable, y gratis:** fijar ya `ElementRef = { modelId, expressId }` como tipo compartido. Es lo que devuelve `pick()`, satisface el `Viewer3DPort` propuesto y hace invisible el cambio IFC-Lite ↔ kernel para la UI.
4. **`DEV 12` acierta con Playwright «con y sin WebGPU»**: es justo el hueco que este spike no ha podido cubrir. Chromium permite desactivar WebGPU por *flags*, así que el caso es automatizable.
5. **El fixture que falta, y es el más importante:** un **IFC gallego georreferenciado con la geometría en coordenadas UTM absolutas**. El fixture del spike declara el CRS pero sitúa la geometría en el origen local, de modo que **no** somete a prueba ni el RTC (RSK-01) ni la transformación GIS (TC-009). Sin ese fichero no puede validarse ni IFC-Lite ni el kernel propio.

**Conclusión del anexo:** los tres documentos suben el nivel del repositorio y son, en lo esencial, compatibles con esta revisión. El único punto que conviene reconducir es la **secuencia**: el kernel propio es una línea de I+D legítima y bien especificada, pero no sustituye al cierre de la Fase 0. Primero se demuestra —y se corrigen los defectos que ya conocemos— y después se decide si se compra o se construye. El motivo de licencia, además, está sobredimensionado: MPL-2.0 no obliga a abrir nuestro código.
