/* =========================================================================
   STAGE PREFERENCES shared by the stage (/) and settings (/settings) pages

   Which camera is which and which hand drives which arm are properties of the
   rig on the day, like the 4-corner calibration, so they persist the same
   way: localStorage, guarded, falling back to defaults.
   ========================================================================= */
const KEY = "twinstage:stage:v1";

const DEFAULTS = {
  handsCameraId: "",
  followerCameraId: "",
  handsCameraRot: 0,      // degrees, 0 or 180: a camera mounted upside down
  followerCameraRot: 0,
  followerCameraMirror: false, // flip the follower's picture left to right
  camerasOpen: false,     // the stage's camera column, folded away by default
  leaderSide: "left",     // which half of the calibrated area, and which hand, drives the leader
  flipLabels: false,      // MediaPipe labels assume a selfie view; top-down can read them swapped
  armSpacingCm: 30,       // centre to centre of the two arms' bases, measured on the table
  minGapCm: 12            // closest the two grippers may come, across the midline
};

export function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null") || {};
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
    }
    if (out.leaderSide !== "left" && out.leaderSide !== "right") out.leaderSide = "left";
    for (const k of ["handsCameraRot", "followerCameraRot"]) {
      if (out[k] !== 0 && out[k] !== 180) out[k] = DEFAULTS[k];
    }
    for (const k of ["armSpacingCm", "minGapCm"]) {
      if (!Number.isFinite(out[k]) || out[k] < 0 || out[k] > 200) out[k] = DEFAULTS[k];
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the change holds for this page only */
  }
  return next;
}

/* Another tab changing the prefs (settings open next to the stage) arrives as
   a storage event; the stage re-reads rather than needing a reload. */
export function onPrefsChange(fn) {
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY) fn(loadPrefs());
  });
}

/* Labels only exist once the page has camera permission, so this asks for it
   with a throwaway stream when they come back blank. */
export async function listCameras() {
  let devices = await navigator.mediaDevices.enumerateDevices();
  let cams = devices.filter((d) => d.kind === "videoinput");
  if (cams.length && cams.every((c) => !c.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
      cams = devices.filter((d) => d.kind === "videoinput");
    } catch {
      /* permission refused: ids without labels still work */
    }
  }
  return cams.map((c, i) => ({ id: c.deviceId, label: c.label || `Camera ${i + 1}` }));
}

export async function openCamera(deviceId, { width = 1280, height = 720, frameRate } = {}) {
  const video = { width: { ideal: width }, height: { ideal: height } };
  if (frameRate) video.frameRate = { ideal: frameRate };
  if (deviceId) video.deviceId = { exact: deviceId };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    // A camera unplugged since it was chosen: fall back to any camera rather
    // than a blank panel, and say so.
    if (deviceId && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
      console.warn(`Camera ${deviceId} not found, using the default`);
      const { deviceId: _drop, ...rest } = video;
      return navigator.mediaDevices.getUserMedia({ video: rest, audio: false });
    }
    throw err;
  }
}
