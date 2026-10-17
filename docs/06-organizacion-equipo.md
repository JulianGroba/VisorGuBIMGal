# Plan de Trabajo Paralelo para Equipo de +10 Desarrolladores

**Documento:** Distribución de Tareas, Contratos de Interfaz y Gobernanza Técnica  
**Proyecto:** Visor BIM/GIS & Kernel Soberano (Rust/WASM + WebGPU/TypeScript)  
**Fecha:** 2026-10-17  
**Objetivo:** Permitir el trabajo simultáneo de más de 10 desarrolladores con cero conflictos de fusión (*zero merge conflicts*), dependencias desacopladas mediante contratos y progreso paralelo guiado por pruebas.

---

## 1. Principio Fundamental: Desarrollo Basado en Contratos (API-First)

Para que 10–12 ingenieros trabajen al mismo tiempo sin bloquearse:
1. **Los límites de módulo son inmutables:** Cada paquete (`crate` en Rust o directorio en TypeScript) tiene un contrato público (`trait` o `interface`). Nadie programa contra la implementación interna de otro compañero, sino contra su interfaz y mocks tipados.
2. **Propiedad de código clara (Code Ownership):** Cada desarrollador es responsable exclusivo de su rama y módulo. Los cambios en interfaces públicas requieren un RFC breve o aprobación del equipo.
3. **Mocks y TDD:** El equipo de frontend no espera a que el kernel de Rust esté terminado; utiliza adaptadores simulados (*mocks*) con geometría precargada desde el primer día.

---

## 2. Mapa de Squads y Asignación Individual (+10 Devs)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        COORDINACIÓN GENERAL                            │
├───────────────────┬───────────────────┬────────────────────────────────┤
│  SQUAD 1: KERNEL  │  SQUAD 2: CAD 2D  │   SQUAD 3: GRÁFICOS Y BRIDGE   │
│  (Rust / WASM)    │  (Slicer & DXF)   │   (WebGPU / Memoria WASM)      │
│  Dev 01, 02, 03, 04│  Dev 05, 06       │   Dev 07, 08                   │
├───────────────────┴───────────────────┴────────────────────────────────┤
│  SQUAD 4: FRONTEND, GIS Y FEDERACIÓN  │  SQUAD 5: QA, CI/CD Y FIXTURES │
│  Dev 09, 10, 11                       │  Dev 12                        │
└───────────────────────────────────────┴────────────────────────────────┘
```

---

### SQUAD 1: Core del Kernel BIM (Rust)

#### **DEV 01: Lead Lexer & Parser STEP ISO 10303-21**
* **Ubicación exclusiva:** `crates/step-parser/`
* **Misión:** Desarrollar el parser de streaming de bytes de alto rendimiento con `winnow` y `memchr`.
* **Entregables:**
  - Tokenizador de entidades `#ID=TYPE(PARAMS);`.
  - Decodificador zero-copy de caracteres escapados (`\X2\`, `\X4\`, `\S\`).
  - Creación del índice directo `StepIndex` para resolución $O(1)$ por Express ID.
* **Contrato público:**
  ```rust
  pub trait StepParser {
      fn parse_index<'a>(&self, bytes: &'a [u8]) -> Result<StepIndex<'a>, StepError>;
      fn decode_string(&self, raw: &str) -> String;
  }
  ```
* **Dependencias:** Ninguna (módulo base).

---

#### **DEV 02: Grafo Relacional, Propiedades y Árbol Espacial**
* **Ubicación exclusiva:** `crates/spatial-tree/` y `crates/ifc-schema/`
* **Misión:** Reconstruir la jerarquía espacial y resolver los Property Sets (`IfcPropertySet`).
* **Entregables:**
  - Indexación de `IfcRelAggregates` y `IfcRelContainedInSpatialStructure`.
  - Construcción del árbol `Project -> Site -> Building -> Storey -> Elementos`.
  - Extracción de propiedades (`Name`, `GlobalId`, `Tag`, cantidades `IfcElementQuantity`).
* **Contrato público:**
  ```rust
  pub trait SpatialHierarchy {
      fn build_tree(&self, index: &StepIndex) -> SpatialNode;
      fn get_element_properties(&self, id: u32) -> Option<ElementProperties>;
  }
  ```
* **Mock para trabajar:** Puede consumir un `StepIndex` sintético o estático.

---

#### **DEV 03: Motor de Extrusión Geométrica y Perfiles 3D**
* **Ubicación exclusiva:** `crates/ifc-geometry/src/extrusions/`
* **Misión:** Convertir perfiles 2D en prismas y mallas extruidas con precisión RTC.
* **Entregables:**
  - Evaluador de `IfcRectangleProfileDef`, `IfcCircleProfileDef` e `IfcArbitraryClosedProfileDef`.
  - Extrusión de `IfcExtrudedAreaSolid` a lo largo de un vector de dirección con matriz local `IfcAxis2Placement3D`.
  - Sustracción de origen Relative-To-Center (RTC) para evitar temblor GPU.
* **Contrato público:**
  ```rust
  pub trait GeometryTessellator {
      fn tessellate_extrusion(&self, entity: &RawEntity, rtc_offset: DVec3) -> Result<IndexedMesh, GeoError>;
  }
  ```

---

#### **DEV 04: Motor de Operaciones Booleanas (CSG) para Huecos y Vanos**
* **Ubicación exclusiva:** `crates/ifc-geometry/src/csg/`
* **Misión:** Resolver aperturas de puertas y ventanas (`IfcOpeningElement` en `IfcBooleanClippingResult`).
* **Entregables:**
  - Intersección de mallas acelerada por BVH para localizar triángulos solapados entre muro y hueco.
  - Corte de triángulos y re-teselado de caras resultantes con `earcut`.
  - Fusión de normales y eliminación de caras coplanares redundantes.
* **Contrato público:**
  ```rust
  pub trait CsgEngine {
      fn boolean_difference(&self, solid_a: &IndexedMesh, solid_b: &IndexedMesh) -> Result<IndexedMesh, CsgError>;
  }
  ```

---

### SQUAD 2: Motor CAD 2D y Planos Vectoriales

#### **DEV 05: Slicer 2D e Intersección Malla-Plano**
* **Ubicación exclusiva:** `crates/cad-slicer/src/slicer/`
* **Misión:** Cortar la geometría 3D con un plano arbitrario o de planta a cota $Z$.
* **Entregables:**
  - Consulta rápida de triángulos intersectados mediante el árbol `bvh`.
  - Algoritmo de intersección triángulo-plano produciendo segmentos de línea.
  - Algoritmo de encadenamiento de contornos (*contour stitching*) para generar polilíneas 2D cerradas.
* **Contrato público:**
  ```rust
  pub trait MeshSlicer {
      fn slice_mesh(&self, mesh: &IndexedMesh, plane: Plane) -> Vec<Polyline2D>;
  }
  ```

---

#### **DEV 06: Generador de Exportación DXF AC1015 (R2000) y SVG**
* **Ubicación exclusiva:** `crates/cad-slicer/src/exporter/`
* **Misión:** Escribir archivos vectoriales CAD e interactivos para descarga directa.
* **Entregables:**
  - Serializador DXF nativo formato AC1015 (AutoCAD 2000) con capas (`IFC-CUT`, `IFC-PROJECTION`), TrueColor RGB, UTF-8 y tramas (`HATCH`).
  - Serializador SVG con estilos CSS y metadatos de entidades.
* **Contrato público:**
  ```rust
  pub trait DrawingExporter {
      fn export_dxf(&self, drawing: &DrawingDocument) -> Vec<u8>;
      fn export_svg(&self, drawing: &DrawingDocument) -> String;
  }
  ```

---

### SQUAD 3: Gráficos 3D, WebGPU y Puente WASM

#### **DEV 07: Puente WASM y Transferencia Zero-Copy**
* **Ubicación exclusiva:** `crates/wasm-api/` y `src/infrastructure/wasm-bridge/`
* **Misión:** Conectar el runtime de Rust con el navegador sin sobrecoste de clonación.
* **Entregables:**
  - Exportación de punteros a la memoria lineal de WebAssembly (`Float32Array` y `Uint32Array`).
  - Web Worker en TypeScript para procesar modelos en segundo plano mediante `Transferable Objects`.
  - Ciclo de vida y liberación de memoria (`free_mesh_buffer`).
* **Contrato TypeScript:**
  ```typescript
  export interface WasmBridgePort {
    loadModel(id: string, buffer: ArrayBuffer): Promise<ModelHandle>;
    getGeometryBuffers(handle: ModelHandle): Promise<SharedGpuBuffers>;
  }
  ```

---

#### **DEV 08: Pipeline de Renderizado WebGPU e Instanciación**
* **Ubicación exclusiva:** `src/ui/viewer/` (shaders y pipeline WebGPU)
* **Misión:** Dibujar la geometría masiva a 60 FPS con selección por clic.
* **Entregables:**
  - Shaders WGSL para iluminación Diffuse/Specular y compensación de offset RTC.
  - Buffer de selección en GPU (Picking Buffer por `express_id` y `model_id` al hacer clic).
  - Detección de capacidades WebGPU y adaptador de contingencia WebGL (Three.js).
* **Contrato UI:**
  ```typescript
  export interface Viewer3DPort {
    mount(canvas: HTMLCanvasElement): void;
    renderModel(modelId: string, buffers: SharedGpuBuffers): void;
    onElementClick(callback: (ref: ElementRef | null) => void): void;
  }
  ```

---

### SQUAD 4: Aplicación Frontend, GIS y Federación

#### **DEV 09: Gestor de Federación de Modelos y Estado de Dominio**
* **Ubicación exclusiva:** `src/domain/` y `src/application/use-cases/`
* **Misión:** Gestionar múltiples modelos simultáneos sin colisiones de identificadores.
* **Entregables:**
  - Estado reactivo para visibilidad individual, aislamiento y colores por modelo.
  - Claves compuestas `modelId + expressId`.
  - Casos de uso de la aplicación: `LoadModelUseCase`, `ToggleVisibilityUseCase`, `SelectElementUseCase`.

---

#### **DEV 10: Integración GIS 2D (Leaflet) y Transformación de Coordenadas**
* **Ubicación exclusiva:** `src/infrastructure/gis-leaflet/` y `src/domain/coordinates/`
* **Misión:** Mostrar la geolocalización del proyecto y vincular mapa 2D con la escena 3D.
* **Entregables:**
  - Integración de Leaflet con capas configurables WMS/WMTS.
  - Cálculo de matriz de transformación `localToMap` utilizando `proj4js` (EPSG:25829, 25830, 4326).
  - Representación del modelo mediante marcador y caja envolvente orientada (OBB).

---

#### **DEV 11: Sistema de UI, Paneles, Árbol Espacial y Propiedades**
* **Ubicación exclusiva:** `src/ui/panels/` y `src/ui/components/`
* **Misión:** Crear la interfaz de usuario moderna, fluida y accesible.
* **Entregables:**
  - Árbol espacial virtualizado para soportar más de 50.000 nodos sin degradar el DOM.
  - Panel inspector de propiedades tabulares (`IfcPropertySet`).
  - Barra de herramientas: control de capas, planos de sección y botón de exportación DXF/SVG.

---

### SQUAD 5: Calidad, CI/CD y Automatización

#### **DEV 12: Infraestructura de CI/CD, Benchmarking y Fixtures**
* **Ubicación exclusiva:** `.github/workflows/`, `tests/fixtures/`, `vercel.json`
* **Misión:** Garantizar que ningún commit rompa el build ni la compatibilidad.
* **Entregables:**
  - Pipeline de GitHub Actions: linting, `cargo test`, `vitest`, typecheck y despliegue continuo en Vercel.
  - Configuración de cabeceras COOP/COEP en `vercel.json`.
  - Suite de pruebas E2E en Playwright sobre navegadores reales con y sin WebGPU.
  - Colección de archivos `.ifc` de prueba pequeños, medianos y con georreferenciación real.

---

## 3. Matriz de Dependencias y Ruta Crítica

| Desarrollador | Depende directamente de | Puede avanzar en paralelo usando |
|---|---|---|
| **Dev 01 (STEP Parser)** | *Ninguno* | Archivos de texto ISO 10303-21 en bruto. |
| **Dev 02 (Árbol Espacial)** | Dev 01 | Mock de `StepIndex` precompilado en memoria. |
| **Dev 03 (Extrusión 3D)** | Dev 01 | Entidades `IfcExtrudedAreaSolid` creadas sintéticamente. |
| **Dev 04 (CSG / Huecos)** | Dev 03 | Mallas de prueba de cajas y cilindros en memoria. |
| **Dev 05 (Slicer 2D)** | Dev 03 | Mallas OBJ/STL básicas sin esperar al parser IFC. |
| **Dev 06 (DXF/SVG)** | Dev 05 | Listas de polilíneas sintéticas en 2D. |
| **Dev 07 (WASM Bridge)** | Dev 03 | Malla estática generada por un crate temporal. |
| **Dev 08 (WebGPU)** | Dev 07 | Búferes planos de vértices (`Float32Array`) sintéticos. |
| **Dev 09 (Federación)** | *Ninguno* | Contratos de dominio en TypeScript puro. |
| **Dev 10 (GIS/Leaflet)** | *Ninguno* | Coordenadas y matrices simuladas (`proj4js`). |
| **Dev 11 (UI/Paneles)** | Dev 09 | Estado simulado de Zustand / Reactive Store. |
| **Dev 12 (CI/CD / QA)** | *Ninguno* | Fixtures iniciales y configuración de Vercel/GitHub. |

---

## 4. Flujo de Trabajo en Git para Evitar Conflictos

1. **Estructura de Ramas:**
   - `main`: Código verificado y desplegado en producción en Vercel.
   - `feature/<squad>-<dev-id>-<descripcion>`:
     - Ejemplos: `feature/kernel-dev01-step-lexer`, `feature/ui-dev11-spatial-tree-panel`.
2. **Regla de No Invasión de Directorios:**
   - Las PRs que modifiquen archivos fuera del módulo asignado al desarrollador **serán rechazadas automáticamente** salvo que sean actualizaciones consensuadas de contratos en `src/application/ports/` o `crates/*/src/lib.rs`.
3. **Validación Automática en PR:**
   - Todo commit en rama debe pasar: `cargo test`, `npm run lint`, `npm test` y el check de tipos de TypeScript.
