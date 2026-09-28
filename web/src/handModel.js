import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

/* MediaPipe Tasks hand landmarker. Tries each delegate in order; returns the
   one that took. */
export async function createLandmarker({ wasmBase, model, numHands, delegates = ["GPU", "CPU"] }) {
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  let lastErr = null;
  for (const delegate of delegates) {
    try {
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: "VIDEO",
        numHands,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      return { landmarker, delegate };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function toLegacy(result) {
  return {
    multiHandLandmarks: result.landmarks,
    multiHandedness: result.handedness.map((h) => ({ label: h[0]?.categoryName, score: h[0]?.score ?? 0 }))
  };
}
