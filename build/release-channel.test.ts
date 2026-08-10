import { describe, expect, it } from "vitest";

import manifest from "../public/manifest.json";
import { parseReleaseChannel, transformManifest } from "./release-channel";

describe("release-channel manifest output", () => {
  it("keeps production identity unchanged", () => {
    expect(transformManifest(manifest, "production")).toEqual(manifest);
  });

  it("brands beta identity, host, and cache busters", () => {
    const beta = transformManifest(manifest, "beta");

    expect(beta.name).toBe("Where am I? (beta)");
    expect(beta.action.title).toBe("Where am I? (beta)");
    expect(beta.version).toBe(`${manifest.version}-beta`);
    for (const value of [
      beta.icon,
      beta.action.icon,
      beta.action.popover,
      beta.background_url,
    ]) {
      const url = new URL(value);
      expect(url.origin).toBe("https://where-am-i-beta.ex-asperis.com");
      expect(url.searchParams.get("v")).toBe(`${manifest.version}-beta`);
    }
  });

  it("rejects unsupported channels", () => {
    expect(parseReleaseChannel(undefined)).toBe("production");
    expect(parseReleaseChannel("beta")).toBe("beta");
    expect(() => parseReleaseChannel("preview")).toThrow(
      "Unsupported VITE_RELEASE_CHANNEL",
    );
  });
});
