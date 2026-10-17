# Análisis de Riesgos Técnicos y Limitaciones Críticas

**Documento complementario a:** [`docs/01-especificacion-visor.md`](./01-especificacion-visor.md)  
**Fecha:** 2026-10-17  
**Estado:** Activo / Evaluación previa al Spike (Fase 0)

---

## 1. Resumen ejecutivo

Este documento recoge los riesgos técnicos no evidentes, cuellos de botella de rendimiento y limitaciones de plataforma identificados tras la revisión crítica de la especificación técnica del visor BIM/GIS web. Su propósito es servir de guía de mitigación durante el desarrollo del spike inicial (**Fase 0**) y evitar decisiones de arquitectura que bloqueen el despliegue estático o causen fallos catastróficos en el navegador.

---

## 2. Matriz de riesgos técnicos

| ID | Área | Riesgo | Impacto | Probabilidad | Severidad | Mitigación clave |
|---|---|---|:---:|:---:|:---:|---|
| **RSK-01** | Gráficos 3D | Temblor de vértices por precisión flotante (RTE) | Alto | Alta | **Crítica** | Implementar *Relative-To-Center (RTC)*; centrar mallas en `(0,0,0)`. |
| **RSK-02** | Despliegue | Incompatibilidad de `SharedArrayBuffer` en GitHub Pages | Alto | Alta | **Alta** | Forzar WASM monohilo o inyectar `coi-serviceworker`. |
| **RSK-03** | Memoria | Cierre inesperado de pestaña por Out-Of-Memory (OOM) | Crítico | Media | **Crítica** | Liberar `ArrayBuffers` originales; usar referencias a `File`/Blob. |
| **RSK-04** | Planos CAD | Limitaciones funcionales y de codificación en DXF R12 | Medio | Alta | **Media** | Advertir límites a usuario; diseñar puerto hacia DXF R2000 (AC1015). |
| **RSK-05** | GIS / UX | Sobrecosto de calcular huellas vectoriales en mapa 2D | Medio | Media | **Media** | Acotar MVP a marcador/caja envolvente (OBB) en Leaflet. |
| **RSK-06** | Concurrencia | Congelación de UI por clonado profundo en Web Workers | Alto | Alta | **Alta** | Uso estricto de `Transferable Objects` con semántica zero-copy. |
| **RSK-07** | Hardware | Inaccesibilidad del visor por falta de soporte WebGPU | Crítico | Media | **Alta** | Validar fallback WebGL/Three.js como primer objetivo del Spike. |

---

## 3. Desglose detallado y estrategias de mitigación

### RSK-01: Precisión flotante de 32 bits y temblor de coordenadas (RTE / RTC)

* **Descripción:** Los archivos IFC de obra civil, infraestructuras o proyectos georreferenciados con proyección UTM (p. ej. EPSG:25829 o EPSG:25830) manejan coordenadas absolutas muy elevadas ($X \approx 500.000\text{ m}, Y \approx 4.500.000\text{ m}$).
* **Impacto técnico:** Las GPUs procesan las matrices de transformación y los búferes de vértices en coma flotante de precisión simple (32 bits, `float32`), cuya mantisa solo ofrece unos 7 dígitos decimales significativos. Si los vértices se envían a la GPU con sus coordenadas proyectadas reales, se produce **jitter severo (vibración de geometría), artefactos de z-fighting y deformación de polígonos** al orbitar la cámara.
* **Mitigación requerida:**
  1. No situar nunca los objetos 3D en coordenadas UTM directamente dentro de la escena de WebGPU/WebGL.
  2. Implementar la técnica **Relative-To-Center (RTC)**: calcular un vector de desplazamiento de origen (*pivot/shift vector*) para el modelo o conjunto federado y restar este vector a todos los vértices en el momento de crear los búferes GPU.
  3. La vinculación con GIS aplicará el desplazamiento inverso de forma matemática en el servicio de coordenadas, sin obligar al renderizador 3D a operar en valores absolutos gigantescos.

---

### RSK-02: Aislamiento de origen cruzado (`COOP`/`COEP`) para `SharedArrayBuffer` en WASM

* **Descripción:** Si el parser WASM compilado desde Rust (`@ifc-lite`) utiliza paralelismo multihilo basado en Rayon o `wasm-bindgen-rayon`, requiere acceso obligatorio a `SharedArrayBuffer` y `Atomics`.
* **Impacto técnico:** Por seguridad contra ataques de canal lateral (Spectre), los navegadores modernos exigen que la página se sirva con aislamiento de origen cruzado:
  ```http
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless / require-corp
  ```
  Los hostings estáticos básicos (como GitHub Pages) no admiten cabeceras personalizadas de forma nativa, bloqueando el hilo de ejecución de WASM.
* **Mitigación adoptada y requerida:**
  1. Se ha actualizado la especificación para desplegar en **Vercel**, configurando explícitamente estas cabeceras en `vercel.json`:
     ```json
     {
       "headers": [
         {
           "source": "/(.*)",
           "headers": [
             { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
             { "key": "Cross-Origin-Embedder-Policy", "value": "credentialless" }
           ]
         }
       ]
     }
     ```
  2. En el spike (Fase 0), verificar si `@ifc-lite` opera adecuadamente con `credentialless` (o si requiere `require-corp`, vigilando que los servicios WMS/WMTS externos no se bloqueen por CORS).
  3. Comprobar que el criterio `TC-012` valide el despliegue con las cabeceras activas en la URL de Vercel.

---

### RSK-03: Consumo de memoria heap y riesgo de OOM en federación

* **Descripción:** La sección 7 de la especificación indica: *"Mantener por modelo: buffer original si se necesita exportar, store/parser, geometría..."*.
* **Impacto técnico:** En aplicaciones web de 64 bits, las pestañas del navegador suelen tener un límite práctico de memoria heap de JavaScript/WASM de entre 2 GB y 4 GB. Si un usuario carga tres modelos federados de 70 MB:
  * 3 búferes de archivo crudo en RAM: ~210 MB.
  * Estructuras de parseo y AST en memoria WASM: ~600–1.200 MB.
  * Búferes de vértices e índices duplicados en JS/GPU: ~400–800 MB.
  * Árbol de propiedades y proxies en DOM/JS: ~200 MB.
  El consumo conjunto supera fácilmente los 2 GB, provocando un cuelgue silencioso de la pestaña por **Out-Of-Memory (OOM)**.
* **Mitigación requerida:**
  1. **Prohibido retener el `ArrayBuffer` del archivo IFC completo en memoria:** utilizar la referencia original `File` (obtenida del `<input type="file">` o drag-and-drop) o persistirlo en IndexedDB/Blob URL bajo demanda si se requiere re-exportar.
  2. Tras subir los datos de geometría a los búferes de la GPU (`GPUBuffer`), descartar las copias en memoria RAM del hilo principal salvo que sean estrictamente necesarias para el corte de planos o el cálculo de colisiones.
  3. Implementar un protocolo explícito de liberación (`dispose()` / `destroy()`) que desasigne búferes GPU y libere memoria WASM al retirar un modelo.

---

### RSK-04: Limitaciones estructurales de DXF R12

* **Descripción:** La especificación propone adoptar inicialmente el exportador DXF R12 de `@ifc-lite/drawing-2d`.
* **Impacto técnico:** El estándar DXF R12 data de 1992 y carece de muchas capacidades del CAD moderno:
  * **Colores:** Solo admite los 256 colores de la paleta ACI (*AutoCAD Color Index*), sin soporte de color RGB real (*TrueColor*).
  * **Grosores de línea:** R12 no define propiedad de grosor de línea (*lineweight*) nativa por capa ni por entidad.
  * **Codificación de texto:** Exige codificación Windows-1252. Caracteres habituales en proyectos en español (`á, é, í, ó, ú, ñ, º, ª`) o nomenclaturas técnicas sufrirán corrupción de caracteres (*mojibake*) si el software CAD receptor asume UTF-8 moderno.
  * **Tramados (Hatches):** El soporte de patrones de corte y sombreado en R12 es extremadamente rudimentario.
* **Mitigación requerida:**
  1. Documentar explícitamente estas limitaciones para gestionar las expectativas del usuario.
  2. Proveer siempre la descarga complementaria en formato **SVG**, el cual mantiene colores RGB nativos, tipografías vectoriales y grosores continuos.
  3. Aislar la exportación tras la interfaz `DrawingDocument` para poder incorporar como alternativa `@tarikjabiri/dxf` o un exportador DXF R2000 (AC1015) sin afectar al resto del sistema.

---

### RSK-05: Indefinición del alcance GIS 2D para el MVP

* **Descripción:** La especificación vincula Leaflet con el visor 3D, pero no define con qué geometría se proyecta el edificio sobre el mapa.
* **Impacto técnico:** Extraer una huella de edificio (*footprint*) 2D precisa a partir de una geometría 3D completa (muros, forjados, pilares) requiere calcular el contorno exterior de los elementos de cota cero mediante operaciones booleanas 2D o envolventes convexas, lo cual es costoso computacionalmente y propenso a errores en modelos complejos.
* **Mitigación requerida (acotar alcance para MVP):**
  1. **Nivel 1 (MVP obligatorio):** Representar el modelo en Leaflet únicamente mediante un **marcador geográfico** (pin) situado en el origen del modelo georreferenciado y su **caja envolvente orientada (OBB)** proyectada sobre el plano $XY$.
  2. **Nivel 2 (Fase posterior):** Extracción de huella detallada a partir de los elementos clasificados como `IfcFooting` / `IfcSlab` en el nivel más bajo.

---

### RSK-06: Serialización y comunicación con Web Workers

* **Descripción:** Para evitar bloquear la UI, las tareas pesadas (parseo, generación de dibujos 2D) deben correr en Web Workers.
* **Impacto técnico:** Enviar grandes estructuras de geometría mediante el método estándar `postMessage(data)` realiza una copia por clonado estructurado (*structured clone*). Para mallas con cientos de miles de vértices, este clonado genera picos de asignación de memoria y microcongelaciones de la interfaz de 1 a 3 segundos.
* **Mitigación requerida:**
  1. Prohibir el paso de objetos JSON anidados con arreglos masivos de coordenadas a través de los Workers.
  2. Utilizar obligatoriamente **objetos transferibles (`Transferable`)**:
     ```ts
     // Transferencia sin coste de copia (zero-copy)
     worker.postMessage({ vertexBuffer, indexBuffer }, [
       vertexBuffer.buffer,
       indexBuffer.buffer
     ]);
     ```
  3. Diseñar los contratos de los adaptadores de infraestructura para operar directamente sobre `Float32Array` y `Uint32Array` binarios.

---

### RSK-07: Tasa de penetración de WebGPU y obsolescencia de hardware

* **Descripción:** IFClite utiliza WebGPU como pipeline principal de renderizado.
* **Impacto técnico:** Aunque WebGPU está disponible en las versiones actuales de Chrome/Edge en Windows/macOS, presenta problemas en:
  * Equipos corporativos con drivers de tarjeta gráfica no homologados o desactualizados.
  * Entornos Linux donde WebGPU sigue deshabilitado por defecto en muchos navegadores.
  * Dispositivos móviles y tablets de gama media/baja.
* **Mitigación requerida:**
  1. Si la verificación del spike demuestra que el fallo de inicialización de WebGPU supera el umbral admisible para los usuarios finales, activar de inmediato la decisión arquitectónica de fallback sobre WebGL (usando Three.js u otro motor probado).
  2. Mostrar una pantalla de diagnóstico amigable con detección de soporte de hardware, explicando al usuario el estado de su navegador y GPU si no es posible inicializar el canvas.

---

## 4. Estrategia de independencia tecnológica (Kernel propio)

Para asegurar que el proyecto pueda sustituir `@ifc-lite` por un motor propio o alternativo en el futuro, se deben auditar las siguientes reglas de arquitectura en cada pull request:

```text
[ Capa de UI / Componentes ]
             │ (solo interactúa con tipos propios)
             ▼
[ Capa de Dominio: ModelRecord, CoordinateReference, DrawingDocument ]
             ▲
             │ (implementación concreta intercambiable)
┌────────────┴───────────────────────────────────────┐
│              Capa de Infraestructura               │
├──────────────────────────┬─────────────────────────┤
│ Adaptador IFClite (Hoy)  │ Kernel Propio (Futuro)  │
│ - @ifc-lite/core         │ - Parser Rust/WASM      │
│ - @ifc-lite/drawing-2d   │ - Slicer BVH propio     │
│ - WebGPU nativo IFClite  │ - Motor WebGPU propio   │
└──────────────────────────┴─────────────────────────┘
```

* **Regla de oro:** Ningún componente de la carpeta `src/ui/`, `src/domain/` o `src/application/` puede importar paquetes de `@ifc-lite/*`. Toda interacción debe pasar indefectiblemente por los puertos definidos en `src/application/ports/`.
