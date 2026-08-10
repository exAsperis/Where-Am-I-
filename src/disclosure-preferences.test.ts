import { describe, expect, it } from "vitest";

import {
  readDisclosurePreference,
  writeDisclosurePreference,
} from "./disclosure-preferences";

describe("settings disclosure preferences", () => {
  it("defaults to expanded when no preference exists", () => {
    expect(
      readDisclosurePreference("settings", () => ({
        getItem: () => null,
        setItem: () => undefined,
      })),
    ).toBe(true);
  });

  it("restores independently saved disclosure states", () => {
    const values = new Map([
      ["room", "false"],
      ["mine", "true"],
    ]);
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(readDisclosurePreference("room", storage)).toBe(false);
    expect(readDisclosurePreference("mine", storage)).toBe(true);
  });

  it("writes changes for a later controller load", () => {
    const values = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    writeDisclosurePreference("room", false, storage);

    expect(readDisclosurePreference("room", storage)).toBe(false);
  });

  it("falls back safely when storage is unavailable or malformed", () => {
    expect(
      readDisclosurePreference("settings", () => {
        throw new Error("storage denied");
      }),
    ).toBe(true);
    expect(
      readDisclosurePreference("settings", () => ({
        getItem: () => "invalid",
        setItem: () => undefined,
      })),
    ).toBe(true);
    expect(() =>
      writeDisclosurePreference("settings", false, () => {
        throw new Error("storage denied");
      }),
    ).not.toThrow();
  });
});
