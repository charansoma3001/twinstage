/* =========================================================================
   ROBOT KINEMATIC DEFINITION & 3D TABLE DIMENSIONS
   ========================================================================= */
export const CONFIG = {
  // Every number below is measured off so101_new_calib.urdf (onshape-to-robot
  // export) rather than estimated. See ARM for the derivation.
  limits: [
    { name: "J1 (Shoulder Pan)",   joint: "shoulder_pan",  min: -1.91986, max: 1.91986 },
    { name: "J2 (Shoulder Lift)",  joint: "shoulder_lift", min: -1.74533, max: 1.74533 },
    { name: "J3 (Elbow Flex)",     joint: "elbow_flex",    min: -1.69,    max: 1.69 },
    { name: "J4 (Wrist Flex)",     joint: "wrist_flex",    min: -1.65806, max: 1.65806 },
    { name: "J5 (Wrist Roll)",     joint: "wrist_roll",    min: -2.74385, max: 2.84121 },
    { name: "J6 (Gripper)",        joint: "gripper",       min: 0.0,      max: 1.74533 }
  ],
  workspace: {
    xMin: -0.22, xMax: 0.22,  // Side-to-side table width span (meters)
    zMin: 0.12,  zMax: 0.34,  // Near base to far forward reach span (meters)
    yMin: 0.000, yMax: 0.340  // Table contact plane to max overhead hover (meters)
  }
};

/* =========================================================================
   SO-101 ARM GEOMETRY, read off the URDF at its zero pose.

   shoulder_lift, elbow_flex and wrist_flex all turn about the same axis, so
   the arm is a planar 3R chain in the vertical plane that shoulder_pan swings
   around. Working in that plane, with rho measured radially from the pan axis
   and zeta measured up:

     shoulder_lift  rho 0.03039  zeta 0.11660   (offset from the pan axis)
     link 1  shoulder_lift -> elbow_flex   (0.02800, 0.11257)  |v| 0.11600
     link 2  elbow_flex    -> wrist_flex   (0.13490, 0.00520)  |v| 0.13500
     link 3  wrist_flex    -> tool point   (0.15923, 0      )  |v| 0.15923

   ZERO holds each link's in-plane heading at joint value 0. The pitch joints
   turn about +Y in URDF terms, which sweeps zeta towards rho, so a positive
   joint value *decreases* a link's in-plane heading -- hence the subtractions
   in solveSO101IK.

   The tool point is the point on the wrist_roll axis level with the URDF's
   gripper_frame_link. It sits on the roll axis, so unlike gripper_frame_link
   itself it does not swing as the wrist rolls; the declared TCP is a further
   7.9 mm off-axis, which is the jaw centre offset, not an IK error.
   ========================================================================= */
export const ARM = {
  panAxisOffsetZ: 0.0388353, // pan axis sits this far forward of base_link
  shoulderRho: 0.0303992485,
  shoulderZeta: 0.1165999515,
  L1: 0.1160000211,
  L2: 0.1350001852,
  L3: 0.1592272855,
  ZERO: {
    link1: 1.3270131068,  // 76.0345 deg
    link2: 0.0385279969,  //  2.2073 deg
    link3: 0.0            //  along the reach direction at zero
  },
  // Distance from the wrist_roll origin out to the tool point, along the axis.
  toolAlongRoll: 0.0981274,
  urdfUrl: "urdf/SO101/so101_new_calib.urdf"   // under BASE_URL
};

export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

// Default 4-corner bounding polygons in normalized camera UV space [0, 1]
export const DEFAULT_TABLE_CORNERS = () => ({
  tl: { u: 0.15, v: 0.15, scale: 0.16 }, // Top-Left (Far-Left Table)
  tr: { u: 0.85, v: 0.15, scale: 0.16 }, // Top-Right (Far-Right Table)
  br: { u: 0.85, v: 0.85, scale: 0.18 }, // Bottom-Right (Near-Right Table)
  bl: { u: 0.15, v: 0.85, scale: 0.18 }  // Bottom-Left (Near-Left Table)
});

export const DEFAULT_HOVER_CORNERS = () => ({
  tl: { u: 0.15, v: 0.15, scale: 0.28 },
  tr: { u: 0.85, v: 0.15, scale: 0.28 },
  br: { u: 0.85, v: 0.85, scale: 0.30 },
  bl: { u: 0.15, v: 0.85, scale: 0.30 }
});

export const WIZARD_STEPS = [
  { id: "tl", name: "Top-Left (Far-Left)", desc: "Place hand at Far-Left corner of the physical table." },
  { id: "tr", name: "Top-Right (Far-Right)", desc: "Place hand at Far-Right corner of the physical table." },
  { id: "br", name: "Bottom-Right (Near-Right)", desc: "Place hand at Near-Right corner closest to you." },
  { id: "bl", name: "Bottom-Left (Near-Left)", desc: "Place hand at Near-Left corner closest to you." }
];

/* Built for GitHub Pages (npm run build:demo): no bridge, simulated arms. */
export const IS_DEMO = !!(import.meta.env && import.meta.env.VITE_DEMO === "1");

// Where the built pages live: "/" normally, "/twinstage/" on GitHub Pages.
export const BASE_URL = (import.meta.env && import.meta.env.BASE_URL) || "/";

export const BRIDGE_URL =
  (import.meta.env && import.meta.env.VITE_BRIDGE_URL) || "ws://localhost:8787";

/* Optional presenter details for a live demo, set at build time
   (VITE_PRESENTER_NAME, _EVENT, _QR, _CAPTION). Anything unset stays hidden. */
const env = (import.meta.env) || {};
export const PRESENTER = {
  name: env.VITE_PRESENTER_NAME || "",
  event: env.VITE_PRESENTER_EVENT || "",
  qr: env.VITE_PRESENTER_QR || "",          // image URL, e.g. /my-qr.png in public/
  caption: env.VITE_PRESENTER_CAPTION || ""
};
