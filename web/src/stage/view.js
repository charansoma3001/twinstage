import { createRenderer } from "../ui/sceneLook.js";
import { resizeBaseViewport } from "../baseTwin.js";
import * as twin from "./twin.js";
import { el } from "./state.js";

/* The one renderer the stage draws both twins (arms and base) with. */
export const container = el("stage-canvas");
export const renderer = createRenderer(container);
// The twin and hand tracking share the GPU: drawn at the display's 1.8x the
// twin halved tracking speed (100 ms/frame against 53 at 1x, measured), so it
// drops to 1x while hands are tracked and is sharp again otherwise.
const SHARP_DPR = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(SHARP_DPR);
export function setTrackingRender(tracking) {
  const want = tracking ? 1 : SHARP_DPR;
  if (renderer.getPixelRatio() !== want) {
    renderer.setPixelRatio(want);
    resize();
  }
}

export function resize() {
  renderer.setSize(container.clientWidth, container.clientHeight);
  twin.resize(container);
  resizeBaseViewport();
}
new ResizeObserver(resize).observe(container);
