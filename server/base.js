/* =========================================================================
   The LeKiwi base driver: drivers/lekiwi_base.py, over ssh on the base's Pi,
   or locally as a dry run. Browser-safe like arms.js: `spawn` and the
   script's base64 are passed in.
   ========================================================================= */
// One driver at a time: whoever last sent a non-zero drive owns the base until
// they have been idle for OWNER_MS. A stop is accepted from anyone.
export const OWNER_MS = 1000;

/* The shell command run on the Pi. The script travels as base64 in argv: no
   file to keep in sync on the Pi, and no quoting to get wrong. Neither the
   bracketed pkill pattern nor "$T:..." spells the tag literally, so pkill
   stops a stale driver without matching the shell that is running it. */
export function remoteCommand({ python, serial, tag, dry }, scriptB64) {
  const [pre, post] = tag.split(":");
  return `pkill -f '[${pre[0]}]${tag.slice(1)}' && sleep 0.5; T=${pre}; ` +
    `exec ${python} -u -c "import base64,sys; sys.argv[0]='lekiwi_base.py'; ` +
    `exec(compile(base64.b64decode('${scriptB64}'),'lekiwi_base.py','exec'),{'__name__':'__main__'})" ` +
    `--port ${serial} --tag "$T:${post}"${dry ? " --dry-run" : ""}`;
}

/* Drive ownership, separate from the process so it can be tested alone.
   decide() says whether a drive from `client` goes to the base. */
export function createOwnership(now = Date.now) {
  let owner = null;
  let at = 0;
  return {
    decide(client, v) {
      const t = now();
      const moving = v.some((x) => Math.abs(x) > 0.01);
      const ownerActive = owner && owner !== client && t - at < OWNER_MS;
      if (moving) {
        if (ownerActive) return "busy";
        owner = client;
        at = t;
      } else if (ownerActive) {
        // An idle client's key-up must not stop someone else who is driving.
        return "ignore";
      }
      return "send";
    },
    /* True when the leaving client was driving: the base should stop now. */
    release(client) {
      if (owner !== client) return false;
      owner = null;
      return true;
    }
  };
}

export function createBase({ config, broadcast, spawn, scriptB64 = null }) {
  const ownership = createOwnership();
  let driver = null;
  let ping = null;
  const state = { spawned: false, ready: false, dryRun: config.dry, host: config.host, last: null };

  const send = (obj) => (driver ? driver.send(obj) : false);

  function onMessage(msg) {
    if (msg.type === "ready") {
      state.ready = true;
      state.dryRun = !!msg.dry_run;
      console.log(`[base] ready (${msg.dry_run ? "dry run" : "LIVE"}), cap ${msg.max_lin} m/s, ${msg.max_rot} deg/s`);
    } else if (msg.type === "odom") {
      state.last = msg;
    } else {
      console.log("[base]", msg.type, msg.msg ?? "");
    }
    const { type: kind, ...rest } = msg;
    broadcast({ type: "base", kind, ...rest });
  }

  function start() {
    if (!config.host && !config.dry) {
      console.log("[bridge] BASE_HOST unset - no LeKiwi base");
      return;
    }
    let cmd, args;
    if (config.dry && !config.host) {
      cmd = config.localPython;
      args = ["-u", config.script, "--dry-run", "--tag", config.tag];
    } else {
      if (!scriptB64) {
        console.error(`[base] cannot read ${config.script}`);
        return;
      }
      cmd = "ssh";
      args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
        "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=3",
        config.host, remoteCommand(config, scriptB64)];
    }
    const where = config.host ? `on ${config.host}` : "locally";
    console.log(`[base] starting ${config.dry ? `dry run ${where}` : `LIVE ${where}:${config.serial}`}`);
    driver = spawn({
      cmd, args, tag: "[base]", onMessage,
      onExit: (code) => {
        clearInterval(ping);
        driver = null;
        state.ready = false;
        broadcast({ type: "base", kind: "exit", code });
      }
    });
    state.spawned = true;
    // The driver exits after 5 s without a line; the ping is what keeps an
    // idle base alive, and its absence is what frees the port if we die.
    ping = setInterval(() => send({ cmd: "ping" }), 1000);
  }

  function stop() {
    if (!driver) return;
    send({ cmd: "stop" });
    // Closing stdin is the clean path: the driver zeroes the wheels and closes
    // the bus itself. The kill is the fallback if it does not.
    const { proc } = driver;
    proc.stdin.end();
    setTimeout(() => proc.kill("SIGTERM"), 800).unref?.();
  }

  function drive(client, msg) {
    const v = [msg.x, msg.y, msg.w].map(Number);
    if (!v.every(Number.isFinite)) return;
    const verdict = ownership.decide(client, v);
    if (verdict === "busy") client.send(JSON.stringify({ type: "base", kind: "busy" }));
    if (verdict === "send") send({ cmd: "drive", x: v[0], y: v[1], w: v[2] });
  }

  /* A phone that locks mid-drive closes its socket; the base stops now
     rather than after the driver's watchdog. */
  function clientLeft(client) {
    if (ownership.release(client)) send({ cmd: "stop" });
  }

  return {
    start, stop, send, drive, clientLeft,
    view: () => ({ ...state, live: !!driver && !state.dryRun }),
    kill: () => driver?.proc.kill("SIGKILL")
  };
}
