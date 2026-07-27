import { describe, expect, it } from "vitest";

import { SceneReadinessTrigger } from "./readiness";

describe("scene readiness trigger", () => {
  it("focuses once when initialization finds a ready scene", () => {
    const trigger = new SceneReadinessTrigger();
    expect(trigger.observe(true)).toBe(true);
    expect(trigger.observe(true)).toBe(false);
  });

  it("focuses once when a scene transition becomes ready", () => {
    const trigger = new SceneReadinessTrigger();
    expect(trigger.observe(false)).toBe(false);
    expect(trigger.observe(false)).toBe(false);
    expect(trigger.observe(true)).toBe(true);
    expect(trigger.observe(true)).toBe(false);
    expect(trigger.observe(false)).toBe(false);
    expect(trigger.observe(true)).toBe(true);
  });
});
