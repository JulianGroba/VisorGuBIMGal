import type { Renderer } from "@ifc-lite/renderer";
import type { LogLevel } from "./viewer";

/**
 * Control de navegación 3D sobre la cámara de IFC-Lite.
 *
 * La versión inicial de este spike sondeaba la cámara en tiempo de ejecución
 * porque la guía no documenta su API. Al leer los `.d.ts` publicados se
 * comprobó que `Camera` es API pública y completa (`orbit`, `pan`, `zoom`,
 * `setPresetView`…), así que aquí se usa directamente y el sondeo desaparece.
 *
 * Convenio de gestos:
 *   botón izquierdo        → órbita
 *   botón central/derecho  → desplazamiento (pan)
 *   Mayús + izquierdo      → desplazamiento
 *   rueda                  → zoom hacia el cursor
 *
 * Las convenciones de signo y sensibilidad de `orbit`/`pan`/`zoom` no están
 * documentadas con ejemplos numéricos: hay que compararlas con el visor de
 * referencia y ajustarlas (ver SPIKE-REPORT.md).
 */

export interface CameraControls {
  readonly enabled: boolean;
  dispose(): void;
}

const ORBIT_BUTTON = 0;
const PAN_BUTTONS = new Set([1, 2]);

export function attachCameraControls(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  requestRender: () => void,
  log: (message: string, level?: LogLevel) => void,
): CameraControls {
  const camera = renderer.getCamera();

  let mode: "orbit" | "pan" | null = null;
  let activePointer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (mode !== null) return;
    if (event.button !== ORBIT_BUTTON && !PAN_BUTTONS.has(event.button)) return;

    mode = PAN_BUTTONS.has(event.button) || event.shiftKey ? "pan" : "orbit";
    activePointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = mode === "orbit" ? "grabbing" : "move";
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (mode === null || event.pointerId !== activePointer) return;

    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (deltaX === 0 && deltaY === 0) return;

    if (mode === "orbit") {
      camera.orbit(deltaX, deltaY);
    } else {
      camera.pan(deltaX, deltaY);
    }
    requestRender();
  };

  const endGesture = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    mode = null;
    activePointer = null;
    canvas.style.cursor = "default";
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // `zoom` documenta: delta positivo = alejar. El factor 100 es una primera
    // aproximación a la sensibilidad por muesca de rueda.
    camera.zoom(
      event.deltaY / 100,
      false,
      event.clientX - rect.left,
      event.clientY - rect.top,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    requestRender();
  };

  const onContextMenu = (event: MouseEvent): void => {
    // El botón derecho hace desplazamiento: se anula el menú contextual.
    event.preventDefault();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);

  log("Navegación activa: izquierdo órbita · central/derecho o Mayús+izquierdo desplazar · rueda zoom.");

  return {
    enabled: true,
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endGesture);
      canvas.removeEventListener("pointercancel", endGesture);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
