# Especificación Técnica Completa: Kernel BIM & CAD Independiente (Rust/WASM)

**Documento:** Propuesta de Arquitectura y Especificación de Implementación  
**Objetivo:** Desarrollar un Kernel BIM/CAD soberano, de alto rendimiento, ejecutado en WebAssembly (WASM) y WebGPU/WebGL, prescindiendo de `@ifc-lite` y de dependencias con licencias virales (100% MIT o Dual MIT/Apache-2.0).  
**Destinatario:** Ingenieros de software y agentes de IA autónomos encargados de la implementación modular de los crates.

---

## 1. Declaración de Independencia y Principios de Diseño

### 1.1 Motivación
El objetivo es eliminar el acoplamiento a librerías de terceros (`@ifc-lite`, `web-ifc`, That Open Engine), controlando al 100% el pipeline de parseo, cálculo geométrico (CSG), extracción de planos 2D y renderizado WebGPU.

### 1.2 Reglas Fundamentales de Licenciamiento
1. **100% Permisivo:** Todo componente, algoritmo o librería base debe estar bajo licencia **MIT** o **Dual MIT / Apache-2.0**.
2. **Prohibición de Contagio:** No se permite ninguna dependencia bajo licencias GPL, LGPL (incluyendo OpenCASCADE/OCE) o AGPL.
3. **Soberanía y Zero-Copy:** El kernel debe operar íntegramente en WebAssembly compilado desde Rust, transfiriendo memoria a la GPU mediante punteros lineales y TypedArrays sin serialización JSON intermedia.

---

## 2. Stack Tecnológico de Nivel Más Bajo (100% MIT / Apache-2.0)

Para garantizar independencia y rendimiento máximo sin reinventar la rueda matemática elemental, el kernel se construye sobre las siguientes primitivas del ecosistema Rust:

| Función | Librería seleccionada | Licencia | Justificación técnica |
|---|---|---|---|
| **Matemática 3D / SIMD** | `glam` | MIT / Apache-2.0 | Tipos alineados en memoria (`Vec3A`, `Mat4`, `Quat`) acelerados por SIMD; soporte para `DVec3` (64 bits) en georreferenciación. |
| **Lexer / Parseo STEP** | `winnow` / `nom` | MIT / Apache-2.0 | Combinadores de parseo zero-copy, streaming de bytes de alto rendimiento y bajo consumo de memoria. |
| **Búsqueda SIMD en memoria** | `memchr` | MIT / Apache-2.0 | Localización ultrarrápida de saltos de línea, delimitadores `#`, comas y paréntesis en ISO 10303-21. |
| **Triangulación 2D** | `earcut` (Rust port) | MIT / ISC | Triangulación de perfiles y polígonos complejos con agujeros en tiempo lineal/subcuadrático. |
| **Aceleración Espacial (BVH)**| `bvh` | MIT / Apache-2.0 | Estructura *Bounding Volume Hierarchy* optimizada para SAH, usada para raycasting y corte de planos 2D. |
| **Operaciones Booleanas (CSG)**| `csgrs` / Algoritmo Half-Edge propio | MIT | Evaluación de huecos (`IfcOpeningElement`) en muros y losas mediante intersección y corte de mallas. |
| **Puente WebAssembly** | `wasm-bindgen` + `js-sys` | MIT / Apache-2.0 | Exposición de buffers binarios a JavaScript y WebGPU sin coste de clonación estructurada. |
| **Renderizado Gráfico** | `wgpu` (en Rust) o WebGPU (en TS) | MIT / Apache-2.0 | API estándar para computación y renderizado en GPU moderna con fallback a WebGL2. |

---

## 3. Arquitectura Modular del Kernel (Workspace de Rust)

El kernel se implementa como un Cargo Workspace desacoplado en `crates/`:

```text
kernel-bim/
├── Cargo.toml
├── crates/
│   ├── step-parser/       # Lexer y parser streaming de archivos ISO 10303-21
│   ├── ifc-schema/        # Generador y tipos fuertemente tipados (IFC2X3, IFC4, IFC4X3)
│   ├── ifc-geometry/      # Evaluación geométrica: perfiles, extrusiones, mallas y CSG
│   ├── spatial-tree/      # Jerarquía espacial (Project/Site/Building/Storey) y propiedades
│   ├── cad-slicer/        # Generador de planos 2D: corte BVH, unión de bucles, DXF y SVG
│   └── wasm-api/          # Fachada pública WASM con buffers lineales para la UI y GPU
└── web-adapter/           # Librería cliente en TypeScript para Vite/WebGPU
```

---

## 4. Especificación Detallada de Cada Módulo

### 4.1 Crate `step-parser`: Lexer y Parser ISO 10303-21

#### Gramática STEP (EBNF Simplificada)
```ebnf
StepFile     ::= "ISO-10303-21;" HeaderSection DataSection "END-ISO-10303-21;"
HeaderSection::= "HEADER;" { HeaderEntity } "ENDSEC;"
DataSection  ::= "DATA" [ "(" ParameterList ")" ] ";" { DataEntity } "ENDSEC;"
DataEntity   ::= EntityId "=" TypeName "(" [ ParameterList ] ")" ";"
EntityId     ::= "#" [0-9]+
TypeName     ::= [A-Z0-9_]+
Parameter    ::= EntityId | StringLiteral | RealLiteral | IntegerLiteral | EnumLiteral | List | "$" | "*"
List         ::= "(" [ Parameter { "," Parameter } ] ")"
```

#### Estructura de Datos Zero-Copy
```rust
pub struct RawEntity<'a> {
    pub id: u32,
    pub type_name: &'a str,
    pub raw_params: &'a [u8], // Slice sin procesar hasta que se requiera evaluar
}

pub struct StepIndex<'a> {
    pub entities: Vec<RawEntity<'a>>,
    pub id_to_index: Vec<Option<u32>>, // Búsqueda O(1) directa por Express ID
}
```

#### Algoritmo de Decodificación de Cadenas IFC
Debe decodificar secuencias de escape estándar:
1. `\X2\00E1\X0\` -> Decodificación UTF-16 Hex (ej. `á`).
2. `\X4\000000E1\X0\` -> Decodificación UTF-32 Hex.
3. `\S\X` -> Caracteres especiales ISO-8859.
4. `\''` -> Comilla simple escapada.

---

### 4.2 Crate `ifc-geometry`: Evaluación Geométrica y Teselado

El motor geométrico traduce las descripciones declarativas de IFC en mallas indexadas triangulares (`IndexedMesh`).

#### Representaciones Geométricas Clave a Soportar:
1. **Perfiles 2D (`IfcProfileDef`):**
   * `IfcRectangleProfileDef`: Extrusión de caja centrada en $XY$.
   * `IfcCircleProfileDef`: Disco parametrizado por radio y aproximación de arcos por segmentos angulares (tolerancia configurable: p. ej. 32 divisiones).
   * `IfcArbitraryClosedProfileDef`: Polígono 2D cerrado arbitrario, incluyendo islas interiores (`IfcArbitraryProfileDefWithVoids`).
2. **Sólidos de Extrusión (`IfcExtrudedAreaSolid`):**
   * Perfil base en plano $z = 0$.
   * Vector de extrusión: dirección normalizada $\vec{D}$ y longitud $L$.
   * Matriz de colocación local derivada de `IfcAxis2Placement3D`:
     $$\mathbf{M}_{local} = \begin{bmatrix} \vec{X} & \vec{Y} & \vec{Z} & \vec{P} \\ 0 & 0 & 0 & 1 \end{bmatrix}$$
3. **Mallas Poligonales y Caras:**
   * `IfcFacetedBrep` / `IfcFaceBasedSurfaceModel`: Caras con listas de vértices 3D.
   * `IfcTriangulatedFaceSet`: Mallas indexadas directas (IFC4).
   * `IfcPolygonalFaceSet`: Caras n-gonales trianguladas mediante `earcut`.
4. **Operaciones Booleanas de Vano/Apertura (`IfcBooleanClippingResult`):**
   * Representa la diferencia booleana $Solid_{muro} \setminus Solid_{apertura}$.
   * **Algoritmo de recorte:**
     1. Prueba de caja envolvente (AABB) entre el operando A (muro) y operando B (hueco de puerta/ventana).
     2. Si intersectan, construir árbol BVH sobre los triángulos del hueco.
     3. Dividir los triángulos del muro que cortan la superficie del hueco.
     4. Clasificar fragmentos interiores y descartarlos; invertir y añadir las tapas de intersección del operando B.
     5. Re-teselar caras no triangulares resultantes con `earcut`.

#### Precisión Gráfica y Prevención de Temblor (Relative-To-Center / RTC)
El evaluador debe computar en 64 bits (`f64` / `DVec3`) y restar el centroide del modelo:
$$\vec{V}_{GPU} = (\vec{V}_{mundo} - \vec{Offset}_{modelo}) \quad \text{en } f32$$
El vector `Offset` se envía al shader o se comparte con el subsistema GIS.

---

### 4.3 Formato Binario Interleaved para WebGPU (Zero-Copy)

Para máxima eficiencia de renderizado e interoperabilidad con WebGPU, los datos teselados se estructuran en búferes planos contiguos:

#### Búfer de Vértices (Intercalado)
Cada vértice ocupa 32 bytes (8 palabras `f32` / `u32`):
```text
Offset  Tipo   Descripción
0..11   f32x3  Posición local (X, Y, Z) relativa a RTC
12..23  f32x3  Vector normal de superficie (Nx, Ny, Nz)
24..27  u32    Express ID de la entidad IFC (para selección por GPU picking)
28..31  u32    Model ID (para soporte de múltiples modelos federados)
```

#### Búfer de Índices
* Arreglo contiguo de enteros `Uint32` para primitivas de triángulos (`TriangleList`).

---

### 4.4 Crate `cad-slicer`: Extracción de Planos 2D y Generación DXF/SVG

Genera secciones y plantas arquitectónicas a partir de la geometría 3D sin depender de software CAD externo.

#### Algoritmo de Corte por Plano:
1. **Definición del plano de corte:** $A x + B y + C z + D = 0$.
2. **Filtrado espacial:** Consulta en el BVH para extraer únicamente los triángulos cuyos vértices cruzan el plano (al menos un vértice con distancia con signo positiva y otro negativa).
3. **Intersección Triángulo-Plano:**
   * La intersección de un triángulo con un plano produce exactamente un segmento de línea $\overline{P_1 P_2}$.
   * Coordenada baricéntrica del corte en cada arista intersectada:
     $$t = \frac{-(A x_1 + B y_1 + C z_1 + D)}{A(x_2 - x_1) + B(y_2 - y_1) + C(z_2 - z_1)}$$
4. **Encadenamiento y Cierre de Bucles (Contour Stitching):**
   * Agrupar segmentos coincidentes en sus extremos (tolerancia $\epsilon \approx 10^{-4}\text{ m}$).
   * Clasificar bucles en exteriores e interiores (islas/huecos).
5. **Generador DXF AC1015 (AutoCAD 2000):**
   * Escribir formato DXF nativo con soporte UTF-8, colores RGB verdaderos y grosores de línea (`LINEWEIGHT`):
     * Capa `IFC-CUT`: polilíneas gruesas (`LWPOLYLINE`) cerradas con sombreado (`HATCH`).
     * Capa `IFC-PROJECTION`: líneas proyectadas por debajo del plano de corte con trazo más fino.

---

### 4.5 Crate `spatial-tree`: Jerarquía y Propiedades

Mantiene en memoria el grafo relacional sin recorrer todo el archivo:
1. **Estructura espacial:**
   `IfcProject` $\rightarrow$ `IfcSite` $\rightarrow$ `IfcBuilding` $\rightarrow$ `IfcBuildingStorey` $\rightarrow$ `Elements`.
2. **Tablas de Inversas:**
   * Mapear en tiempo de carga `IfcRelContainedInSpatialStructure` y `IfcRelAggregates` en un arreglo lineal `parent[express_id]` y `children[express_id]`.
3. **Indexación de Property Sets (`IfcPropertySet`):**
   * Mapeo rápido de `IfcRelDefinesByProperties` para resolver atributos (`Name`, `GlobalId`) y `IfcPropertySingleValue` en consultas $O(1)$.

---

## 5. Interfaz WASM / TypeScript (API Contract)

La fachada compilada a WebAssembly expone una API limpia en JavaScript:

```typescript
export interface BimEngine {
  /** Carga y parsea un buffer binario IFC en memoria WASM */
  loadModel(modelId: string, ifcBuffer: Uint8Array): ModelHandle;
  
  /** Genera la geometría para el modelo cargado con precisión RTC */
  tessellateModel(handle: ModelHandle): GeometryData;
  
  /** Genera una sección 2D según una cota Z o plano arbitrario */
  generateSection(handle: ModelHandle, plane: [number, number, number, number]): SectionResult;
  
  /** Consulta el árbol de propiedades de un elemento */
  getElementProperties(handle: ModelHandle, expressId: number): ElementProperties;
  
  /** Libera la memoria WASM asignada al modelo */
  unloadModel(handle: ModelHandle): void;
}

export interface GeometryData {
  vertexBufferPtr: number; // Puntero a memoria lineal WASM
  vertexBufferSize: number;
  indexBufferPtr: number;
  indexBufferSize: number;
  indexCount: number;
  rtcOffset: [number, number, number]; // Vector de desplazamiento
}

export interface SectionResult {
  svgContent: string;
  dxfBlob: Uint8Array;
}
```

---

## 6. Plan de Implementación Autónoma por Fases (Instrucciones para IA)

Para que un agente de IA o desarrollador pueda construir este kernel paso a paso sin bloqueos, debe seguir esta secuencia estricta:

```
[M1: STEP Lexer] ──▶ [M2: Schema & Tree] ──▶ [M3: Extrusión 3D] ──▶ [M4: Booleano CSG] ──▶ [M5: Slicer 2D] ──▶ [M6: WebGPU Bridge]
```

### Hito M1: Parseo STEP Base y Tokenizador Zero-Copy
* **Entregable:** Crate `step-parser` con pruebas unitarias sobre un fragmento ISO 10303-21.
* **Criterio de éxito:** Leer un archivo de 50 MB en menos de 300 ms en nativo / 800 ms en WASM, indexando los punteros de todas las entidades `#ID`.

### Hito M2: Grafo Relacional y Propiedades
* **Entregable:** Crate `spatial-tree`.
* **Criterio de éxito:** Resolver el árbol jerárquico completo de `IfcBuildingStorey` y extraer nombre, clase y GlobalId de cada elemento.

### Hito M3: Generación de Geometría Básica (Extrusiones y Caras)
* **Entregable:** Crate `ifc-geometry` básico.
* **Criterio de éxito:** Renderizar pilares, vigas y losas simples (`IfcExtrudedAreaSolid` con perfiles rectangulares y circulares).

### Hito M4: Operaciones Booleanas (Vanos en Muros)
* **Entregable:** Integración de CSG para `IfcBooleanClippingResult`.
* **Criterio de éxito:** Muros con aperturas reales para puertas y ventanas, sin solapamiento de mallas.

### Hito M5: Generador de Planos 2D y DXF AC1015
* **Entregable:** Crate `cad-slicer`.
* **Criterio de éxito:** Cortar el modelo a $Z = 1.20\text{ m}$ de una planta dada, generar SVG interactivo y DXF importable en LibreCAD/AutoCAD con capas diferenciadas.

### Hito M6: Fachada WASM y Renderizador WebGPU
* **Entregable:** Crate `wasm-api` y adaptador cliente en TypeScript/Vite.
* **Criterio de éxito:** Cargar y visualizar un modelo federado en el navegador a 60 FPS con selección por clic basada en el búfer de Express IDs.

---

## 7. Conclusión y Viabilidad

Este diseño proporciona **independencia absoluta**:
1. No depende de repositorios externos que puedan cambiar de licencia o discontinuarse.
2. Cumple estrictamente con la licencia **MIT**, protegiendo el software contra restricciones legales o comerciales.
3. Supera a las soluciones actuales al integrar desde el primer día: **RTC nativo para evitar jittering**, **DXF moderno (AC1015)** y **arquitectura zero-copy para WebGPU**.
