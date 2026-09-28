import { describe, it, expect } from "vitest";
import { createOwnership, remoteCommand, OWNER_MS } from "../base.js";

describe("base drive ownership", () => {
  it("gives the base to one driver at a time until they go idle", () => {
    let t = 0;
    const own = createOwnership(() => t);
    const phone = {}, laptop = {};
    expect(own.decide(phone, [0.1, 0, 0])).toBe("send");
    expect(own.decide(laptop, [0.1, 0, 0])).toBe("busy");
    // An idle client's key-up must not stop the one driving.
    expect(own.decide(laptop, [0, 0, 0])).toBe("ignore");
    t += OWNER_MS;
    expect(own.decide(laptop, [0.1, 0, 0])).toBe("send");
  });

  it("stops the base when the driving client leaves, not when another does", () => {
    const own = createOwnership(() => 0);
    const phone = {}, laptop = {};
    own.decide(phone, [0, 0.2, 0]);
    expect(own.release(laptop)).toBe(false);
    expect(own.release(phone)).toBe(true);
  });
});

describe("remote base command", () => {
  const cfg = { python: "~/lerobot/.venv/bin/python", serial: "/dev/ttyACM0", tag: "twinstage:lekiwi_base", dry: false };

  it("never spells the tag literally, so pkill cannot match its own shell", () => {
    const cmd = remoteCommand(cfg, "QUJD");
    expect(cmd).not.toContain(cfg.tag);
    expect(cmd).toContain("pkill -f '[t]winstage:lekiwi_base'");
    expect(cmd).toContain('--tag "$T:lekiwi_base"');
    expect(cmd).not.toContain("--dry-run");
  });

  it("passes the dry-run flag through", () => {
    expect(remoteCommand({ ...cfg, dry: true }, "QUJD")).toMatch(/--dry-run$/);
  });
});
