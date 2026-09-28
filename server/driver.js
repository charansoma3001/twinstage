import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/* =========================================================================
   A driver child process speaking newline JSON on stdin/stdout.

   Both the arm and the base drivers use this. Lines that are not JSON are
   logged as-is (Python tracebacks, LeRobot's own prints). stderr is
   inherited so a crash is visible in the bridge's terminal.
   ========================================================================= */
export function spawnDriver({ cmd, args, tag, onMessage, onExit }) {
  const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
  // A driver that has just died still looks alive until its exit event, and a
  // write to its closed stdin raises EPIPE; unhandled, that kills the bridge
  // and with it every other driver. The exit handler deals with the death.
  proc.stdin.on("error", (err) => console.warn(`${tag} stdin: ${err.code || err.message}`));

  createInterface({ input: proc.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(tag, line);
      return;
    }
    onMessage(msg);
  });

  proc.on("exit", (code, signal) => {
    console.log(`${tag} driver exited (code ${code}, signal ${signal})`);
    onExit(code, signal);
  });
  proc.on("error", (err) => console.error(`${tag} spawn failed:`, err.message));

  return {
    proc,
    send(obj) {
      if (proc.stdin.destroyed) return false;
      proc.stdin.write(JSON.stringify(obj) + "\n");
      return true;
    }
  };
}
