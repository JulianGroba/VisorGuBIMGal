# Documentación · VisorGuBIMGal

Visor BIM/GIS 100 % en el navegador (IFC-Lite + TypeScript + Vite). Este índice
es el único punto de entrada: lee sólo lo que necesites.

## Orden de lectura

| # | Documento | Qué responde | Léelo si… |
|---|---|---|---|
| 01 | [Especificación del visor](01-especificacion-visor.md) | Qué se construye: arquitectura, casos de uso, criterios de aceptación | vas a tocar el producto |
| 02 | [Riesgos](02-riesgos.md) | Qué puede romper y cómo se mitiga (RSK-01…07) | planificas o implementas |
| 03 | [Revisión de la especificación](03-revision-especificacion.md) | Qué está mal en 01 y qué hay que cambiar (C1–C10, M1–M10) | vas a aceptar decisiones de 01 |
| 04 | [Spike de la Fase 0](04-spike-fase-0.md) | Evidencia medida: APIs, tiempos, defectos, huecos pendientes | necesitas hechos, no opiniones |
| 05 | [Kernel propio Rust/WASM](05-kernel-propio-rust-wasm.md) | La línea de I+D alternativa a IFC-Lite | discutes comprar frente a construir |
| 06 | [Organización del equipo](06-organizacion-equipo.md) | Contratos, módulos y reparto entre más de 10 personas | repartes trabajo |
| 07 | [Desarrollo local](07-desarrollo-local.md) | Cómo arrancar, construir y depurar | vas a ejecutar código |

## Estado (2026-10-17)

- Fase 0 **abierta**: demos 1–5 verificadas; faltan IFC real, apertura del DXF en
  CAD, despliegue en Vercel y ruta sin WebGPU. Detalle y decisión en **04 §7 y §9**.
- Decisión vigente: **continuar con IFC-Lite** (04 §9).
- Hoja de ruta por fases: [README](../README.md).

## Otros documentos

| Documento | Contenido |
|---|---|
| [README.md](../README.md) | Presentación, pila tecnológica y hoja de ruta |
| [spike-fixtures/README.md](../spike-fixtures/README.md) | Fixtures IFC de prueba y sus licencias |
| [.agents/rules/reglas-de-github.md](../.agents/rules/reglas-de-github.md) | Reglas de GitHub del equipo (no empujar sin consentimiento) |

## Nombres anteriores

Los documentos se trasladaron a `docs/` al crear este índice. Si un texto cita un
nombre antiguo, corresponde a esta tabla.

| Antes (raíz) | Ahora |
|---|---|
| `SPEC_IFCLITE_BIM_GIS_VIEWER.md` | `docs/01-especificacion-visor.md` |
| `RIESGOS.md` | `docs/02-riesgos.md` |
| `REVIEW_SPEC_IFCLITE.md` | `docs/03-revision-especificacion.md` |
| `SPIKE-REPORT.md` (entregable obligatorio del §12) | `docs/04-spike-fase-0.md` |
| `SPEC_CUSTOM_BIM_KERNEL.md` | `docs/05-kernel-propio-rust-wasm.md` |
| `DISTRIBUCION_TRABAJO_PARALELO_10_DEVS.md` | `docs/06-organizacion-equipo.md` |
