import {
  encodeDxfCp1252,
  exportToDXF,
  exportToSVG,
  generateFloorPlan,
  generateSection,
} from "@ifc-lite/drawing-2d";
import type { MeshData } from "@ifc-lite/geometry";

/**
 * Generación de planos y exportación (Fase 0: pasos 3 y 4 del spike).
 *
 * Verificado en la documentación de @ifc-lite/drawing-2d 4.2.0:
 *   - DXF ASCII R12 (AC1009), con `$DWGCODEPAGE ANSI_1252` en la cabecera.
 *   - R12 no tiene `$INSUNITS`: las unidades y el CRS van en un comentario 999.
 *   - Es obligatorio `encodeDxfCp1252()` antes de escribir el fichero; con un
 *     codificador UTF-8 los textos no ASCII salen como mojibake.
 */

type Drawing = Awaited<ReturnType<typeof generateSection>>;

export interface DrawingResult {
  label: string;
  svg: string;
  dxf: string;
  dxfBytes: Uint8Array;
  hadUnmappable: boolean;
}

async function buildResult(label: string, drawing: Drawing): Promise<DrawingResult> {
  const svg = exportToSVG(drawing, {
    showHatching: true,
    showHiddenLines: true,
  } as never);

  const dxf = exportToDXF(drawing, {
    showHiddenLines: true,
    showHatching: true,
    metadataComment: `VisorGuBIMGal spike — ${label} — units: metres`,
  } as never);

  const { bytes, hadUnmappable } = encodeDxfCp1252(dxf);

  return { label, svg, dxf, dxfBytes: bytes, hadUnmappable };
}

export async function buildFloorPlan(
  meshes: MeshData[],
  elevationMeters: number,
): Promise<DrawingResult> {
  const drawing = await generateFloorPlan(meshes, elevationMeters, {
    includeHiddenLines: true,
    includeProjection: true,
  } as never);
  return buildResult(`Planta a cota ${elevationMeters} m`, drawing);
}

export async function buildSection(
  meshes: MeshData[],
  axis: "x" | "z",
  positionMeters: number,
): Promise<DrawingResult> {
  const drawing = await generateSection(meshes, axis, positionMeters);
  return buildResult(`Sección ${axis.toUpperCase()} en ${positionMeters} m`, drawing);
}

/**
 * Vista previa del SVG como objeto URL. Deliberadamente NO se usa `innerHTML`
 * con el SVG generado: un IFC es contenido no confiable y sus textos podrían
 * inyectar marcado (ver REVIEW_SPEC_IFCLITE.md, M3).
 */
export function svgObjectUrl(result: DrawingResult): string {
  return URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }));
}

export function downloadDrawing(result: DrawingResult, format: "svg" | "dxf"): void {
  const isSvg = format === "svg";
  const blob = isSvg
    ? new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" })
    : new Blob([result.dxfBytes as unknown as BlobPart], { type: "application/dxf" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(result.label)}.${isSvg ? "svg" : "dxf"}`;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
