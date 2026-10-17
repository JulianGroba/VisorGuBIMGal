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
 * Unidades de los deltas (leídas de `constants.js` del paquete, no supuestas):
 *
 *   ORBIT_SENSITIVITY     0.01   radianes por píxel
 *   PAN_SPEED_MULTIPLIER  0.001  × distancia de la cámara (por píxel)
 *   ZOOM_SENSITIVITY      0.001  y MAX_ZOOM_DELTA 0.1
 *
 * Es decir, las tres esperan **píxeles de movimiento del ratón**. En el zoom la
 * consecuencia es literal: `normalizedDelta = signo × min(|delta| × 0.001, 0.1)`,
 * así que una muesca de rueda de Chrome (`deltaY = 100`) satura el tope del 10 %
 * y 100 píxeles es exactamente «una muesca al máximo». La primera versión del
 * spike pasaba `deltaY / 100`: cada muesca hacía un 0,1 %, cien veces menos, y
 * el zoom parecía roto. Aquí se pasan píxeles.
 *
 * Convenio de gestos:
 *   rueda                  → zoom hacia el cursor (Ctrl: precisión, Mayús: dolly puro)
 *   botón izquierdo        → órbita
 *   botón central/derecho  → desplazamiento (pan)
 *   Mayús + izquierdo      → desplazamiento
 */

export interface CameraControls {
  readonly enabled: boolean;
  dispose(): void;
}

const ORBIT_BUTTON = 0;
const PAN_BUTTONS = new Set([1, 2]);

/**
 * Píxeles equivalentes a una línea de rueda. Firefox entrega `deltaMode = 1`
 * con valores del orden de 3 (una muesca ≈ 3 líneas); 33 los convierte en los
 * ~100 px de una muesca de Chrome, que es la referencia del paquete.
 */
const PIXELS_PER_LINE = 33;

/** Factor de precisión para Ctrl/Cmd + rueda. */
const PRECISION_FACTOR = 0.25;

/**
 * Convierte el desplazamiento de rueda a píxeles, que es lo que espera
 * `Camera.zoom`. `deltaMode` distingue píxeles (0), líneas (1) y páginas (2).
 */
function wheelDeltaToPixels(event: WheelEvent, canvasHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * PIXELS_PER_LINE;
  if (event.deltaMode === 2) return event.deltaY * canvasHeight;
  return event.deltaY;
}

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
    // Sin `preventDefault` el navegador desplaza la página y hace zoom de página
    // con Ctrl, que es justo el gesto de precisión que usamos aquí.
    event.preventDefault();

    const precision = event.ctrlKey || event.metaKey;
    const pixels = wheelDeltaToPixels(event, canvas.clientHeight) * (precision ? PRECISION_FACTOR : 1);
    if (!Number.isFinite(pixels) || pixels === 0) return;

    const rect = canvas.getBoundingClientRect();
    camera.zoom(
      pixels,
      // Sin inercia: una muesca es un paso discreto y predecible. Los pequeños
      // deltas de un panel táctil ya llegan a alta frecuencia y salen suaves.
      false,
      // Ancla en el cursor: el punto bajo el ratón se queda quieto al acercarse.
      event.clientX - rect.left,
      event.clientY - rect.top,
      canvas.clientWidth,
      canvas.clientHeight,
      // Mayús: dolly puro (acercamiento recto, sin acercarse al cursor).
      event.shiftKey,
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

  log(
    "Navegación: izquierdo órbita · central/derecho o Mayús+izquierdo desplazar · rueda zoom (Ctrl precisión, Mayús dolly).",
  );

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
