# Especificación del visor BIM/GIS web — IFClite

**Estado:** propuesta técnica inicial (SDD)  
**Fecha:** 2026-10-17  
**Objetivo:** visor BIM de código abierto, ejecutado íntegramente en el navegador y desplegable como sitio estático en Vercel (con cabeceras HTTP optimizadas para WASM/WebGPU).

## 1. Visión y principios

Construir una aplicación web para abrir, federar, inspeccionar y visualizar varios IFC, contextualizarlos con información GIS y generar planos vectoriales exportables a DXF. La aplicación no requerirá backend para las funciones principales: los ficheros se procesan localmente y no se subirán a ningún servidor por defecto.

Principios:
- **Specification-Driven Development (SDD):** requisitos y contratos primero; implementación derivada de ellos; pruebas de aceptación trazables.
- **Frontend-only:** build estático, sin API propia, base de datos remota ni autenticación obligatoria.
- **Privacidad por defecto:** los IFC permanecen en el dispositivo. Cualquier futuro intercambio P2P será opt-in y explícito.
- **Adaptadores y límites claros:** BIM, GIS, planos, almacenamiento local y UI no deben depender directamente unos de otros.
- **Degradación controlada:** detectar capacidades del navegador (WebGPU, WebGL, memoria disponible de forma aproximada) y explicar las limitaciones sin bloquear la app.
- **No prometer capacidades no probadas:** verificar cada API de IFClite contra la versión fijada antes de construir encima de ella.

## 2. Decisiones recomendadas

| Área | Decisión inicial | Motivo / condición |
|---|---|---|
| IFC | `@ifc-lite/*` como motor BIM principal | Parseo Rust/WASM, geometría, propiedades, federación y herramientas 2D documentadas. Fijar versiones y validar APIs reales. |
| Render 3D | Renderer de IFClite para la primera prueba | Minimiza adaptadores y permite validar el camino principal. |
| Fallback de render | Evaluar `@ifc-lite` con adaptador Three.js/WebGL si el renderer WebGPU no cubre el parque objetivo | IFClite documenta uso de motores externos; no duplicar el motor hasta demostrar que hace falta. |
| GIS 2D | Leaflet + servicios OGC (WMS/WMTS) | Ligero y suficiente para mapas, capas, extensión, puntos y geometrías de referencia. |
| GIS 3D / globo | CesiumJS como módulo opcional | Para terreno/globo y contexto geoespacial 3D. No cargarlo en la primera pantalla si no se necesita. |
| Coordenadas | Registro explícito de CRS, unidades y transformación por modelo | No asumir que las coordenadas IFC son latitud/longitud ni que todos los modelos comparten origen. |
| Planos 2D | `@ifc-lite/drawing-2d` | Documenta plantas, secciones, alzados, SVG y DXF R12; comprobar calidad y límites con modelos reales. |
| DXF | Exportador DXF de IFClite para dibujos generados; evaluar `@tarikjabiri/dxf` solo para entidades propias adicionales | Evitar mantener dos exportadores para el mismo caso de uso. |
| UI | TypeScript + Vite; framework ligero decidido tras el spike | React es la ruta más directa si se adopta la plantilla React de IFClite. Evitar mezclar frameworks. |
| Estado | Estado de dominio tipado separado del estado visual | Evita que componentes UI sean la fuente de verdad de modelos y coordenadas. |
| Pruebas | Vitest + Playwright; fixtures IFC pequeños y medianos con licencia clara | Contratos, regresión funcional y pruebas de navegador. |
| Hosting | Vercel (estático / SPA) | Despliegue en raíz (`/`), soporte nativo de cabeceras COOP/COEP en `vercel.json` para WASM y vistas previas automáticas en PRs. |

### Referencias técnicas principales

- IFClite: https://github.com/LTplus-AG/ifc-lite
- IFClite Quick Start: https://github.com/LTplus-AG/ifc-lite/blob/main/docs/guide/quickstart.md
- IFClite 2D drawings y DXF: https://github.com/LTplus-AG/ifc-lite/blob/main/docs/guide/drawing-2d.md
- IFClite rendering / WebGPU: https://github.com/LTplus-AG/ifc-lite/blob/main/docs/guide/rendering.md
- IFClite exporting: https://github.com/LTplus-AG/ifc-lite/blob/main/docs/guide/exporting.md
- IFClite installation y límites del navegador: https://github.com/LTplus-AG/ifc-lite/blob/main/docs/guide/installation.md
- That Open Engine / Fragments (alternativa a evaluar, no dependencia inicial): https://thatopen.com/bim-software-open-source/
- `web-ifc` (alternativa de parsing): https://thatopen.github.io/engine_web-ifc/docs/
- `@tarikjabiri/dxf` (exportador DXF TypeScript): https://github.com/dxfjs/writer
- CesiumJS: https://cesium.com/platform/cesiumjs/
- Leaflet: https://leafletjs.com/
- Despliegue en Vercel con Vite: https://vite.dev/guide/static-deploy.html#vercel

## 3. Alcance funcional

### 3.1 MVP — obligatorio

1. Abrir uno o varios ficheros `.ifc` mediante selector y arrastrar/soltar.
2. Mostrar lista de modelos cargados con nombre, estado, visibilidad, color opcional y acción de retirar.
3. Federación visual: varios modelos simultáneos, selección e identificación sin colisiones entre IDs locales.
4. Navegación 3D: órbita, pan, zoom, encuadre de modelo/conjunto y vistas ortogonales básicas.
5. Selección de elemento y panel de propiedades IFC; mostrar tipo, GlobalId, nombre, atributos y propiedades disponibles.
6. Árbol espacial y filtrado básico por clase IFC.
7. Sección interactiva básica y generación de una planta/sección 2D a partir de la geometría.
8. Exportar el dibujo generado a SVG y DXF; descarga local.
9. GIS 2D: mapa base configurable, capas WMS/WMTS cuando CORS y el proveedor lo permitan, y control de visibilidad.
10. Registro geoespacial por modelo: CRS, unidades, transformación/rotación y elevación cuando se conozcan; permitir visualizar el modelo en su contexto GIS solo si existe una transformación válida.
11. Manejo de errores, progreso de carga y cancelación/retirada de modelo cuando sea viable.
12. Funcionar en hosting estático, sin llamadas a backend propio.

### 3.2 Segunda fase

- CesiumJS: globo/terreno 3D, contexto geográfico y visualización de modelos georreferenciados.
- Herramientas de medición y anotación en planos.
- Más opciones de exportación: capas, estilos, escalas, unidades, metadatos CRS y exportación de vistas ortográficas.
- Guardar/restaurar sesión local (lista de modelos, visibilidad, colores, CRS, cámara y configuración) en IndexedDB.
- Importar/exportar configuración de sesión como JSON.
- BCF: visualización y gestión básica de incidencias si la API de IFClite seleccionada cubre el flujo requerido.
- Comparación entre versiones/modelos, aislamiento y filtros avanzados.
- Colaboración P2P con WebRTC y un protocolo de sincronización como Yjs, solo después de definir qué estado se sincroniza. El P2P no es requisito del MVP y no requiere por sí mismo un servidor de aplicación permanente, aunque la señalización inicial puede necesitar un servicio externo o una solución manual.

### 3.3 Fuera de alcance inicial

- Edición completa del contenido IFC.
- Autoría BIM equivalente a un modelador de escritorio.
- Conversión automática y fiable de cualquier CRS sin metadatos suficientes.
- Servidor, cuentas, permisos, base de datos o almacenamiento remoto.
- Prometer rendimiento ilimitado con IFC de gran tamaño.
- Exportación DWG nativa; el formato objetivo es DXF.

## 4. Requisitos no funcionales

- **NFR-01 Privacidad:** los ficheros seleccionados no se envían por red. Verificarlo en pruebas de navegador.
- **NFR-02 Portabilidad y despliegue:** desplegable en Vercel (o hosting estático compatible). Debe permitir configurar cabeceras de aislamiento de origen cruzado (`COOP: same-origin`, `COEP: credentialless` o `require-corp`) para optimizar WASM y multihilo.
- **NFR-03 Compatibilidad:** detectar WebGPU. Probar al menos un navegador con WebGPU y otro sin ella; documentar el fallback real. No declarar WebGL como fallback hasta implementarlo y probarlo.
- **NFR-04 Resiliencia:** un IFC inválido o un fallo de carga no debe cerrar la aplicación ni eliminar los modelos ya cargados.
- **NFR-05 Federación:** los identificadores internos deben ser compuestos por `modelId + expressId`; no asumir que `expressId` es globalmente único.
- **NFR-06 Georreferenciación:** toda transformación entre coordenadas locales y GIS debe ser explícita, reversible y testeable.
- **NFR-07 Rendimiento:** medir en fixtures publicados; no fijar un límite universal antes del spike. Como umbral provisional, la UI debe seguir respondiendo y mostrar progreso durante operaciones costosas.
- **NFR-08 Mantenibilidad:** dependencias fijadas, lockfile en Git, TypeScript estricto, lint, pruebas automatizadas y ADR para decisiones relevantes.
- **NFR-09 Accesibilidad:** acciones principales operables por teclado, etiquetas accesibles y estado de carga/error legible.
- **NFR-10 Licencias:** comprobar compatibilidad de licencias de cada dependencia y de los IFC de prueba antes de redistribuir.

## 5. Arquitectura lógica

```text
src/
  app/                    # arranque, composición, rutas/vistas
  domain/
    models/                # ModelId, ModelRecord, selección, visibilidad
    coordinates/           # CRS, unidades y transformaciones
    drawings/              # tipos neutros de dibujo y metadatos
    session/               # estado de sesión serializable
  application/
    use-cases/              # LoadIfc, RemoveModel, SelectElement, ExportDrawing...
    ports/                  # contratos de los servicios externos
  infrastructure/
    ifclite/                # adaptador parser, store, renderer, drawing-2d
    gis-leaflet/            # adaptador GIS 2D
    gis-cesium/              # adaptador opcional GIS 3D
    storage/                # IndexedDB/local storage
    export/                 # descargas y codificación de DXF/SVG
  ui/
    components/
    panels/
    viewer/
    map/
  workers/                  # tareas CPU que puedan ejecutarse en Worker
  test/
    fixtures/
    unit/
    integration/
    e2e/
```

### Reglas de dependencia

1. `domain` no importa UI, IFClite, Leaflet, Cesium ni APIs del navegador.
2. `application` depende de interfaces/puertos y del dominio, no de implementaciones concretas.
3. `infrastructure` implementa los puertos con IFClite, Leaflet, Cesium, IndexedDB y exportadores.
4. `ui` invoca casos de uso y presenta estado; no parsea IFC directamente.
5. El GIS no debe requerir que el visor BIM use Cesium. El mapa 2D seguirá funcionando de forma independiente.
6. El exportador DXF consume un `DrawingDocument` neutral o el resultado tipado del adaptador IFClite, nunca componentes UI.
7. No exponer tipos internos de IFClite por toda la aplicación: traducirlos a tipos propios en el adaptador.
8. Mantener IFClite como primera implementación del puerto BIM; un motor alternativo solo se incorpora si las pruebas revelan una carencia concreta.

## 6. Contratos de dominio iniciales

```ts
type ModelId = string;

interface ModelRecord {
  id: ModelId;
  fileName: string;
  schema?: string;
  status: "queued" | "loading" | "ready" | "error";
  visible: boolean;
  color?: string;
  units: "m" | "mm" | "unknown";
  coordinateReference?: CoordinateReference;
  errorMessage?: string;
}

interface CoordinateReference {
  crsId?: string;                 // por ejemplo, EPSG:25829 si se ha verificado
  source: "ifc-map-conversion" | "user-defined" | "unknown";
  localToMap?: number[];          // matriz 4x4, convención documentada
  verticalDatum?: string;
  confidence: "verified" | "user-supplied" | "unknown";
}

interface ElementRef {
  modelId: ModelId;
  expressId: number;
  globalId?: string;
}

interface DrawingDocument {
  id: string;
  sourceModels: ModelId[];
  kind: "plan" | "section" | "elevation" | "orthographic";
  units: "m" | "mm";
  crsId?: string;
  layers: DrawingLayer[];
  metadata: Record<string, string>;
}

interface DrawingLayer {
  name: string;
  entities: DrawingEntity[];
}

type DrawingEntity =
  | { kind: "line"; points: [number, number][] }
  | { kind: "polyline"; points: [number, number][]; closed: boolean }
  | { kind: "text"; position: [number, number]; text: string; height: number }
  | { kind: "polygon"; rings: [number, number][][] };
```

Estos contratos son una frontera de diseño inicial, no una afirmación de que IFClite entregue exactamente estos tipos. Los adaptadores deben mapear las APIs reales de la versión fijada.

## 7. Federar varios IFC correctamente

- Mantener un registro por modelo y un contexto de renderizado controlado por el adaptador BIM.
- Asignar un `ModelId` estable durante la sesión; la identidad de elemento será `(ModelId, expressId)`.
- No fusionar físicamente los IFC al cargarlos. La federación visual no debe alterar los archivos fuente.
- Mantener por modelo: buffer original si se necesita exportar, store/parser, geometría, unidades, transformación, estado y errores.
- Aplicar visibilidad y aislamiento por modelo y por elemento.
- Definir explícitamente el comportamiento de encuadre: modelo seleccionado o extensión de todos los modelos visibles.
- Los modelos sin transformación compartida pueden visualizarse en coordenadas locales, pero no se debe fingir que están correctamente alineados.
- Permitir corregir desplazamiento/rotación manualmente como transformación de visualización, sin reescribir el IFC original.
- Liberar recursos GPU/WASM al retirar un modelo, si las APIs lo permiten; verificar fugas con cargas/descargas repetidas.
- Probar IDs repetidos entre dos archivos y GlobalIds ausentes o duplicados.

## 8. Estrategia GIS y georreferenciación

### 8.1 Separar mapa y escena BIM

El MVP usará un mapa Leaflet 2D independiente del canvas BIM. La vinculación entre ambos se realiza a través de un servicio `CoordinateService`, no mediante lógica metida en los componentes.

CesiumJS se añadirá como módulo opcional cuando el caso de uso requiera globo, terreno o navegación 3D. No debe ser obligatorio para abrir y revisar IFC.

### 8.2 CRS

- Leer y conservar la información disponible en `IfcProjectedCRS` / `IfcMapConversion` cuando esté soportada por la versión del parser.
- Si no existe o es incompleta, pedir al usuario CRS y parámetros de transformación; marcar la transformación como suministrada por usuario.
- Distinguir coordenadas IFC locales, coordenadas proyectadas, coordenadas geográficas y altura.
- Documentar eje vertical, unidades, rotación del norte de cuadrícula, escala y orden de ejes.
- No convertir a EPSG:4326 usando una transformación improvisada. Usar una librería de proyecciones mantenida, por ejemplo proj4js, si la app necesita reproyección general.
- Validar transformaciones con puntos de control conocidos y prueba inversa dentro de una tolerancia definida.
- Mostrar una advertencia cuando el IFC no tenga información geográfica suficiente.

### 8.3 Capas

- Soportar URL de servicio WMS/WMTS configurable por el usuario.
- No incrustar claves privadas ni asumir que cualquier servicio externo admite CORS.
- Los mapas base pueden fallar por CORS, política del proveedor, límites de uso o disponibilidad; la app debe informar del fallo y permitir continuar con el modelo.
- No cachear ni redistribuir teselas si las condiciones del proveedor no lo permiten.

## 9. Planos y exportación DXF

### 9.1 Flujo de generación

1. Seleccionar uno o varios modelos y el subconjunto visible que se incluirá.
2. Definir tipo de dibujo: planta a cota, sección por plano, alzado o vista ortográfica.
3. Configurar posición, orientación, profundidad/proyección y líneas ocultas.
4. Generar geometría vectorial en un servicio independiente de la UI.
5. Mostrar vista previa 2D, capas, escala, unidades y advertencias.
6. Exportar a SVG y DXF; el nombre de archivo y metadatos deben indicar tipo de plano y unidades.

### 9.2 DXF

- Primera versión: exportación DXF R12 si el exportador de IFClite cubre las entidades necesarias.
- Separar entidades en capas previsibles: `IFC-CUT`, `IFC-PROJECTION`, `IFC-HIDDEN`, `IFC-HATCH`, `ANNOTATIONS` y capas específicas por categoría cuando la API lo permita.
- Incluir unidades y CRS en metadatos/comentarios cuando el formato elegido no permita representarlos de forma interoperable.
- Para texto no ASCII, respetar la codificación que exija la API de exportación. IFClite documenta codificación Windows-1252 para su DXF R12; no escribir ciegamente UTF-8 si el encabezado declara otra codificación.
- Confirmar que los polígonos de hatch estén cerrados, las unidades sean correctas y los nombres de capa sean válidos.
- No afirmar que un DXF es georreferenciado por el mero hecho de incluir un comentario CRS. La transformación de coordenadas debe haberse aplicado a todas las entidades.
- Probar apertura en al menos dos lectores, por ejemplo LibreCAD y QCAD/AutoCAD cuando estén disponibles.
- Proporcionar SVG como alternativa si la exportación DXF falla.

### 9.3 Criterios geométricos

- Un plano debe respetar unidades, orientación, escala y transformación de coordenadas.
- La sección debe producir líneas de corte diferenciadas de líneas proyectadas y ocultas.
- Los resultados deben ser deterministas para el mismo modelo, versión y configuración.
- Las anotaciones de usuario deben almacenarse separadas de la geometría derivada, para regenerar el dibujo sin perderlas.
- La exportación de un conjunto federado debe conservar el origen de cada entidad en metadatos de la sesión; si el DXF no conserva identidad IFC de forma interoperable, generar un manifiesto lateral JSON opcional.

## 10. WebGPU, memoria y rendimiento

- IFClite usa WebGPU en su renderer principal; la compatibilidad real depende de navegador, sistema operativo, driver y GPU.
- Detectar soporte antes de inicializar el renderer y mostrar diagnóstico útil.
- No dar por hecho que WebGPU existe en todo portátil moderno.
- El fallback WebGL es una decisión explícita de arquitectura y una prueba independiente; no se considerará resuelto solo porque IFClite permita extraer geometría para otros motores.
- La documentación de IFClite indica un límite de memoria WASM de 4 GB y describe alrededor de 100 MB como límite práctico orientativo para IFC en navegador; debe tratarse como orientación, no como garantía. Los límites reales dependen de geometría, navegador y equipo.
- Procesar cargas en cola o con concurrencia limitada para evitar picos de memoria.
- Evitar duplicar buffers grandes sin necesidad; conservar el IFC original solo cuando el flujo lo requiera.
- Usar Web Workers cuando el paquete y el flujo de datos lo permitan; no transferir grandes buffers repetidamente sin medir el coste.
- Medir tiempos de lectura, parseo, geometría, primera imagen, memoria aproximada y exportación en equipos de referencia.
- Probar el cierre de un modelo y la recuperación de memoria, aunque el navegador no garantice liberación inmediata.

## 11. SDD: estructura de especificaciones y flujo de trabajo

Estructura documental propuesta:

```text
specs/
  000-vision.md
  010-functional-requirements.md
  020-architecture.md
  030-ifc-federation.md
  040-gis-coordinate-reference.md
  050-drawings-dxf.md
  060-security-privacy.md
  070-test-strategy.md
  080-deployment.md
  adr/
    ADR-001-ifclite-as-primary-engine.md
    ADR-002-gis-leaflet-and-optional-cesium.md
    ADR-003-dxf-export-strategy.md
```

Proceso:
1. **Especificar:** requisitos identificados (FR/NFR), casos de uso, contratos y criterios de aceptación.
2. **Resolver incertidumbres:** construir spikes pequeños para validar APIs y límites de las dependencias.
3. **Diseñar:** registrar decisiones importantes y alternativas en ADR.
4. **Implementar verticalmente:** una funcionalidad completa de UI a motor y pruebas, en lugar de desarrollar capas aisladas durante mucho tiempo.
5. **Verificar:** pruebas de unidad, integración, E2E y comprobación manual de DXF en CAD.
6. **Actualizar especificaciones:** el código no debe cambiar un contrato público sin actualizar la especificación y las pruebas.
7. **Entregar:** cada PR debe referenciar requisitos, pruebas y limitaciones conocidas.

### Convención de IDs

- Requisitos funcionales: `FR-###`.
- Requisitos no funcionales: `NFR-###`.
- Decisiones: `ADR-###`.
- Casos de prueba: `TC-###`.
- Cada requisito debe tener al menos un criterio de aceptación verificable.

## 12. Plan de implementación

### Fase 0 — Spike de IFClite (primero)

- Crear proyecto mínimo TypeScript + Vite, inicialmente usando la plantilla oficial de IFClite más próxima al objetivo.
- Fijar la versión exacta de los paquetes y guardar lockfile.
- Probar en un portátil de referencia: WebGPU disponible/no disponible, carga de un IFC real, selección, propiedades, navegación y sección.
- Probar dos IFC a la vez, incluidos modelos con IDs locales coincidentes.
- Generar una planta/sección y exportar SVG y DXF.
- Inspeccionar DXF en un CAD; validar unidades, capas, orientación, codificación y geometría.
- Confirmar que el build funciona en Vercel sin problemas de rutas ni cabeceras.
- Resultado obligatorio: `SPIKE-REPORT.md` con versiones, fixture, navegador/GPU, tiempos, fallos, APIs comprobadas y decisión continuar/cambiar.

**Criterio de salida:** no empezar la arquitectura completa hasta demostrar carga federada y exportación DXF con un IFC de prueba representativo.

### Fase 1 — MVP BIM

- Adaptador IFClite.
- Gestor de modelos múltiples y selección federada.
- Panel de propiedades, árbol, filtros, visibilidad y cámara.
- Manejo de errores y liberación de recursos.
- Pruebas unitarias e integración.

### Fase 2 — Planos/DXF

- Secciones y plantas reproducibles.
- Vista previa 2D, capas y opciones de exportación.
- Exportación SVG/DXF y fixtures de regresión.
- Pruebas de interoperabilidad CAD.

### Fase 3 — GIS

- Mapa Leaflet, capas WMS/WMTS.
- Servicio de coordenadas y transformación por modelo.
- Pruebas con IFC georreferenciado, IFC local y datos CRS incompletos.
- CesiumJS opcional solo después de estabilizar el contrato GIS.

### Fase 4 — Robustez y distribución

- Persistencia local de sesiones.
- Accesibilidad, pruebas E2E, rendimiento y diagnóstico.
- CI/CD con lint, typecheck, pruebas, build y despliegue automatizado en Vercel.
- Documentación de límites conocidos y compatibilidad.

### Fase 5 — Extensiones

- BCF/IDS y comparación, si se priorizan.
- Colaboración P2P con alcance y modelo de conflictos definidos.
- Evaluar cache local de representaciones derivadas solo si las licencias, privacidad y consistencia están claras.

## 13. Criterios de aceptación del MVP

- **TC-001:** abrir un IFC válido local y visualizar geometría.
- **TC-002:** abrir dos o más IFC simultáneamente sin colisión de selección entre `expressId` iguales.
- **TC-003:** ocultar, mostrar y retirar cada modelo independientemente.
- **TC-004:** seleccionar un elemento y mostrar sus propiedades asociadas al modelo correcto.
- **TC-005:** un IFC inválido genera un error comprensible y no rompe otros modelos cargados.
- **TC-006:** producir una planta y una sección desde un fixture de prueba.
- **TC-007:** exportar SVG y DXF descargables.
- **TC-008:** verificar DXF en lector CAD: geometría, unidades, capas, líneas ocultas y caracteres.
- **TC-009:** un IFC con CRS válido se coloca según transformación verificada; un IFC sin CRS no se presenta como georreferenciado.
- **TC-010:** mostrar un mapa GIS y una capa de servicio configurable cuando el proveedor lo permita.
- **TC-011:** comprobar en DevTools/red que los IFC locales no se transmiten a terceros.
- **TC-012:** desplegar en Vercel con cabeceras COOP/COEP configuradas y sin fallos de rutas o carga de binarios WASM.
- **TC-013:** detectar ausencia de WebGPU y mostrar un mensaje de compatibilidad sin pantalla en blanco.
- **TC-014:** cargar y retirar repetidamente modelos sin acumulación evidente de recursos ni errores fatales.

## 14. Riesgos y decisiones pendientes

| Riesgo | Mitigación |
|---|---|
| APIs de IFClite cambian entre versiones | Fijar versiones; encapsular APIs; ADR y pruebas de contrato. |
| WebGPU no disponible en parte de los equipos | Spike temprano; diagnóstico y decidir si merece la pena un renderer WebGL alternativo. |
| IFC grandes consumen demasiada memoria | Cargas controladas, medición y límites documentados. |
| Modelos con coordenadas inconsistentes | Transformación explícita por modelo; no alinear automáticamente sin evidencia. |
| DXF no reproduce correctamente un plano complejo | Fixtures CAD, validar hatch/capas/texto y conservar SVG como alternativa. |
| WMS bloqueado por CORS o proveedor | Mostrar error y permitir continuar; documentar servicios compatibles. |
| Licencias o servicios de mapas limitan uso | Revisión de licencia y términos de cada dependencia/servicio. |
| Dependencia excesiva de una librería | Puertos internos y adaptadores; no crear una abstracción genérica prematura para motores que aún no se usan. |

Decisiones que deben resolverse en el spike:
1. ¿La versión fijada de IFClite cubre federación visual y selección con identidad de modelo de la forma requerida?
2. ¿`@ifc-lite/drawing-2d` cubre los planos y entidades DXF que necesita el MVP?
3. ¿Cuál es el rendimiento en los IFC reales objetivo?
4. ¿Es necesario un renderer WebGL alternativo en la primera entrega?
5. ¿Qué fuentes GIS y CRS se usarán realmente en los primeros casos de uso?

## 15. Recomendación final

Empezar con **IFClite + TypeScript/Vite + Leaflet + `@ifc-lite/drawing-2d`**, manteniendo CesiumJS como módulo opcional y sin backend. No incorporar de inicio That Open Engine, `web-ifc` ni un segundo exportador DXF en paralelo: son alternativas válidas, pero añadir varios motores antes de validar IFClite aumenta complejidad y duplicación.

La primera entrega técnica debe ser un spike pequeño que demuestre, en este orden: (1) carga y selección de un IFC, (2) dos IFC federados, (3) generación de una sección, (4) DXF comprobado en CAD y (5) despliegue real en Vercel. Solo después se consolidan los contratos y se implementa el MVP.
