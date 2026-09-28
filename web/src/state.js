import { DEFAULT_TABLE_CORNERS, DEFAULT_HOVER_CORNERS } from "./config.js";

/* Single mutable app state object. Kept as one object so ES module live
   bindings never get in the way of the hot animation loop. */
export const state = {
  currentMode: "interactive", // "interactive" | "webcam" | "demo"
  currentJoints: [0, 0, 0, 0, 0, 0.8],
  targetCartesian: { x: 0.0, y: 0.22, z: 0.24, pitch: -90 * Math.PI / 180, roll: 0.0, gripper: 0.8 },
  filteredCartesian: { x: 0.0, y: 0.22, z: 0.24, pitch: -90 * Math.PI / 180, roll: 0.0, gripper: 0.8 },
  emaAlpha: 0.35,
  demoTime: 0,
  activeDemoRoutine: null,
  isBlockGrasped: false,

  // Display & Orientation Inversions
  isVideoMirrored: false,
  isInvertX: true,
  isInvertZ: false,

  // 4-corner table & max hover calibration data
  calibration: {
    activeTab: "table",  // "table" | "hover"
    wizardStep: 0,       // 0: TL, 1: TR, 2: BR, 3: BL
    tableCorners: DEFAULT_TABLE_CORNERS(),
    hoverCorners: DEFAULT_HOVER_CORNERS()
  },

  currentLiveRigidPalm: 0.18,
  currentLivePalmCenter: { u: 0.5, v: 0.5 },
  isWebcamRunning: false
};
