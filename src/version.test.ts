import { describe, expect, it } from "vitest";

import { RELEASE_VERSION } from "./version";

describe("release version", () => {
  it("uses a semantic version", () => {
    expect(RELEASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
