import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  player: {
    id: "player-1",
    getMetadata: vi.fn(),
    getRole: vi.fn(),
    setMetadata: vi.fn(),
  },
  room: {
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
  },
}));

const storedValues = new Map<string, string>();
const localStorage = {
  getItem: vi.fn((key: string) => storedValues.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storedValues.set(key, value);
  }),
};
vi.stubGlobal("localStorage", localStorage);

function storedPlayerSettings(): Record<string, unknown> {
  const value = [...storedValues.values()][0];
  if (!value) throw new Error("Expected stored player settings.");
  return JSON.parse(value) as Record<string, unknown>;
}

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import {
  LEGACY_PLAYER_SETTINGS_METADATA_KEY,
  LEGACY_ROOM_SETTINGS_METADATA_KEY,
  GM_HIGHLIGHT_SETTINGS_METADATA_KEY,
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
  setPlayerHighlightEnabled,
  setPlayerHighlightColor,
  setPlayerSettingsExpanded,
  setRoomHighlightColor,
  setShowMoveHere,
  resolveHighlightColor,
} from "./metadata";

describe("metadata settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedValues.clear();
    sdk.player.setMetadata.mockResolvedValue(undefined);
    sdk.room.setMetadata.mockResolvedValue(undefined);
    sdk.player.getRole.mockResolvedValue("GM");
  });

  it("imports legacy player settings into persistent browser storage", async () => {
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
      highlightEnabled: false,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
      settingsExpanded: false,
    });
    expect(storedPlayerSettings()).toEqual({
      autoFocusEnabled: false,
      singleTokenZoom: 0.75,
      highlightEnabled: false,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
      settingsExpanded: false,
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
      highlightEnabled: true,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
      settingsExpanded: false,
    });
    expect(sdk.player.setMetadata).not.toHaveBeenCalled();

    storedValues.clear();
    sdk.player.getMetadata.mockResolvedValue({
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: { unexpected: true },
    });
    await expect(getPlayerSettings()).resolves.toEqual({
      autoFocusEnabled: true,
      singleTokenZoom: 0.5,
      highlightEnabled: true,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
      settingsExpanded: false,
    });
    expect(sdk.player.setMetadata).not.toHaveBeenCalled();
  });

  it("copies GM room settings and only reads legacy room settings for players", async () => {
    sdk.room.getMetadata.mockResolvedValue({
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
    });
    await expect(getRoomSettings()).resolves.toEqual({
      globalEnabled: false,
      showMoveHere: false,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
    });
    expect(sdk.room.setMetadata).toHaveBeenCalledWith({
      [ROOM_SETTINGS_METADATA_KEY]: {
        globalEnabled: false,
        showMoveHere: false,
      },
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: null,
    });

    vi.clearAllMocks();
    sdk.player.getRole.mockResolvedValue("PLAYER");
    sdk.room.getMetadata.mockResolvedValue({
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
    });
    await expect(getRoomSettings()).resolves.toEqual({
      globalEnabled: false,
      showMoveHere: false,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
    });
    expect(sdk.room.setMetadata).not.toHaveBeenCalled();
  });

  it("defaults missing or malformed settings to enabled", () => {
    expect(readPlayerSettings({}).autoFocusEnabled).toBe(true);
    expect(readPlayerSettings({}).singleTokenZoom).toBe(0.5);
    expect(readPlayerSettings({}).highlightEnabled).toBe(true);
    expect(readPlayerSettings({}).settingsExpanded).toBe(false);
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
    expect(readRoomSettings({}).showMoveHere).toBe(false);
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
      highlightEnabled: false,
      highlightColorMode: "DEFAULT",
      highlightColor: "#fa5300",
      settingsExpanded: false,
    });
    expect(
      readRoomSettings({
        [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
      }).globalEnabled,
    ).toBe(false);
  });

  it("persists and preserves all personal settings across reads", async () => {
    sdk.player.getMetadata.mockResolvedValue({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        autoFocusEnabled: true,
        singleTokenZoom: 0.75,
        highlightEnabled: false,
        highlightColorMode: "DEFAULT",
        highlightColor: "#fa5300",
        settingsExpanded: false,
      },
    });

    await setPlayerAutoFocusEnabled(false);
    expect(storedPlayerSettings()).toMatchObject({
      autoFocusEnabled: false,
      singleTokenZoom: 0.75,
    });

    await setPlayerSingleTokenZoom(1);
    expect(storedPlayerSettings()).toMatchObject({
      autoFocusEnabled: false,
      singleTokenZoom: 1,
    });

    await setPlayerHighlightEnabled(true);
    expect(storedPlayerSettings()).toMatchObject({
      autoFocusEnabled: false,
      singleTokenZoom: 1,
      highlightEnabled: true,
    });

    await setPlayerSettingsExpanded(true);
    expect(storedPlayerSettings()).toMatchObject({
      highlightEnabled: true,
      settingsExpanded: true,
    });
    await expect(getPlayerSettings()).resolves.toMatchObject({
      autoFocusEnabled: false,
      singleTokenZoom: 1,
      highlightEnabled: true,
      settingsExpanded: true,
    });
    expect(sdk.player.getMetadata).toHaveBeenCalledTimes(1);
  });

  it("persists the GM Move here preference without changing global enablement", async () => {
    sdk.room.getMetadata.mockResolvedValue({
      [ROOM_SETTINGS_METADATA_KEY]: {
        globalEnabled: false,
        showMoveHere: false,
      },
    });

    await setShowMoveHere(true);

    expect(sdk.room.setMetadata).toHaveBeenLastCalledWith({
      [ROOM_SETTINGS_METADATA_KEY]: {
        globalEnabled: false,
        showMoveHere: true,
      },
    });
  });

  it("persists custom colors and resolves player defaults through the GM room color", async () => {
    sdk.player.getMetadata.mockResolvedValue({});
    await setPlayerHighlightColor("CUSTOM", "#12ABEF");
    expect(storedPlayerSettings()).toMatchObject({
      highlightColorMode: "CUSTOM",
      highlightColor: "#12abef",
    });

    await setRoomHighlightColor("CUSTOM", "#654321");
    expect(sdk.room.setMetadata).toHaveBeenLastCalledWith({
      [GM_HIGHLIGHT_SETTINGS_METADATA_KEY]: {
        highlightColorMode: "CUSTOM",
        highlightColor: "#654321",
      },
    });

    const player = readPlayerSettings({});
    const orangeRoom = readRoomSettings({});
    const customRoom = readRoomSettings({
      [GM_HIGHLIGHT_SETTINGS_METADATA_KEY]: {
        highlightColorMode: "CUSTOM",
        highlightColor: "#654321",
      },
    });
    expect(resolveHighlightColor("PLAYER", player, orangeRoom)).toBe("#fa5300");
    expect(resolveHighlightColor("PLAYER", player, customRoom)).toBe("#654321");
    expect(resolveHighlightColor("GM", player, orangeRoom)).toBe("#fa5300");
  });
});
