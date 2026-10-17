# 07 · Desarrollo local

## Requisitos

- **Node ≥ 22.13** (probado con v26.12.0 y npm 11.20.0). Nada más: todo se ejecuta
  en el navegador.
- Navegador con **WebGPU** para la vista 3D (Chrome/Edge 113+, Firefox 141+,
  Safari 18+). Sin WebGPU la aplicación arranca en modo degradado: carga,
  propiedades y planos/DXF siguen funcionando.

## Comandos

| Comando | Para qué |
|---|---|
| `npm install` | Instala las dependencias fijadas (el `package-lock.json` está versionado) |
| `npm run dev` | Servidor de desarrollo con recarga en caliente → http://localhost:5173 |
| `npm run build` | `tsc --noEmit` + `vite build` en `dist/`; falla si hay un error de tipos |
| `npm run preview` | Sirve `dist/` → http://localhost:4173, con las mismas cabeceras que Vercel |
| `npm run typecheck` | Sólo comprobación de tipos |

## Cabeceras COOP/COEP (obligatorias)

`vite.config.ts` (dev y preview) y `vercel.json` (producción) envían
`Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: credentialless`.
Sin ellas no hay aislamiento de origen ni `SharedArrayBuffer`, y el parseo multihilo
de IFC-Lite no puede usarlos. Verificado y razonado en `04-spike-fase-0.md` (H7).

## Trampa conocida: el worker de `@ifc-lite/geometry`

`@ifc-lite/geometry@7.8.1` publica `dist/geometry.worker.js` pero lo referencia como
`.ts`, así que **cualquier bundler falla** al construir. `vite.config.ts` incluye el
plugin `ifc-lite-worker-extension-fix`, que reescribe esa extensión y excluye el
paquete del preempaquetado. No lo quites hasta que la librería lo corrija
(defecto H1 en `04-spike-fase-0.md`).

## Depurar el visor

En `localhost` la consola del navegador expone la instancia:

```js
__visor.allModels                                  // modelos cargados (modelIndex, estado, tiempos)
__visor.rendererInstance.getCamera().getDistance() // distancia de cámara (útil para medir el zoom)
```

Sólo se publica en local (ver `src/main.ts`). Medición del zoom: `04-spike-fase-0.md` (H14).

## Fixtures

Ver `spike-fixtures/README.md`. El `.gitignore` **no** ignora `*.ifc`: no dejes ahí
modelos de cliente (H13 en `04-spike-fase-0.md`).

## Git

- `origin` = fork personal · `upstream` = `gubimgalicia/VisorGuBIMGal`.
- **No** empujar a `upstream` sin consentimiento del equipo:
  `.agents/rules/reglas-de-github.md`.
