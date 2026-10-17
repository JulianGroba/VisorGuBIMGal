import { attachCameraControls } from "./controls";
import {
  buildFloorPlan,
  buildSection,
  downloadDrawing,
  svgObjectUrl,
  type DrawingResult,
} from "./drawing";
import { mountGisPanel, type BaseLayerId } from "./gis";
import {
  describeError,
  type Diagnostic,
  type IfcViewer,
  type LogLevel,
  type ModelRecord,
  type SelectionInfo,
} from "./viewer";

export interface Ui {
  log(message: string, level?: LogLevel): void;
  renderModels(models: readonly ModelRecord[]): void;
  renderSelection(info: SelectionInfo | null): void;
  renderDiagnostic(diagnostic: Diagnostic): void;
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id} en index.html`);
  return element as T;
}

function addDefinition(list: HTMLElement, label: string, value: string): void {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

const EPSG_PATTERN = /EPSG\s*:?\s*(\d{4,6})/i;

export function mountUi(viewer: IfcViewer): Ui {
  const fileInput = must<HTMLInputElement>("file-input");
  const dropZone = must<HTMLDivElement>("drop");
  const modelsList = must<HTMLUListElement>("models");
  const propsBody = must<HTMLTableSectionElement>("props-body");
  const logArea = must<HTMLPreElement>("log");
  const diagnosticList = must<HTMLDListElement>("diag");
  const georefList = must<HTMLDListElement>("georef");
  const drawingImage = must<HTMLImageElement>("drawing-img");
  const drawingLabel = must<HTMLSpanElement>("drawing-label");
  const rendererState = must<HTMLSpanElement>("renderer-state");
  const canvas = must<HTMLCanvasElement>("canvas");
  const mapContainer = must<HTMLDivElement>("map");
  const baseLayerSelect = must<HTMLSelectElement>("base-layer");
  const gisStatus = must<HTMLParagraphElement>("gis-status");

  const buttons = {
    fit: must<HTMLButtonElement>("fit"),
    projection: must<HTMLButtonElement>("projection"),
    viewTop: must<HTMLButtonElement>("view-top"),
    viewFront: must<HTMLButtonElement>("view-front"),
    viewRight: must<HTMLButtonElement>("view-right"),
    plan: must<HTMLButtonElement>("plan"),
    planElevation: must<HTMLInputElement>("plan-elevation"),
    sectionX: must<HTMLButtonElement>("section-x"),
    sectionZ: must<HTMLButtonElement>("section-z"),
    sectionPosition: must<HTMLInputElement>("section-pos"),
    exportSvg: must<HTMLButtonElement>("export-svg"),
    exportDxf: must<HTMLButtonElement>("export-dxf"),
  };

  let currentDrawing: DrawingResult | null = null;
  let currentPreviewUrl: string | null = null;

  const log = (message: string, level: LogLevel = "info"): void => {
    const line = document.createElement("span");
    line.className = `log-${level}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n`;
    logArea.append(line);
    logArea.scrollTop = logArea.scrollHeight;
  };

  attachCameraControls(canvas, viewer.rendererInstance, () => viewer.requestRender(), log);

  // Contexto GIS (MVP §3.1 puntos 9 y 10; TC-009 y TC-010). El mapa se monta
  // siempre: si no hay ningún modelo georreferenciado, se explica por qué no se
  // coloca nada en lugar de dejar el panel vacío.
  const gis = mountGisPanel(mapContainer, log);

  baseLayerSelect.addEventListener("change", () => {
    gis.setBaseLayer(baseLayerSelect.value as BaseLayerId);
  });
  window.addEventListener("resize", () => gis.invalidate());

  // Hook de depuración, sólo en local: permite medir las colocaciones reales
  // desde la consola (__gis.placements) sin instrumentar la aplicación.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    (window as unknown as Record<string, unknown>).__gis = gis;
  }

  const enqueueFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      void viewer.addFile(file);
    }
  };

  fileInput.addEventListener("change", () => {
    enqueueFiles(fileInput.files);
    fileInput.value = "";
  });

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
  for (const type of ["dragenter", "dragover"] as const) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragover");
    });
  }
  for (const type of ["dragleave", "drop"] as const) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
      if (type === "drop" && event instanceof DragEvent) {
        enqueueFiles(event.dataTransfer?.files ?? null);
      }
    });
  }

  buttons.fit.addEventListener("click", () => viewer.fit());
  buttons.viewTop.addEventListener("click", () => viewer.setPresetView("top"));
  buttons.viewFront.addEventListener("click", () => viewer.setPresetView("front"));
  buttons.viewRight.addEventListener("click", () => viewer.setPresetView("right"));
  buttons.projection.addEventListener("click", () => {
    const mode = viewer.toggleProjection();
    if (mode) {
      buttons.projection.textContent = mode === "orthographic" ? "Proyección: ortográfica" : "Proyección: perspectiva";
    }
  });

  const withDrawing = async (build: () => Promise<DrawingResult>): Promise<void> => {
    if (viewer.drawingMeshes().length === 0) {
      log("No hay geometría cargada para generar planos.", "warn");
      return;
    }
    try {
      log("Generando plano…");
      const result = await build();
      currentDrawing = result;

      if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = svgObjectUrl(result);
      drawingImage.src = currentPreviewUrl;
      drawingImage.alt = `Vista previa: ${result.label}`;

      drawingLabel.textContent = `${result.label} · ${
        result.hadUnmappable
          ? "DXF con caracteres sustituidos por '?' (fuera de Windows-1252)"
          : "DXF codificado en Windows-1252"
      }`;
      buttons.exportSvg.disabled = false;
      buttons.exportDxf.disabled = false;
      log(`Plano generado: ${result.label}.`);
    } catch (error) {
      log(`No se pudo generar el plano: ${describeError(error)}`, "error");
    }
  };

  buttons.plan.addEventListener("click", () => {
    const elevation = Number(buttons.planElevation.value);
    void withDrawing(() =>
      buildFloorPlan(viewer.drawingMeshes(), Number.isFinite(elevation) ? elevation : 0),
    );
  });

  const section = (axis: "x" | "z"): void => {
    const position = Number(buttons.sectionPosition.value);
    void withDrawing(() =>
      buildSection(viewer.drawingMeshes(), axis, Number.isFinite(position) ? position : 0),
    );
  };

  buttons.sectionX.addEventListener("click", () => section("x"));
  buttons.sectionZ.addEventListener("click", () => section("z"));

  buttons.exportSvg.addEventListener("click", () => {
    if (currentDrawing) downloadDrawing(currentDrawing, "svg");
  });
  buttons.exportDxf.addEventListener("click", () => {
    if (currentDrawing) downloadDrawing(currentDrawing, "dxf");
  });

  const renderModels = (models: readonly ModelRecord[]): void => {
    modelsList.replaceChildren();

    for (const model of models) {
      const item = document.createElement("li");

      const head = document.createElement("div");
      head.className = "model-head";

      const name = document.createElement("span");
      name.className = "model-name";
      name.textContent = model.fileName;

      const badge = document.createElement("span");
      badge.className = `badge ${model.status}`;
      badge.textContent =
        model.status === "ready" ? "listo" : model.status === "loading" ? "cargando" : "error";

      head.append(name, badge);

      const meta = document.createElement("div");
      meta.className = "model-meta";
      const parts: string[] = [`índice ${model.modelIndex}`];
      if (model.schema) parts.push(`esquema ${model.schema}`);
      if (model.entityCount !== undefined) parts.push(`${model.entityCount} entidades`);
      if (model.timings.parseMs !== undefined) parts.push(`parseo ${Math.round(model.timings.parseMs)} ms`);
      if (model.timings.geometryMs !== undefined) parts.push(`geometría ${Math.round(model.timings.geometryMs)} ms`);
      if (model.timings.firstRenderMs !== undefined) parts.push(`subida 3D ${Math.round(model.timings.firstRenderMs)} ms`);
      meta.textContent = parts.join(" · ");

      item.append(head, meta);

      if (model.errorMessage) {
        const error = document.createElement("div");
        error.className = "model-error";
        error.textContent = model.errorMessage;
        item.append(error);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Retirar";
      remove.addEventListener("click", () => viewer.removeModel(model.id));
      item.append(remove);

      modelsList.append(item);
    }

    const hasReady = models.some((model) => model.status === "ready");
    for (const button of [
      buttons.fit,
      buttons.projection,
      buttons.viewTop,
      buttons.viewFront,
      buttons.viewRight,
      buttons.plan,
      buttons.sectionX,
      buttons.sectionZ,
    ]) {
      button.disabled = !hasReady;
    }

    renderGeoreference(models);
    renderGis(models);
  };

  const renderGis = (models: readonly ModelRecord[]): void => {
    gis.update(models);
    // El contenedor puede haber cambiado de tamaño; Leaflet cachea las
    // dimensiones hasta que se le avisa explícitamente.
    gis.invalidate();

    const placed = gis.placements.length;
    const pending = gis.unplaced.length;

    if (placed === 0) {
      gisStatus.textContent =
        pending === 0
          ? "Sin modelos georreferenciados."
          : `${pending} modelo(s) sin georreferenciación utilizable: no se colocan en el mapa.`;
      return;
    }

    gisStatus.textContent =
      `${placed} modelo(s) colocados${pending > 0 ? `, ${pending} sin colocar` : ""}.` +
      " Clic en el marcador para ver CRS y coordenadas.";
  };

  const renderGeoreference = (models: readonly ModelRecord[]): void => {
    georefList.replaceChildren();
    const ready = models.filter((model) => model.status === "ready");

    if (ready.length === 0) {
      addDefinition(georefList, "Estado", "Sin modelos cargados.");
      return;
    }

    for (const model of ready) {
      const info = model.georeference;
      if (!info || !info.hasGeoreference) {
        addDefinition(georefList, model.fileName, "Sin georreferenciación declarada");
        continue;
      }

      const crs = info.projectedCRS;
      const crsText = crs
        ? [crs.name, crs.mapZone ? `huso ${crs.mapZone}` : null, crs.geodeticDatum]
            .filter((part): part is string => Boolean(part))
            .join(" · ")
        : "sin IfcProjectedCRS";
      addDefinition(georefList, `${model.fileName} · CRS`, crsText);

      // La librería NO expone un campo de código EPSG: el código sólo aparece
      // dentro del nombre/descripción del CRS. Es lo que habrá que alimentar a
      // Proj4js para el EPSG:25829 del roadmap.
      const haystack = [crs?.name, crs?.description, crs?.geodeticDatum, crs?.mapProjection]
        .filter((part): part is string => typeof part === "string")
        .join(" ");
      const epsg = haystack.match(EPSG_PATTERN);
      addDefinition(georefList, "Código EPSG detectado", epsg ? `EPSG:${epsg[1]}` : "no encontrado en el nombre del CRS");

      const conversion = info.mapConversion;
      if (conversion) {
        addDefinition(
          georefList,
          "Origen del mapa (E, N, h)",
          `${conversion.eastings.toFixed(3)}, ${conversion.northings.toFixed(3)}, ${conversion.orthogonalHeight.toFixed(3)}`,
        );
        if (conversion.scale !== undefined) {
          addDefinition(georefList, "Escala de conversión", String(conversion.scale));
        }
      }
      addDefinition(georefList, "Origen del dato", info.source ?? "desconocido");
    }
  };

  const renderSelection = (info: SelectionInfo | null): void => {
    propsBody.replaceChildren();

    const addRow = (label: string, value: string): void => {
      const row = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = label;
      const td = document.createElement("td");
      td.textContent = value;
      row.append(th, td);
      propsBody.append(row);
    };

    const addGroupHeader = (title: string): void => {
      const row = document.createElement("tr");
      row.className = "props-group";
      const cell = document.createElement("th");
      cell.colSpan = 2;
      cell.textContent = title;
      row.append(cell);
      propsBody.append(row);
    };

    if (!info) {
      addRow("Selección", "Haz clic sobre un elemento del modelo.");
      return;
    }

    addRow("Modelo", `${info.modelFileName ?? "no identificado"} (índice ${String(info.modelIndex)})`);
    addRow("expressId", String(info.expressId));
    addRow("Tipo IFC", info.ifcType ?? "desconocido");
    if (info.sharedAcrossModels) {
      addRow("Aviso", "El mismo expressId existe en otro modelo: la identidad es (modelIndex, expressId)");
    }

    if (info.propertiesError) {
      addRow("Propiedades", `No disponibles: ${info.propertiesError}`);
      return;
    }

    if (info.properties.length === 0) {
      addRow("Propiedades", "El elemento no declara conjuntos de propiedades.");
      return;
    }

    for (const group of info.properties) {
      addGroupHeader(group.name);
      for (const property of group.properties) {
        addRow(property.name, property.value);
      }
    }
  };

  const renderDiagnostic = (diagnostic: Diagnostic): void => {
    diagnosticList.replaceChildren();
    addDefinition(
      diagnosticList,
      "crossOriginIsolated",
      diagnostic.crossOriginIsolated ? "sí (SharedArrayBuffer disponible)" : "no (parseo single-thread)",
    );
    addDefinition(diagnosticList, "SharedArrayBuffer", diagnostic.sharedArrayBuffer ? "disponible" : "no disponible");
    addDefinition(diagnosticList, "navigator.gpu", diagnostic.webgpuNavigator ? "presente" : "ausente");
    addDefinition(diagnosticList, "Adaptador WebGPU", diagnostic.webgpuAdapter ? "obtenido" : "no disponible");
    addDefinition(diagnosticList, "Renderer 3D", diagnostic.rendererReady ? "inicializado" : "no inicializado");
    if (diagnostic.adapterInfo) {
      addDefinition(diagnosticList, "GPU", diagnostic.adapterInfo);
    }
    addDefinition(diagnosticList, "Navegador", diagnostic.userAgent);

    rendererState.textContent = diagnostic.rendererReady
      ? `Renderer: WebGPU${diagnostic.crossOriginIsolated ? " · aislado" : ""}`
      : "Renderer: sin WebGPU (modo degradado)";
  };

  renderSelection(null);
  renderGeoreference([]);

  return { log, renderModels, renderSelection, renderDiagnostic };
}
