import { GeometryProcessor } from "@ifc-lite/geometry";
import type { MeshData } from "@ifc-lite/geometry";
import {
  IfcParser,
  extractGeoreferencingOnDemand,
  extractPropertiesOnDemand,
  type ExtractedProperty,
  type GeoreferenceInfo,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { Renderer } from "@ifc-lite/renderer";

/**
 * Adaptador sobre IFC-Lite para el spike de la Fase 0.
 *
 * Correspondencia con la arquitectura del §5 de la especificación:
 *   este fichero ↔ src/infrastructure/ifclite (adaptador BIM)
 *   src/drawing.ts ↔ generación de planos
 *   src/controls.ts ↔ control de cámara
 *   src/ui.ts ↔ src/ui
 *
 * Todas las firmas que se usan aquí están tomadas de los ficheros `.d.ts`
 * publicados por los paquetes fijados en package.json (no de la guía). Las
 * diferencias entre la guía y los tipos reales están recogidas en SPIKE-REPORT.md.
 */

type RenderOptions = Parameters<Renderer["render"]>[0];

export type LogLevel = "info" | "warn" | "error";
export type ModelStatus = "loading" | "ready" | "error";
export type PresetView = "top" | "bottom" | "front" | "back" | "left" | "right";

export interface PropertyGroup {
  name: string;
  properties: Array<{ name: string; value: string }>;
}

export interface ModelRecord {
  readonly id: string;
  readonly fileName: string;
  /**
   * Índice del modelo en la escena federada. Se copia a `MeshData.modelIndex`,
   * que es la identidad que devuelve `Renderer.pick()` junto al expressId.
   */
  readonly modelIndex: number;
  status: ModelStatus;
  schema?: string;
  entityCount?: number;
  errorMessage?: string;
  meshes: MeshData[];
  store?: IfcDataStore;
  georeference?: GeoreferenceInfo | null;
  timings: { parseMs?: number; geometryMs?: number; firstRenderMs?: number };
}

export interface SelectionInfo {
  expressId: number;
  /** `modelIndex` devuelto por `pick()`; null si el renderer no lo informó. */
  modelIndex: number | null;
  modelFileName: string | null;
  ifcType: string | null;
  /** El mismo expressId existe en otro modelo: la federación exige el par (modelIndex, expressId). */
  sharedAcrossModels: boolean;
  properties: PropertyGroup[];
  propertiesError?: string;
}

export interface Diagnostic {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webgpuNavigator: boolean;
  webgpuAdapter: boolean;
  rendererReady: boolean;
  adapterInfo: string | null;
  userAgent: string;
}

export interface ViewerCallbacks {
  onModelsChanged(models: readonly ModelRecord[]): void;
  onSelection(info: SelectionInfo | null): void;
  onLog(message: string, level?: LogLevel): void;
  onDiagnostic(diagnostic: Diagnostic): void;
}

export class IfcViewer {
  private readonly parser = new IfcParser();
  private readonly geometry = new GeometryProcessor();
  private readonly renderer: Renderer;
  private readonly models: ModelRecord[] = [];
  private readonly listeners: ViewerCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly typeIndexByModel = new Map<string, Map<number, string>>();
  private rendererReady = false;
  private selectedIds: Set<number> = new Set();
  private nextModelIndex = 0;
  private needsRender = false;
  private animationFrame = 0;

  constructor(canvas: HTMLCanvasElement, listeners: ViewerCallbacks) {
    this.canvas = canvas;
    this.listeners = listeners;
    this.renderer = new Renderer(canvas);
  }

  get allModels(): readonly ModelRecord[] {
    return this.models;
  }

  get isRendererReady(): boolean {
    return this.rendererReady;
  }

  /** Expuesto para el control de cámara (src/controls.ts). */
  get rendererInstance(): Renderer {
    return this.renderer;
  }

  async init(): Promise<void> {
    // El motor de geometría es WASM/CPU: funciona aunque no haya WebGPU.
    await this.geometry.init();
    this.listeners.onLog("Motor de geometría (WASM) inicializado.");

    try {
      await this.renderer.init();
      this.rendererReady = true;
      this.listeners.onLog("Renderer WebGPU inicializado.");

      this.canvas.addEventListener("click", (event) => {
        void this.selectAt(event);
      });
      window.addEventListener("resize", () => this.resize());
      this.resize();
      this.startRenderLoop();
    } catch (error) {
      this.rendererReady = false;
      this.listeners.onLog(
        `Renderer WebGPU no disponible (${describeError(error)}). Se continúa sin vista 3D: la carga, las propiedades y los planos/DXF siguen operativos.`,
        "warn",
      );
    }

    this.listeners.onDiagnostic(await this.probeCapabilities());
  }

  requestRender(): void {
    if (!this.rendererReady) return;
    this.needsRender = true;
  }

  async addFile(file: File): Promise<ModelRecord> {
    const record: ModelRecord = {
      id: crypto.randomUUID(),
      fileName: file.name,
      modelIndex: this.nextModelIndex++,
      status: "loading",
      meshes: [],
      timings: {},
    };
    this.models.push(record);
    this.emitModels();
    this.listeners.onLog(`Cargando ${file.name} (${formatBytes(file.size)})…`);

    try {
      const buffer = await file.arrayBuffer();

      const parseStart = performance.now();
      const store = await this.parser.parseColumnar(buffer, {
        onProgress: (progress) => {
          // El tipo de `progress` lo fija ParseOptions; se imprime de forma genérica.
          this.listeners.onLog(`${file.name}: ${describeProgress(progress)}`);
        },
      });
      record.timings.parseMs = performance.now() - parseStart;

      record.store = store;
      record.schema = readSchemaVersion(store);
      record.entityCount = countEntities(store);
      record.georeference = safeGeoreference(store, file.name, this.listeners);

      const geometryStart = performance.now();
      const meshes: MeshData[] = [];
      for await (const event of this.geometry.processAdaptive(new Uint8Array(buffer))) {
        if (event.type === "batch" && "meshes" in event && event.meshes) {
          meshes.push(...event.meshes);
        }
      }
      // La federación se apoya en este campo: pick() devuelve (expressId, modelIndex).
      for (const mesh of meshes) {
        mesh.modelIndex = record.modelIndex;
      }
      record.timings.geometryMs = performance.now() - geometryStart;
      record.meshes = meshes;
      record.status = "ready";

      this.listeners.onLog(
        `${file.name}: ${meshes.length} mallas, ${record.entityCount} entidades, esquema ${record.schema ?? "desconocido"}.`,
      );
    } catch (error) {
      record.status = "error";
      record.errorMessage = describeError(error);
      this.listeners.onLog(`${file.name}: error de carga — ${record.errorMessage}`, "error");
    }

    this.emitModels();

    if (record.status === "ready") {
      const renderStart = performance.now();
      this.uploadGeometry();
      this.fit();
      record.timings.firstRenderMs = performance.now() - renderStart;
      this.emitModels();
    }

    return record;
  }

  removeModel(id: string): void {
    const index = this.models.findIndex((model) => model.id === id);
    if (index < 0) return;
    const [removed] = this.models.splice(index, 1);
    this.typeIndexByModel.delete(id);
    this.listeners.onLog(`Modelo retirado: ${removed?.fileName ?? id}`);
    this.selectedIds = new Set();
    this.listeners.onSelection(null);
    this.uploadGeometry();
    this.emitModels();
  }

  /** Mallas de todos los modelos listos, para generar planos y DXF. */
  drawingMeshes(): MeshData[] {
    return this.models
      .filter((model) => model.status === "ready")
      .flatMap((model) => model.meshes);
  }

  georeferenceOf(modelIndex: number): GeoreferenceInfo | null {
    return this.models.find((model) => model.modelIndex === modelIndex)?.georeference ?? null;
  }

  fit(): void {
    if (!this.rendererReady) return;
    this.renderer.fitToView();
    this.requestRender();
  }

  /** Vista predefinida ('top' = planta). Respeta `MIN_PHI`/`MAX_PHI` del paquete. */
  setPresetView(view: PresetView): void {
    if (!this.rendererReady) return;
    this.renderer.getCamera().setPresetView(view);
    this.requestRender();
  }

  toggleProjection(): "perspective" | "orthographic" | null {
    if (!this.rendererReady) return null;
    const camera = this.renderer.getCamera();
    camera.toggleProjectionMode();
    this.requestRender();
    return camera.getProjectionMode();
  }

  private uploadGeometry(): void {
    if (!this.rendererReady) return;
    const meshes = this.drawingMeshes();
    if (meshes.length === 0) return;
    // `loadGeometry` es la entrada principal y `addMeshes` la incremental.
    // Aquí se recarga el conjunto completo: simple y correcto, pero reenvía
    // geometría ya subida. La vía incremental (addMeshes, meshes[].modelIndex)
    // es la que debe usarse en la implementación real.
    this.renderer.loadGeometry(meshes);
  }

  private async selectAt(event: MouseEvent): Promise<void> {
    if (!this.rendererReady) {
      this.listeners.onLog(
        "Sin renderer 3D no hay selección por clic; la selección requiere WebGPU.",
        "warn",
      );
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    // pick() documenta explícitamente coordenadas CSS relativas al canvas.
    const hit = await this.renderer.pick(event.clientX - rect.left, event.clientY - rect.top);

    if (!hit) {
      this.selectedIds = new Set();
      this.listeners.onSelection(null);
      this.requestRender();
      return;
    }

    this.selectedIds = new Set([hit.expressId]);

    const model =
      this.models.find((candidate) => candidate.modelIndex === hit.modelIndex) ?? null;

    if (model === null) {
      this.listeners.onLog(
        `pick() devolvió modelIndex ${String(hit.modelIndex)} y no hay ningún modelo cargado con ese índice.`,
        "warn",
      );
    }

    const sharedAcrossModels = this.isSharedAcrossModels(hit.expressId, hit.modelIndex);
    if (sharedAcrossModels) {
      this.listeners.onLog(
        `El expressId ${hit.expressId} también existe en otro modelo: la identidad de selección es el par (modelIndex, expressId).`,
        "warn",
      );
    }

    let properties: PropertyGroup[] = [];
    let propertiesError: string | undefined;
    if (model?.store) {
      try {
        properties = extractPropertiesOnDemand(model.store, hit.expressId).map((set) => ({
          name: set.name,
          properties: set.properties.map((property) => ({
            name: property.name,
            value: formatPropertyValue(property),
          })),
        }));
      } catch (error) {
        propertiesError = describeError(error);
      }
    } else {
      propertiesError = "El modelo de este elemento no tiene store de propiedades.";
    }

    this.listeners.onSelection({
      expressId: hit.expressId,
      modelIndex: hit.modelIndex ?? null,
      modelFileName: model?.fileName ?? null,
      ifcType: model ? this.ifcTypeOf(model, hit.expressId) : null,
      sharedAcrossModels,
      properties,
      propertiesError,
    });
    this.requestRender();
  }

  private isSharedAcrossModels(expressId: number, modelIndex: number | undefined): boolean {
    if (!this.rendererReady) return false;
    try {
      const scene = this.renderer.getScene();
      return this.models.some(
        (model) =>
          model.modelIndex !== modelIndex && scene.hasMeshData(expressId, model.modelIndex),
      );
    } catch {
      return false;
    }
  }

  /**
   * Índice inverso expressId → tipo IFC, construido bajo demanda: sólo se paga
   * cuando el usuario selecciona algo, no en cada carga.
   */
  private ifcTypeOf(model: ModelRecord, expressId: number): string | null {
    if (!model.store) return null;
    let index = this.typeIndexByModel.get(model.id);
    if (!index) {
      index = new Map<number, string>();
      for (const [type, ids] of model.store.entityIndex.byType) {
        for (const id of ids) index.set(id, type);
      }
      this.typeIndexByModel.set(model.id, index);
    }
    return index.get(expressId) ?? null;
  }

  /** Detiene el bucle de dibujo (la app vive toda la sesión, pero es explícito). */
  dispose(): void {
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private render(): void {
    if (!this.rendererReady) return;
    const options: { selectedIds?: Set<number> } = {};
    if (this.selectedIds.size > 0) {
      options.selectedIds = this.selectedIds;
    }
    // NOTA: `RenderOptions.selectedIds` sólo acepta expressIds, sin modelIndex.
    // Con ids repetidos entre modelos, el resaltado no se puede acotar a uno
    // solo. Queda anotado como incógnita en SPIKE-REPORT.md.
    this.renderer.render(options as RenderOptions);
  }

  /**
   * Bucle de dibujo. `Camera.update()` devuelve true mientras la cámara sigue
   * animándose (inercia de órbita, transiciones de `fitToView`), que es lo que
   * permite redibujar sólo cuando hace falta.
   */
  private startRenderLoop(): void {
    let last = performance.now();
    const frame = (now: number): void => {
      const deltaSeconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      const animating = this.renderer.getCamera().update(deltaSeconds);
      if (animating || this.needsRender) {
        this.needsRender = false;
        this.render();
      }
      this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private resize(): void {
    if (!this.rendererReady) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    this.renderer.resize(width, height);
    this.needsRender = true;
  }

  private async probeCapabilities(): Promise<Diagnostic> {
    const navigatorWithGpu = navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<unknown | null> };
    };

    let adapter = false;
    if (navigatorWithGpu.gpu) {
      try {
        adapter = (await navigatorWithGpu.gpu.requestAdapter()) !== null;
      } catch {
        adapter = false;
      }
    }

    const adapterInfo = this.rendererReady ? this.renderer.getAdapterInfo() : null;

    return {
      crossOriginIsolated: window.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      webgpuNavigator: Boolean(navigatorWithGpu.gpu),
      webgpuAdapter: adapter,
      rendererReady: this.rendererReady,
      adapterInfo: adapterInfo
        ? [adapterInfo.vendor, adapterInfo.architecture]
            .filter((part): part is string => Boolean(part))
            .join(" / ")
        : null,
      userAgent: navigator.userAgent,
    };
  }

  private emitModels(): void {
    this.listeners.onModelsChanged([...this.models]);
  }
}

/** Número de entidades indexadas por tipo. */
function countEntities(store: IfcDataStore): number {
  let total = 0;
  for (const ids of store.entityIndex.byType.values()) total += ids.length;
  return total;
}

/**
 * Versión de esquema IFC de la cabecera. No está en los tipos públicos que se
 * han podido consultar, así que se lee de forma tolerante.
 */
function readSchemaVersion(store: IfcDataStore): string | undefined {
  const candidate = store as unknown as { schemaVersion?: unknown; schema?: unknown };
  const value = candidate.schemaVersion ?? candidate.schema;
  return typeof value === "string" ? value : undefined;
}

function safeGeoreference(
  store: IfcDataStore,
  fileName: string,
  listeners: ViewerCallbacks,
): GeoreferenceInfo | null {
  try {
    return extractGeoreferencingOnDemand(store);
  } catch (error) {
    listeners.onLog(`No se pudo leer la georreferenciación de ${fileName}: ${describeError(error)}`, "warn");
    return null;
  }
}

function formatPropertyValue(property: ExtractedProperty): string {
  if (property.values && property.values.length > 0) {
    return property.values.join(", ");
  }
  const value = property.value as unknown;
  if (value === null || value === undefined) return "—";

  let text: string;
  if (typeof value === "number") {
    text = Number.isInteger(value) ? String(value) : trimZeros(value.toFixed(3));
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  return property.unit ? `${text} ${property.unit}` : text;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function describeProgress(progress: unknown): string {
  if (progress === null || typeof progress !== "object") return "progreso de parseo";
  const record = progress as Record<string, unknown>;
  const phase = typeof record.phase === "string" ? record.phase : "parseo";
  const percent = typeof record.percent === "number" ? Math.round(record.percent) : null;
  const scan = typeof record.scannedBytes === "number" ? record.scannedBytes : null;
  return [phase, percent === null ? null : `${percent}%`, scan === null ? null : `${scan} B`]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
