import { BASE_URL } from "./config.js";
import { createLandmarker, toLegacy } from "./handModel.js";

/* =========================================================================
   Hand tracking, shared by the stage and the settings page: MediaPipe Tasks
   (HandLandmarker) on the GPU, on the page's thread, loaded from this app's
   own files (no CDN, works offline).

   Measured on the demo laptop (M1, Chrome, one hand in view), which is why it
   is here and not in a worker:
     legacy @mediapipe/hands, page thread          70 ms/frame, 13 fps
     Tasks in a worker, GPU                         295 ms/frame,  3 fps
     Tasks in a worker, CPU                         110 ms/frame,  9 fps
     Tasks on the page, GPU, twin drawn at 1x       53 ms/frame, 17-18 fps
   A worker frees the page but Chrome gives it a slow GPU path, and the arms
   care about the tracking rate. The twin shares the GPU, so the stage draws
   it at 1x while hands are tracked (at 1.8x tracking fell to 10 fps).

   Results come back in the legacy { multiHandLandmarks, multiHandedness }
   shape, so calibration, retargeting and hand assignment did not change.
   ========================================================================= */
export function createHandTracker({ numHands, onResults }) {
  const tracker = { delegate: null, inferMs: 0, error: null, ready: null, send };
  let landmarker = null;
  let lastTs = 0;
  let warm = 0;

  tracker.ready = createLandmarker({
    wasmBase: new URL(`${BASE_URL}mediapipe`, location.origin).href,
    model: new URL(`${BASE_URL}mediapipe/hand_landmarker.task`, location.origin).href,
    numHands
  }).then((made) => {
    landmarker = made.landmarker;
    tracker.delegate = made.delegate;
    return made.delegate;
  }).catch((err) => {
    tracker.error = String(err?.message || err);
    throw err;
  });

  function send(video) {
    if (!landmarker || video.readyState < 2 || !video.videoWidth) return false;
    const t0 = performance.now();
    // VIDEO mode needs strictly increasing timestamps.
    const ts = Math.max(lastTs + 1, Math.round(t0));
    lastTs = ts;
    const result = landmarker.detectForVideo(video, ts);
    // The first frames compile GPU shaders; keep them out of the average.
    if (++warm > 5) {
      const ms = performance.now() - t0;
      tracker.inferMs = tracker.inferMs ? tracker.inferMs + 0.1 * (ms - tracker.inferMs) : ms;
    }
    onResults(toLegacy(result));
    return true;
  }

  return tracker;
}
