import "./style.css";
import { mountUi, type Ui } from "./ui";
import { IfcViewer, type Diagnostic, type LogLevel, type ModelRecord, type SelectionInfo } from "./viewer";

/**
 * Punto de entrada del spike (Fase 0).
 *
 * El visor se inicializa antes de montar la UI, así que los eventos que emite
 * durante el arranque (logs y diagnóstico) se guardan en un búfer y se vuelcan
 * en cuanto la interfaz está lista.
 */

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("No se encontró el canvas #canvas en index.html");
}

let ui: Ui | null = null;

const pending = {
  logs: [] as Array<{ message: string; level: LogLevel }>,
  models: [] as readonly ModelRecord[],
  selection: null as SelectionInfo | null,
  diagnostic: null as Diagnostic | null,
};

const viewer = new IfcViewer(canvas, {
  onModelsChanged: (models) => {
    pending.models = models;
    ui?.renderModels(models);
  },
  onSelection: (info) => {
    pending.selection = info;
    ui?.renderSelection(info);
  },
  onLog: (message, level) => {
    const resolved: LogLevel = level ?? "info";
    if (ui) ui.log(message, resolved);
    else pending.logs.push({ message, level: resolved });
  },
  onDiagnostic: (diagnostic) => {
    pending.diagnostic = diagnostic;
    ui?.renderDiagnostic(diagnostic);
  },
});

await viewer.init();

ui = mountUi(viewer);

for (const entry of pending.logs) {
  ui.log(entry.message, entry.level);
}
pending.logs.length = 0;

ui.renderModels(pending.models);
ui.renderSelection(pending.selection);
if (pending.diagnostic) {
  ui.renderDiagnostic(pending.diagnostic);
}

if (!viewer.isRendererReady) {
  ui.log(
    "Este equipo no tiene WebGPU: se puede cargar el IFC, consultar propiedades y exportar planos/DXF, pero no hay vista 3D.",
    "warn",
  );
}
