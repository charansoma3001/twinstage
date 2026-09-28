import { CONFIG } from "./config.js";
import { state } from "./state.js";

/* =========================================================================
   4-CORNER BILINEAR HOMOGRAPHY & RETARGETING ENGINE
   ========================================================================= */
// Thumb-spread range, in degrees at the wrist, mapped onto the jaw stroke.
// Measured poses sit near 3 deg (thumb in) and 37 deg (thumb wide); the band
// is pulled inside those so both ends saturate with margin to spare and a
// fully-open or fully-closed command is easy to hold.
const SPREAD_CLOSED_DEG = 8;
const SPREAD_OPEN_DEG = 34;

function cross2D(a, b) {
  return a.x * b.y - a.y * b.x;
}

// Compute inverse bilinear coordinates (s, t) in [0, 1] for a point inside an arbitrary quadrilateral
export function inverseBilinear(p, p00, p10, p11, p01) {
  // p00: TL (0,0), p10: TR (1,0), p11: BR (1,1), p01: BL (0,1)
  const e = { x: p10.u - p00.u, y: p10.v - p00.v };
  const f = { x: p01.u - p00.u, y: p01.v - p00.v };
  const g = { x: p00.u - p10.u + p11.u - p01.u, y: p00.v - p10.v + p11.v - p01.v };
  const h = { x: p.u - p00.u, y: p.v - p00.v };

  const k2 = cross2D(g, f);
  const k1 = cross2D(e, f) + cross2D(h, g);
  const k0 = cross2D(h, e);

  let v = 0.5;
  if (Math.abs(k2) < 1e-6) {
    v = -k0 / (k1 || 1e-6);
  } else {
    const disc = k1 * k1 - 4 * k2 * k0;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const v1 = (-k1 + root) / (2 * k2);
      const v2 = (-k1 - root) / (2 * k2);
      v = (v1 >= -0.2 && v1 <= 1.2) ? v1 : v2;
    }
  }

  const u_num = h.x - f.x * v;
  const u_den = e.x + g.x * v;
  let u = u_den !== 0 ? u_num / u_den : 0.5;

  return {
    s: Math.max(-0.2, Math.min(1.2, u)), // Left-to-Right [0..1]
    t: Math.max(-0.2, Math.min(1.2, v))  // Top-to-Bottom [0..1]
  };
}

/* Settings-page entry point: one hand, the whole calibrated area. Records the
   live palm so the calibration wizard can capture it. */
export function processOverheadLandmarks(landmarks) {
  const r = retargetHand(landmarks);
  state.currentLiveRigidPalm = r.palm.scale;
  state.currentLivePalmCenter = { u: r.palm.u, v: r.palm.v };
  return r;
}

/* One hand -> one arm's Cartesian target.

   `region` is the slice of the calibrated table, left to right in the user's
   frame, that this arm's hand works in. The two-handed stage gives each arm
   half ([0, 0.5] or [0.5, 1]) and stretches that half over the arm's whole
   workspace. Height still reads the corner scales at the hand's true position
   in the full quad, because that is where the camera actually sees it. */
export function retargetHand(landmarks, region = { s0: 0, s1: 1 }) {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMCP = landmarks[5];
  const middleMCP = landmarks[9];
  const pinkyMCP = landmarks[17];

  // 1. INVARIANT RIGID PALM METRIC:
  const palmLen = Math.hypot(middleMCP.x - wrist.x, middleMCP.y - wrist.y);
  const knuckleSpan = Math.hypot(pinkyMCP.x - indexMCP.x, pinkyMCP.y - indexMCP.y);
  const livePalm = (palmLen + knuckleSpan) / 2.0 || 0.18;

  // 2. THUMB SPREAD -> GRIPPER APERTURE (0.0 closed .. 1.0 open):
  // Thumb held wide of the fingers opens the jaws, thumb brought in alongside
  // the index finger closes them, and everything between is a part-open jaw.
  // The signal is the angle at the wrist between the thumb tip and the index
  // knuckle -- an angle, so it is immune to hand height, palm size and the
  // foreshortening that makes a thumb-index pinch unreadable from overhead.
  // Thumb wide reads around 37 deg, thumb in alongside the index reads ~3 deg.
  const spreadDeg = Math.abs(
    Math.atan2(thumbTip.y - wrist.y, thumbTip.x - wrist.x) -
    Math.atan2(indexMCP.y - wrist.y, indexMCP.x - wrist.x)
  ) * (180 / Math.PI);
  const thumbSpread = spreadDeg > 180 ? 360 - spreadDeg : spreadDeg;

  // Proportional, not a switch: the whole 8-34 deg span maps onto the jaw
  // stroke, so part-open grips are available and the jaws track the thumb
  // continuously. The ends clamp, so thumb fully in and thumb fully wide are
  // still unambiguous full-close and full-open commands.
  const pinchAperture = Math.max(0.0, Math.min(1.0,
    (thumbSpread - SPREAD_CLOSED_DEG) / (SPREAD_OPEN_DEG - SPREAD_CLOSED_DEG)));

  // 3. PALM CENTROID IN NORMALIZED CAMERA UV SPACE:
  let cu = (wrist.x + indexMCP.x + middleMCP.x + pinkyMCP.x) / 4.0;
  let cv = (wrist.y + indexMCP.y + middleMCP.y + pinkyMCP.y) / 4.0;

  if (state.isVideoMirrored) {
    cu = 1.0 - cu;
  }

  // 4. 4-CORNER PERSPECTIVE HOMOGRAPHY REMAPPING:
  const tc = state.calibration.tableCorners;
  const hc = state.calibration.hoverCorners;

  // Solve inverse bilinear coordinates (s: 0..1 left-to-right, t: 0..1 top-to-bottom)
  const coord = inverseBilinear({ u: cu, v: cv }, tc.tl, tc.tr, tc.br, tc.bl);

  let s_clamped = Math.max(0.0, Math.min(1.0, coord.s));
  let t_clamped = Math.max(0.0, Math.min(1.0, coord.t));
  // Position in the full quad, for the height lookup and for display.
  const sQuad = s_clamped, tQuad = t_clamped;

  // Stretch this arm's slice of the table over its whole side-to-side reach.
  let sArm = Math.max(0.0, Math.min(1.0, (s_clamped - region.s0) / (region.s1 - region.s0)));

  if (state.isInvertX) sArm = 1.0 - sArm;
  if (state.isInvertZ) t_clamped = 1.0 - t_clamped;

  // Map (s, t) directly to calibrated 3D table workspace [X, Z]:
  // s: 0 (Left) -> Xmin, 1 (Right) -> Xmax
  // t: 0 (Far Reach / Top of Table) -> Zmax, 1 (Near Base / Bottom of Table) -> Zmin
  const rx = CONFIG.workspace.xMin + sArm * (CONFIG.workspace.xMax - CONFIG.workspace.xMin);
  const rz = CONFIG.workspace.zMax - t_clamped * (CONFIG.workspace.zMax - CONFIG.workspace.zMin);

  // 5. BILINEAR INTERPOLATED PALM SCALE (HEIGHT / CAMERA Z):
  // Interpolate expected table baseline and hover ceiling scale at current (s, t)
  const tableBaseAtPos = (1 - sQuad) * (1 - tQuad) * tc.tl.scale +
                         sQuad * (1 - tQuad) * tc.tr.scale +
                         sQuad * tQuad * tc.br.scale +
                         (1 - sQuad) * tQuad * tc.bl.scale;

  const hoverBaseAtPos = (1 - sQuad) * (1 - tQuad) * hc.tl.scale +
                         sQuad * (1 - tQuad) * hc.tr.scale +
                         sQuad * tQuad * hc.br.scale +
                         (1 - sQuad) * tQuad * hc.bl.scale;

  const scaleRange = Math.max(0.03, hoverBaseAtPos - tableBaseAtPos);
  const heightRatio = Math.max(0.0, Math.min(1.0, (livePalm - tableBaseAtPos) / scaleRange));
  const ry = CONFIG.workspace.yMin + heightRatio * (CONFIG.workspace.yMax - CONFIG.workspace.yMin);

  // 6. APPROACH PITCH: always ask for straight down.
  // A top-down approach is what actually grasps a block off the table, and it
  // keeps the arm from folding shoulder-into-elbow the way a shallow request
  // does. It is only a request -- solveSO101IK relaxes it towards level
  // wherever straight down is out of reach (mostly high up in the hover zone).
  const pitchDeg = -90;

  // Wrist roll is parked at zero for now: with the palm flat the jaws should
  // stay in their neutral orientation. Mapping hand rotation onto the 90-degree
  // roll case comes later.
  const rollDeg = 0;

  return {
    cartesian: {
      x: Math.max(CONFIG.workspace.xMin - 0.02, Math.min(CONFIG.workspace.xMax + 0.02, rx)),
      y: Math.max(CONFIG.workspace.yMin, Math.min(CONFIG.workspace.yMax, ry)),
      z: Math.max(CONFIG.workspace.zMin, Math.min(CONFIG.workspace.zMax, rz)),
      pitch: (Math.max(-90, Math.min(60, pitchDeg)) * Math.PI) / 180,
      roll: (Math.max(-90, Math.min(90, rollDeg)) * Math.PI) / 180,
      gripper: pinchAperture
    },
    pinch: pinchAperture,
    thumbSpread,
    palm: { u: cu, v: cv, scale: livePalm },
    quad: { s: sQuad, t: tQuad },
    heightGaugePct: Math.round(heightRatio * 100),
    angles: { pitch: pitchDeg, roll: rollDeg }
  };
}
