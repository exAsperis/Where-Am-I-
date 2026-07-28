import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  player: {
    getMetadata: vi.fn(),
    getRole: vi.fn(),
    setMetadata: vi.fn(),
  },
  room: {
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  LEGACY_PLAYER_SETTINGS_METADATA_KEY,
  LEGACY_ROOM_SETTINGS_METADATA_KEY,
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";
import {
  readPlayerSettings,
  readRoomSettings,
  getPlayerSettings,
  getRoomSettings,
  setPlayerAutoFocusEnabled,
  setPlayerSingleTokenZoom,
  setPlayerTargetIndicatorEnabled,
} from "./metadata";

describe("metadata settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.player.setMetadata.mockResolvedValue(undefined);
    sdk.room.setMetadata.mockResolvedValue(undefined);
    sdk.player.getRole.mockResolvedValue("GM");
  });

  it("copies and clears legacy player settings when the new key is absent", async () => {
    sdk.player.getMetadata.mockResolvedValue({
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: false,
        singleTokenZoom: 0.75,
        targetIndicatorEnabled: false,
      },
    });
    await expect(getPlayerSettings()).resolves.toEqual({
      autoFocusEnabled: false,
      singleTokenZoom: 0.75,
      targetIndicatorEnabled: false,
    });
    expect(sdk.player.setMetadata).toHaveBeenCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: false,
        singleTokenZoom: 0.75,
        targetIndicatorEnabled: false,
      },
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: null,
    });
  });

  it("prefers new player settings and ignores malformed legacy settings", async () => {
    sdk.player.getMetadata.mockResolvedValue({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 1,
        targetIndicatorEnabled: true,
      },
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: "invalid",
    });
    await expect(getPlayerSettings()).resolves.toEqual({
      autoFocusEnabled: true,
      singleTokenZoom: 1,
      targetIndicatorEnabled: true,
    });
    expect(sdk.player.setMetadata).not.toHaveBeenCalled();

    sdk.player.getMetadata.mockResolvedValue({
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: { unexpected: true },
    });
    await expect(getPlayerSettings()).resolves.toEqual({
      autoFocusEnabled: true,
      singleTokenZoom: 0.5,
      targetIndicatorEnabled: true,
    });
    expect(sdk.player.setMetadata).not.toHaveBeenCalled();
  });

  it("copies GM room settings and only reads legacy room settings for players", async () => {
    sdk.room.getMetadata.mockResolvedValue({
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
    });
    await expect(getRoomSettings()).resolves.toEqual({ globalEnabled: false });
    expect(sdk.room.setMetadata).toHaveBeenCalledWith({
      [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: null,
    });

    vi.clearAllMocks();
    sdk.player.getRole.mockResolvedValue("PLAYER");
    sdk.room.getMetadata.mockResolvedValue({
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
    });
    await expect(getRoomSettings()).resolves.toEqual({ globalEnabled: false });
    expect(sdk.room.setMetadata).not.toHaveBeenCalled();
  });

  it("defaults missing or malformed settings to enabled", () => {
    expect(readPlayerSettings({}).autoFocusEnabled).toBe(true);
    expect(readPlayerSettings({}).singleTokenZoom).toBe(0.5);
    expect(readPlayerSettings({}).targetIndicatorEnabled).toBe(true);
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
          targetIndicatorEnabled: false,
        },
      }),
    ).toEqual({
      autoFocusEnabled: false,
      singleTokenZoom: 0.75,
      targetIndicatorEnabled: false,
    });
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
        targetIndicatorEnabled: false,
      },
    });

    await setPlayerAutoFocusEnabled(false);
    expect(sdk.player.setMetadata).toHaveBeenLastCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: false,
        singleTokenZoom: 0.75,
        targetIndicatorEnabled: false,
      },
    });

    await setPlayerSingleTokenZoom(1);
    expect(sdk.player.setMetadata).toHaveBeenLastCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 1,
        targetIndicatorEnabled: false,
      },
    });

    await setPlayerTargetIndicatorEnabled(true);
    expect(sdk.player.setMetadata).toHaveBeenLastCalledWith({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 0.75,
        targetIndicatorEnabled: true,
      },
    });
  });
});
