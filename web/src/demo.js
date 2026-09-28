import { state } from "./state.js";
import { targetBlock } from "./scene.js";
import { primitiveTarget, STATION_A, STATION_B } from "./primitives.js";
import {
  sliderGripper,
  setMode,
  syncSlidersAndLabels,
  syncHeightGaugeLinear,
  updateFromSliders,
  sliderX, sliderY, sliderZ, sliderPitch, sliderRoll,
  setTracking
} from "./ui.js";

/* =========================================================================
   DEMO TASK ROUTINES
   ========================================================================= */
// The studio picks wherever the virtual block sits (read at the start of each
// cycle) and alternates the drop-off between the two stations.
let pickCycle = -1;
let pickFrom = null;
const studioPick = {
  pickAt: (k) => {
    if (k !== pickCycle) {
      pickCycle = k;
      pickFrom = { x: targetBlock.position.x, z: targetBlock.position.z };
    }
    return pickFrom;
  },
  placeAt: (k) => (k % 2 === 0 ? STATION_A : STATION_B)
};

export function runDemoRoutine(routine, t) {
  const next = primitiveTarget(routine, t, studioPick);
  if (next) Object.assign(state.targetCartesian, next);

  syncSlidersAndLabels();
  document.getElementById("metric-pinch-bar").style.width = `${sliderGripper.value}%`;
  syncHeightGaugeLinear();
}

function startRoutine(routine, label) {
  pickCycle = -1;
  setMode("demo");
  state.activeDemoRoutine = routine;
  state.demoTime = 0;
  setTracking(label, "dry");
}

export function initDemos() {
  document.getElementById("btn-demo-pick").addEventListener("click", () => startRoutine("pickAndPlace", "Pick & place"));
  document.getElementById("btn-demo-pinch").addEventListener("click", () => startRoutine("pinchTest", "Precision pinch"));
  document.getElementById("btn-demo-wave").addEventListener("click", () => startRoutine("waveScan", "Waveform scan"));

  document.getElementById("btn-demo-rest").addEventListener("click", () => {
    setMode("interactive");
    sliderX.value = "0.0";
    sliderY.value = "0.14";
    sliderZ.value = "0.16";
    sliderPitch.value = "-55";
    sliderRoll.value = "0";
    sliderGripper.value = "0";
    updateFromSliders();
    setTracking("Rest");
  });

  document.getElementById("btn-spawn-cube").addEventListener("click", () => {
    targetBlock.position.set((Math.random() - 0.5) * 0.20, 0.0175, 0.20 + Math.random() * 0.08);
    state.isBlockGrasped = false;
  });
}
