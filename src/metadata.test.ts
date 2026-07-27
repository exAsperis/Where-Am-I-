import { describe, expect, it, vi } from "vitest";

vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }));

import {
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";
import { readPlayerSettings, readRoomSettings } from "./metadata";

describe("metadata settings", () => {
  it("defaults missing or malformed settings to enabled", () => {
    expect(readPlayerSettings({}).autoFocusEnabled).toBe(true);
    expect(
      readPlayerSettings({
        [PLAYER_SETTINGS_METADATA_KEY]: { autoFocusEnabled: "yes" },
      }).autoFocusEnabled,
    ).toBe(true);
    expect(readRoomSettings({}).globalEnabled).toBe(true);
    expect(
      readRoomSettings({
        [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: null },
      }).globalEnabled,
    ).toBe(true);
  });

  it("reads valid false settings without conflating them with absence", () => {
    expect(
      readPlayerSettings({
        [PLAYER_SETTINGS_METADATA_KEY]: { autoFocusEnabled: false },
      }).autoFocusEnabled,
    ).toBe(false);
    expect(
      readRoomSettings({
        [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
      }).globalEnabled,
    ).toBe(false);
  });
});
