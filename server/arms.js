
/* =========================================================================
   The SO-101 arm drivers: one drivers/so101_arm.py child per configured arm.

   The children die with the bridge, so there is no way to leave a
   torque-enabled arm running behind a dead bridge. A driver that exits on
   its own (bus lost, USB hiccup) is restarted with a growing delay, up to
   RESTART_MAX times a minute.

   Browser-safe: `spawn` starts a driver (driver.js's spawnDriver in the
   bridge, a simulated one in the Pages demo), so nothing here needs Node.
   ========================================================================= */
const RESTART_MAX = 5;

const basename = (p) => p.split(/[\\/]/).pop();

export function createArms({ config, python, script, dry, broadcast, onPresent, onDriverExit, spawn }) {
  const names = Object.keys(config);
  let shuttingDown = false;
  const arms = Object.fromEntries(names.map((name) => [name, {
    driver: null,
    restarts: [],
    state: { spawned: false, ready: false, dryRun: dry, relaxed: false, identityMap: true, last: null }
  }]));

  function onMessage(name, msg) {
    const tag = `[${name}]`;
    const a = arms[name];
    if (msg.type === "ready") {
      a.state.ready = true;
      a.state.dryRun = !!msg.dry_run;
      a.state.relaxed = !!msg.relaxed;
      a.state.identityMap = !!msg.identity_map;
      console.log(`${tag} ready on ${msg.port} (${msg.dry_run ? "dry run" : "LIVE"}), limits`, msg.limits);
      if (msg.identity_map) console.warn(`${tag} no ${basename(config[name].map)} - measure it in /settings before driving it from hands`);
    } else if (msg.type === "status") {
      a.state.last = msg;
      a.state.relaxed = !!msg.relaxed;
    } else if (msg.type === "present") {
      onPresent(name, msg);
    } else if (msg.type === "timing") {
      console.log(`${tag} loop ${msg.loop_p50}/${msg.loop_p95} ms (p50/p95 of ${msg.budget_ms} ms), ` +
        `bus ${msg.bus_p50}/${msg.bus_p95} ms, overruns ${msg.overruns}, bus errors ${msg.bus_errors}`);
    } else {
      console.log(tag, msg.type, msg.msg ?? "");
    }
    // Forward everything so the UI shows what the hardware is actually doing.
    broadcast({ type: "arm", ...msg, arm: name });
  }

  function onExit(name, code) {
    const tag = `[${name}]`;
    const a = arms[name];
    a.driver = null;
    a.state.ready = false;
    broadcast({ type: "arm", kind: "exit", code, arm: name });
    onDriverExit(name);
    if (shuttingDown || code === 0) return;
    const now = Date.now();
    a.restarts = a.restarts.filter((t) => now - t < 60000);
    if (a.restarts.length >= RESTART_MAX) {
      console.error(`${tag} exited ${RESTART_MAX} times in a minute - not restarting. Check the cable and power, then restart the bridge.`);
      broadcast({ type: "arm", kind: "gave_up", arm: name });
      return;
    }
    a.restarts.push(now);
    const delay = 1000 * a.restarts.length;
    console.log(`${tag} restarting in ${delay / 1000} s (${a.restarts.length}/${RESTART_MAX} this minute)`);
    broadcast({ type: "arm", kind: "restarting", in: delay, arm: name });
    setTimeout(() => { if (!shuttingDown && !a.driver) start(name); }, delay);
  }

  function start(name) {
    const cfg = config[name];
    if (!cfg.port) {
      console.log(`[bridge] ${cfg.portVar} unset - no ${name} arm`);
      return;
    }
    const args = [script, "--port", cfg.port, "--id", cfg.id, "--map", cfg.map];
    if (cfg.calibrationDir) args.push("--calibration-dir", cfg.calibrationDir);
    if (cfg.startRelaxed) args.push("--start-relaxed");
    if (dry) args.push("--dry-run");
    if (dry && cfg.dryPresent) args.push("--dry-present", cfg.dryPresent);
    console.log(`[${name}] spawning ${python} ${args.join(" ")}`);
    arms[name].driver = spawn({
      cmd: python, args, tag: `[${name}]`,
      onMessage: (msg) => onMessage(name, msg),
      onExit: (code) => onExit(name, code)
    });
    arms[name].state.spawned = true;
  }

  return {
    names,
    state: (name) => arms[name].state,
    has: (name) => name in arms,
    startAll: () => names.forEach(start),
    send(name, obj) {
      return arms[name]?.driver ? arms[name].driver.send(obj) : false;
    },
    view() {
      return Object.fromEntries(names.map((n) => [n, {
        ...arms[n].state, port: config[n].port, id: config[n].id,
        live: !!arms[n].driver && !arms[n].state.dryRun
      }]));
    },
    /* disable_torque_on_disconnect is on, so an arm relaxes at its last
       commanded pose rather than holding it. */
    stopAll(signal = "SIGINT") {
      shuttingDown = true;
      for (const n of names) arms[n].driver?.proc.kill(signal);
    }
  };
}
