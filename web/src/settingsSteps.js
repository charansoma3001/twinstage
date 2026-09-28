/* =========================================================================
   The settings page's setup steps.

   One panel is shown at a time, chosen by the URL fragment (#joint-map), so
   the docs can link straight to a step and the back button works. Each step
   in the rail carries a status tag the modules keep current through
   setStepStatus, so the rail doubles as the list of what is left to do.
   ========================================================================= */
const STEPS = ["connect", "cameras", "table", "joint-map", "layout", "sandbox"];
const DEFAULT_STEP = "connect";
const listeners = new Set();

export function currentStep() {
  const id = location.hash.slice(1);
  return STEPS.includes(id) ? id : DEFAULT_STEP;
}

/* fn(step) runs whenever the open step changes, and once now. */
export function onStepChange(fn) {
  listeners.add(fn);
  fn(currentStep());
}

function show() {
  const step = currentStep();
  for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== step;
  for (const a of document.querySelectorAll(".step[data-step]")) {
    if (a.dataset.step === step) a.setAttribute("aria-current", "step");
    else a.removeAttribute("aria-current");
  }
  document.querySelector(".panel")?.scrollTo(0, 0);
  for (const fn of listeners) fn(step);
}

/* tone: ok (done), warn (needs doing), bad (broken), dry, off (unknown). */
export function setStepStatus(step, text, tone = "off") {
  const tag = document.querySelector(`[data-status="${step}"]`);
  if (!tag) return;
  tag.textContent = text;
  tag.dataset.tone = tone;
}

export function initSteps() {
  window.addEventListener("hashchange", show);
  show();
}
