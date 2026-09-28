import { IS_DEMO } from "../config.js";

/* In the Pages demo, say so in the header, with the way to the real thing. */
export const REPO_URL = "https://github.com/charansoma3001/twinstage";

export function showDemoBadge() {
  if (!IS_DEMO) return;
  const cluster = document.getElementById("header-status");
  if (!cluster) return;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.dataset.tone = "dry";
  tag.title = "Everything here runs in your browser: the bridge and the arm drivers are simulated.";
  tag.textContent = "Simulated arms";
  const code = document.createElement("a");
  code.className = "pill !h-9 !px-3 text-sm";
  code.href = REPO_URL;
  code.textContent = "Run it on your robot";
  // Its own full-width row on a phone, inline with the status pills from lg.
  const row = document.createElement("div");
  row.className = "order-2 w-full flex items-center gap-2 lg:order-none lg:w-auto";
  row.append(tag, code);
  cluster.prepend(row);
}
