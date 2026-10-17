import { defineConfig, type Plugin } from "vite";

/**
 * Parche para un DEFECTO del paquete publicado @ifc-lite/geometry@7.8.1.
 *
 * El paquete publica el worker compilado como `dist/geometry.worker.js`, pero
 * `dist/geometry-worker-pool.js` (línea 32) lo referencia con extensión `.ts`:
 *
 *     new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
 *
 * Su propio script de publicación parchea esa extensión en `index.js`,
 * `geometry-parallel.js` y `remesh/remesh-client.js`, pero se dejó fuera
 * `geometry-worker-pool.js`. Resultado: cualquier bundler (Vite, Rollup,
 * webpack) falla al resolver el módulo.
 *
 * Este plugin reescribe la extensión al vuelo. Es una solución temporal:
 * hay que reportarlo en el repositorio de IFC-Lite y eliminar el plugin cuando
 * salga una versión corregida. Ver SPIKE-REPORT.md → "Hallazgos".
 */
function ifcLiteWorkerExtensionFix(): Plugin {
  return {
    name: "ifc-lite-worker-extension-fix",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@ifc-lite")) return null;
      if (!code.includes(".worker.ts")) return null;
      // Solo se reescribe cuando la extensión va entrecomillada, es decir,
      // cuando forma parte de una URL de módulo y no de un comentario.
      const fixed = code.replace(/\.worker\.ts(?=['"])/g, ".worker.js");
      if (fixed === code) return null;
      // map: null indica explícitamente que no se genera mapa: evita el aviso
      // "Sourcemap is likely to be incorrect" de Rollup.
      return { code: fixed, map: null };
    },
  };
}

/**
 * Cabeceras de aislamiento de origen cruzado.
 *
 * Son necesarias para SharedArrayBuffer y, por tanto, para el parseo multihilo
 * de IFC-Lite (WorkerParser). Decisión del spike: `credentialless`, soportado en
 * navegadores Chromium. En Firefox/Safari el aislamiento no se activa y el
 * parseo cae a single-thread; en Vercel hay que mantener las mismas cabeceras
 * (ver vercel.json). Cambiar a `require-corp` aislaría también en Firefox/Safari
 * pero bloquearía recursos de terceros sin CORP (p. ej. WMS/WMTS).
 *
 * Detalle completo en SPEC_IFCLITE_BIM_GIS_VIEWER.md (NFR-02) y en REVIEW_SPEC_IFCLITE.md §7.
 */
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  base: "/",
  plugins: [ifcLiteWorkerExtensionFix()],
  // Se excluye del preempaquetado para que el plugin de arriba vea el código
  // original del paquete (el optimizador de dependencias de Vite lo saltaría).
  // @ifc-lite/geometry es ESM puro, así que excluirlo no tiene efectos raros.
  optimizeDeps: {
    exclude: ["@ifc-lite/geometry"],
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  worker: {
    format: "es",
  },
});
