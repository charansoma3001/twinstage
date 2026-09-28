import { state } from "./state.js";

/* =========================================================================
   CALIBRATION PERSISTENCE

   The 4-corner capture is a physical measurement of the rig -- camera height,
   table position, hand size -- none of which change between page loads, so
   re-walking the wizard after every reload is pure waste. Corners and the
   axis toggles are written to localStorage on every change and restored at
   startup.

   Storage is per-browser and can be unavailable (private windows, blocked
   site data), so every access is guarded and a failure just means the app
   falls back to the defaults in config.js.
   ========================================================================= */
const KEY = "twinstage:calibration:v1";

const CORNERS = ["tl", "tr", "br", "bl"];
const num = (v) => typeof v === "number" && Number.isFinite(v);

// A stored blob is only trusted if every corner carries a usable u, v and
// scale; a half-written or hand-edited entry falls back to the defaults
// rather than feeding NaN into the homography.
function validCornerSet(obj) {
  return !!obj && CORNERS.every((c) => obj[c] && num(obj[c].u) && num(obj[c].v) && num(obj[c].scale));
}

export function saveCalibration() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      tableCorners: state.calibration.tableCorners,
      hoverCorners: state.calibration.hoverCorners,
      isVideoMirrored: state.isVideoMirrored,
      isInvertX: state.isInvertX,
      isInvertZ: state.isInvertZ
    }));
    return true;
  } catch {
    return false;
  }
}

/* Returns true if a stored calibration was applied to state. */
export function loadCalibration() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return false;
  }
  if (!saved) return false;

  let applied = false;
  if (validCornerSet(saved.tableCorners)) {
    state.calibration.tableCorners = saved.tableCorners;
    applied = true;
  }
  if (validCornerSet(saved.hoverCorners)) {
    state.calibration.hoverCorners = saved.hoverCorners;
    applied = true;
  }
  for (const k of ["isVideoMirrored", "isInvertX", "isInvertZ"]) {
    if (typeof saved[k] === "boolean") { state[k] = saved[k]; applied = true; }
  }
  return applied;
}

export function clearCalibration() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored to clear */
  }
}
