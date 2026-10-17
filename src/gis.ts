import L from "leaflet";
import "leaflet/dist/leaflet.css";
import proj4 from "proj4";
import {
  computeAngleToGridNorth,
  getCoordinateSystemDescription,
  type GeoreferenceInfo,
} from "@ifc-lite/parser";
import type { MeshData } from "@ifc-lite/geometry";
import type { LogLevel, ModelRecord } from "./viewer";

/**
 * Contexto GIS 2D del spike.
 *
 * Cubre el alcance funcional del MVP §3.1 puntos 9 y 10, y los criterios de
 * aceptación TC-009 (un IFC con CRS válido se coloca según transformación
 * verificada; uno sin CRS **no** se presenta como georreferenciado) y TC-010
 * (mapa con capa de servicio configurable).
 *
 * Decisiones:
 *
 * - El mapa va en `EPSG:3857` (el CRS nativo de Leaflet) y las coordenadas se
 *   convierten explícitamente con Proj4js. No se usa `proj4leaflet` para poder
 *   reutilizar la misma conversión en el resto de la aplicación.
 * - La transformación local → mundo la hace la propia librería
 *   (`transformToWorld`), no una reimplementación nuestra. Así la colocación es
 *   verificable y el día que la librería arregle su extracción de CRS
 *   heredamos la corrección.
 * - **Sin `IfcMapConversion` no se coloca nada**: un modelo local se muestra
 *   como «sin georreferenciación declarada» en lugar de caer en el golfo de
 *   Guinea, que es lo que pasa si se asume que sus coordenadas ya son UTM.
 */

/** EPSG definidos a mano: Proj4js sólo trae 4326 y 3857 de fábrica. */
const ETRS89_TOWGS84 = "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
proj4.defs("EPSG:25829", `+proj=utm +zone=29 +${ETRS89_TOWGS84}`);
proj4.defs("EPSG:25830", `+proj=utm +zone=30 +${ETRS89_TOWGS84}`);

/**
 * La librería NO expone el código EPSG en ningún campo: sólo aparece dentro del
 * texto del CRS (hallazgo H6). Se busca ahí y, si no está, se deduce del huso
 * UTM del nombre, que es lo único que queda.
 */
const EPSG_PATTERN = /EPSG\s*:?\s*(\d{4,6})/i;

const KNOWN_PROJECTIONS = new Set(["EPSG:25829", "EPSG:25830", "EPSG:4326", "EPSG:3857"]);

export type BaseLayerId = "pnoa" | "osm" | "ninguna";

interface BaseLayerDefinition {
  readonly id: BaseLayerId;
  readonly label: string;
  create(): L.Layer | null;
}

/**
 * Capas base. El WMS del IGN sirve la ortofoto del PNOA, que es el contexto
 * real de los casos de uso gallegos; OSM queda como alternativa cuando el WMS
 * falla (CORS, red o proveedor caído: riesgo RSK-05 del equipo).
 */
const BASE_LAYERS: readonly BaseLayerDefinition[] = [
  {
    id: "pnoa",
    label: "IGN · ortofoto PNOA (WMS)",
    create: () =>
      L.tileLayer.wms("https://www.ign.es/wms-inspire/pnoa-ma", {
        layers: "OI.OrthoimageCoverage",
        format: "image/jpeg",
        version: "1.1.1",
        transparent: false,
        maxZoom: 20,
        attribution: "© IGN/CNIG · PNOA",
      }),
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    create: () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }),
  },
  { id: "ninguna", label: "Sin capa base", create: () => null },
];

/** Resultado de intentar colocar un modelo en el mapa. Se expone para poder medirlo. */
export interface Placement {
  readonly modelId: string;
  readonly fileName: string;
  readonly epsg: string;
  readonly easting: number;
  readonly northing: number;
  readonly height: number;
  readonly lat: number;
  readonly lon: number;
  /** Ángulo del eje X local respecto al norte de la cuadrícula, en grados. */
  readonly gridAngleDeg: number | null;
  /** Extensión horizontal del modelo en metros (X, Y locales) y su semidiagonal. */
  readonly extentX: number;
  readonly extentY: number;
  readonly diagonal: number;
}

/** Modelo que no se puede colocar y por qué (TC-009: no fingir georreferenciación). */
export interface Unplaced {
  readonly fileName: string;
  readonly reason: string;
}

export interface GisPanel {
  readonly map: L.Map;
  /** Últimos modelos colocados; vacío si ninguno tiene georreferenciación válida. */
  readonly placements: readonly Placement[];
  readonly unplaced: readonly Unplaced[];
  update(models: readonly ModelRecord[]): void;
  setBaseLayer(id: BaseLayerId): void;
  invalidate(): void;
  dispose(): void;
}

/** Extensión horizontal (m) de las mallas de un modelo, en el marco de render (Y arriba). */
function localExtent(meshes: readonly MeshData[]): { x: number; y: number; diagonal: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const mesh of meshes) {
    const positions = mesh.positions;
    if (!positions || positions.length < 3) continue;
    const [ox, oy, oz] = mesh.origin ?? [0, 0, 0];
    // El marco de render es Y arriba, así que el plano horizontal es (x, z) y
    // la vertical es y. Sólo interesan los tamaños, que son invariantes.
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i] + ox;
      const y = positions[i + 1] + oy;
      const z = positions[i + 2] + oz;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null;
  const x = maxX - minX;
  const y = maxZ - minZ;
  const vertical = maxY - minY;
  return { x, y, diagonal: Math.hypot(x, y, vertical) };
}

/** Código EPSG del modelo, o `null` si no se puede deducir con fundamento. */
function detectEpsg(info: GeoreferenceInfo): string | null {
  const crs = info.projectedCRS;
  const haystack = [crs?.name, crs?.description, crs?.geodeticDatum, crs?.mapProjection]
    .filter((part): part is string => typeof part === "string")
    .join(" ");

  const explicit = haystack.match(EPSG_PATTERN);
  if (explicit) {
    const code = `EPSG:${explicit[1]}`;
    if (KNOWN_PROJECTIONS.has(code)) return code;
    return null;
  }

  // Sin código explícito, el huso sólo es concluyente si el nombre dice "UTM".
  const zone = crs?.mapZone?.match(/(\d{1,2})/)?.[1];
  if (zone && /UTM/i.test(haystack)) {
    const candidate = `EPSG:${25800 + Number(zone)}`;
    if (KNOWN_PROJECTIONS.has(candidate)) return candidate;
  }
  if (/WGS84|4326/i.test(haystack)) return "EPSG:4326";
  if (/PSEUDO-?MERCATOR|3857/i.test(haystack)) return "EPSG:3857";
  return null;
}

/** Coordenadas proyectadas → lat/lon. `null` si Proj4js no puede convertir. */
function toLatLng(epsg: string, easting: number, northing: number): L.LatLng | null {
  try {
    const [lon, lat] = proj4(epsg, "EPSG:4326", [easting, northing]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return L.latLng(lat, lon);
  } catch {
    return null;
  }
}

export function mountGisPanel(
  container: HTMLElement,
  log: (message: string, level?: LogLevel) => void,
): GisPanel {
  const map = L.map(container, {
    center: L.latLng(42.8, -8.5), // Galicia: encuadre por defecto antes de colocar nada.
    zoom: 7,
    zoomControl: true,
    attributionControl: true,
  });

  let currentLayerId: BaseLayerId = "pnoa";
  let currentLayer: L.Layer | null = null;
  let tileErrors = 0;
  const overlay = L.layerGroup().addTo(map);

  let placements: readonly Placement[] = [];
  let unplaced: readonly Unplaced[] = [];
  /** Firma de la última colocación: evita reencuadrar y repetir avisos. */
  let lastSignature = "";

  const attachBaseLayer = (id: BaseLayerId): void => {
    if (currentLayer) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
    const definition = BASE_LAYERS.find((layer) => layer.id === id) ?? BASE_LAYERS[0];
    currentLayerId = definition.id;
    tileErrors = 0;

    const layer = definition.create();
    if (!layer) return;

    // RSK-05: si el proveedor bloquea el acceso (CORS, caída o red), hay que
    // avisar y seguir. Nunca dejar el panel en blanco sin explicación.
    layer.on("tileerror", () => {
      tileErrors += 1;
      if (tileErrors === 1 || tileErrors % 25 === 0) {
        log(
          `La capa base "${definition.label}" no puede cargar teselas (${tileErrors} fallos). El modelo sigue colocado en su coordenada: se puede cambiar de capa base.`,
          "warn",
        );
      }
    });

    layer.addTo(map);
    currentLayer = layer;
  };

  attachBaseLayer(currentLayerId);

  const update = (models: readonly ModelRecord[]): void => {
    overlay.clearLayers();
    const nextPlacements: Placement[] = [];
    const nextUnplaced: Unplaced[] = [];
    const bounds = L.latLngBounds([]);

    for (const model of models) {
      if (model.status !== "ready") continue;
      const info = model.georeference;

      if (!info || !info.hasGeoreference) {
        nextUnplaced.push({ fileName: model.fileName, reason: "sin georreferenciación declarada" });
        continue;
      }
      const conversion = info.mapConversion;
      if (!conversion) {
        nextUnplaced.push({
          fileName: model.fileName,
          reason: "hay CRS pero no hay IfcMapConversion (no se puede calcular el origen)",
        });
        continue;
      }
      const epsg = detectEpsg(info);
      if (!epsg) {
        nextUnplaced.push({
          fileName: model.fileName,
          reason: "CRS sin código EPSG reconocible; no se coloca para no dar una posición falsa",
        });
        continue;
      }

      const latLng = toLatLng(epsg, conversion.eastings, conversion.northings);
      if (!latLng) {
        nextUnplaced.push({ fileName: model.fileName, reason: `Proj4js no pudo convertir desde ${epsg}` });
        continue;
      }

      const extent = localExtent(model.meshes);
      const angle = computeAngleToGridNorth(conversion.xAxisAbscissa, conversion.xAxisOrdinate);
      const angular = ((angle ?? 0) * Math.PI) / 180;
      const halfX = (extent?.x ?? 0) / 2;
      const halfY = (extent?.y ?? 0) / 2;

      // Esquina de la huella en coordenadas proyectadas. El eje X local forma
      // `angle` radianes con el eje X del mapa (computeAngleToGridNorth).
      const cos = Math.cos(angular);
      const sin = Math.sin(angular);
      const corners: L.LatLng[] = [];
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ] as const) {
        const dx = sx * halfX * cos - sy * halfY * sin;
        const dy = sx * halfX * sin + sy * halfY * cos;
        const corner = toLatLng(epsg, conversion.eastings + dx, conversion.northings + dy);
        if (corner) corners.push(corner);
      }

      const label = `${model.fileName} · ${epsg}`;
      if (corners.length === 4 && halfX > 0 && halfY > 0) {
        const footprint = L.polygon(corners, {
          color: "#ffb703",
          weight: 2,
          fillOpacity: 0.15,
        }).addTo(overlay);
        footprint.bindPopup(
          `${label}<br>Huella aproximada: ${extent?.x.toFixed(2)} × ${extent?.y.toFixed(2)} m` +
            (angle !== null ? `<br>Giro respecto al norte de la cuadrícula: ${angle.toFixed(2)}°` : ""),
        );
      }

      L.circleMarker(latLng, {
        radius: 6,
        color: "#1b263b",
        weight: 2,
        fillColor: "#ffb703",
        fillOpacity: 1,
      })
        .addTo(overlay)
        .bindPopup(
          `<strong>${label}</strong><br>` +
            `${getCoordinateSystemDescription(info) ?? "CRS sin descripción"}<br>` +
            `Origen IfcMapConversion: ${conversion.eastings.toFixed(3)} E, ` +
            `${conversion.northings.toFixed(3)} N, ${conversion.orthogonalHeight.toFixed(3)} m<br>` +
            `WGS84: ${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}` +
            (extent ? `<br>Semidiagonal del modelo: ${(extent.diagonal / 2).toFixed(2)} m` : ""),
        );

      bounds.extend(latLng);
      nextPlacements.push({
        modelId: model.id,
        fileName: model.fileName,
        epsg,
        easting: conversion.eastings,
        northing: conversion.northings,
        height: conversion.orthogonalHeight,
        lat: latLng.lat,
        lon: latLng.lng,
        gridAngleDeg: angle,
        extentX: extent?.x ?? 0,
        extentY: extent?.y ?? 0,
        diagonal: extent?.diagonal ?? 0,
      });
    }

    placements = nextPlacements;
    unplaced = nextUnplaced;

    // `update()` se llama en cada cambio de estado de los modelos (cargando →
    // listo → encuadrado), así que aquí sólo se reencuadra y se informa cuando
    // cambia de verdad lo que hay que colocar. Si no, cada re-render le quitaría
    // al usuario el zoom que acaba de hacer y llenaría el registro de ruido.
    const signature = [
      ...placements.map(
        (placement) =>
          `${placement.fileName}|${placement.epsg}|${placement.lat.toFixed(7)}|${placement.lon.toFixed(7)}`,
      ),
      ...unplaced.map((entry) => `${entry.fileName}|${entry.reason}`),
    ].join("|");

    if (signature === lastSignature) return;
    lastSignature = signature;

    if (placements.length > 0) {
      // Un modelo de edificación son decenas de metros: se encuadra con margen.
      map.fitBounds(bounds.pad(0.5), { maxZoom: 19 });
      log(
        `${placements.length} modelo(s) colocados por su IfcMapConversion: ${placements
          .map((placement) => `${placement.fileName} en ${placement.epsg}`)
          .join(", ")}.`,
      );
    }
    for (const entry of unplaced) {
      log(`${entry.fileName}: no se coloca en el mapa — ${entry.reason}.`, "warn");
    }
  };

  return {
    map,
    get placements() {
      return placements;
    },
    get unplaced() {
      return unplaced;
    },
    update,
    setBaseLayer: attachBaseLayer,
    invalidate: () => map.invalidateSize(),
    dispose: () => map.remove(),
  };
}
