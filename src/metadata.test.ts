import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  player: {
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";
import {
  readPlayerSettings,
  readRoomSettings,
  setPlayerAutoFocusEnabled,
  setPlayerSingleTokenZoom,
} from "./metadata";

describe("metadata settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.player.setMetadata.mockResolvedValue(undefined);
  });

  it("defaults missing or malformed settings to enabled", () => {
    expect(readPlayerSettings({}).autoFocusEnabled).toBe(true);
    expect(readPlayerSettings({}).singleTokenZoom).toBe(0.5);
    expect(
      readPlayerSettings({
        [PLAYER_SETTINGS_METADATA_KEY]: { autoFocusEnabled: "yes" },
      }).autoFocusEnabled,
    ).toBe(true);
    expect(
      readPlayerSettings({
        [PLAYER_SETTINGS_METADATA_KEY]: { singleTokenZoom: "50%" },
      }).singleTokenZoom,
    ).toBe(0.5);
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
        [PLAYER_SETTINGS_METADATA_KEY]: {
          autoFocusEnabled: false,
          singleTokenZoom: 0.75,
        },
      }),
    ).toEqual({ autoFocusEnabled: false, singleTokenZoom: 0.75 });
    expect(
      readRoomSettings({
        [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
      }).globalEnabled,
    ).toBe(false);
  });

  it("preserves all personal settings when either preference changes", async () => {
    sdk.player.getMetadata.mockResolvedValue({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 0.75,
      },
    });

    await setPlayerAutoFocusEnabled(false);
    expect(sdk.player.setMetadata).toHaveBeenLastCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: false,
        singleTokenZoom: 0.75,
      },
    });

    await setPlayerSingleTokenZoom(1);
    expect(sdk.player.setMetadata).toHaveBeenLastCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 1,
      },
    });
  });
});
