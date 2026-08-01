import OBR, { type Metadata } from "@owlbear-rodeo/sdk";

import {
  DEFAULT_GLOBAL_ENABLED,
  DEFAULT_PLAYER_AUTO_FOCUS_ENABLED,
  DEFAULT_SINGLE_TOKEN_ZOOM,
  DEFAULT_HIGHLIGHT_ENABLED,
  DEFAULT_SETTINGS_EXPANDED,
  GM_HIGHLIGHT_SETTINGS_METADATA_KEY,
  HIGHLIGHT_COLOR,
  LEGACY_PLAYER_SETTINGS_METADATA_KEY,
  LEGACY_ROOM_SETTINGS_METADATA_KEY,
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";
import { normalizeZoomScale } from "./domain";

export interface PlayerSettings {
  autoFocusEnabled: boolean;
  singleTokenZoom: number;
  highlightEnabled: boolean;
  settingsExpanded: boolean;
  highlightColorMode: "DEFAULT" | "CUSTOM";
  highlightColor: string;
}

export interface RoomSettings {
  globalEnabled: boolean;
  highlightColorMode: "DEFAULT" | "CUSTOM";
  highlightColor: string;
}

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidLegacyPlayerSettings(value: unknown): boolean {
  if (!isSettingsObject(value)) {
    return false;
  }
  return (
    typeof value.autoFocusEnabled === "boolean" ||
    typeof value.targetIndicatorEnabled === "boolean" ||
    typeof value.singleTokenZoom === "number"
  );
}

function isValidLegacyRoomSettings(value: unknown): boolean {
  return isSettingsObject(value) && typeof value.globalEnabled === "boolean";
}

function readColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : HIGHLIGHT_COLOR;
}

function readColorMode(value: unknown): "DEFAULT" | "CUSTOM" {
  return value === "CUSTOM" ? "CUSTOM" : "DEFAULT";
}

function readBooleanSetting(
  metadata: Metadata,
  key: string,
  property: string,
  fallback: boolean,
): boolean {
  const value = metadata[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallback;
  }

  const setting = (value as Record<string, unknown>)[property];
  return typeof setting === "boolean" ? setting : fallback;
}

export function readPlayerSettings(metadata: Metadata): PlayerSettings {
  const value =
    metadata[PLAYER_SETTINGS_METADATA_KEY] ??
    metadata[LEGACY_PLAYER_SETTINGS_METADATA_KEY];
  const settings = isSettingsObject(value) ? value : {};
  return {
    autoFocusEnabled: readBooleanSetting(
      metadata,
      metadata[PLAYER_SETTINGS_METADATA_KEY] == null
        ? LEGACY_PLAYER_SETTINGS_METADATA_KEY
        : PLAYER_SETTINGS_METADATA_KEY,
      "autoFocusEnabled",
      DEFAULT_PLAYER_AUTO_FOCUS_ENABLED,
    ),
    singleTokenZoom:
      "singleTokenZoom" in settings
        ? normalizeZoomScale(settings.singleTokenZoom)
        : DEFAULT_SINGLE_TOKEN_ZOOM,
    highlightEnabled:
      typeof settings.highlightEnabled === "boolean"
        ? settings.highlightEnabled
        : typeof settings.targetIndicatorEnabled === "boolean"
          ? settings.targetIndicatorEnabled
          : DEFAULT_HIGHLIGHT_ENABLED,
    settingsExpanded:
      typeof settings.settingsExpanded === "boolean"
        ? settings.settingsExpanded
        : DEFAULT_SETTINGS_EXPANDED,
    highlightColorMode: readColorMode(settings.highlightColorMode),
    highlightColor: readColor(settings.highlightColor),
  };
}

export function readRoomSettings(metadata: Metadata): RoomSettings {
  const key =
    metadata[ROOM_SETTINGS_METADATA_KEY] == null
      ? LEGACY_ROOM_SETTINGS_METADATA_KEY
      : ROOM_SETTINGS_METADATA_KEY;
  const highlightSettings = metadata[GM_HIGHLIGHT_SETTINGS_METADATA_KEY];
  const colors = isSettingsObject(highlightSettings) ? highlightSettings : {};
  return {
    globalEnabled: readBooleanSetting(
      metadata,
      key,
      "globalEnabled",
      DEFAULT_GLOBAL_ENABLED,
    ),
    highlightColorMode: readColorMode(colors.highlightColorMode),
    highlightColor: readColor(colors.highlightColor),
  };
}

export async function getPlayerSettings(): Promise<PlayerSettings> {
  const metadata = await OBR.player.getMetadata();
  const settings = readPlayerSettings(metadata);
  if (
    metadata[PLAYER_SETTINGS_METADATA_KEY] == null &&
    isValidLegacyPlayerSettings(metadata[LEGACY_PLAYER_SETTINGS_METADATA_KEY])
  ) {
    await OBR.player.setMetadata({
      [PLAYER_SETTINGS_METADATA_KEY]: {
        ...settings,
        targetIndicatorEnabled: settings.highlightEnabled,
      },
      [LEGACY_PLAYER_SETTINGS_METADATA_KEY]: null,
    });
  }
  return settings;
}

export async function updatePlayerSettings(
  update: Partial<PlayerSettings>,
): Promise<void> {
  const current = await getPlayerSettings();
  await OBR.player.setMetadata({
    [PLAYER_SETTINGS_METADATA_KEY]: {
      ...current,
      ...update,
      targetIndicatorEnabled:
        update.highlightEnabled ?? current.highlightEnabled,
      singleTokenZoom: normalizeZoomScale(
        update.singleTokenZoom ?? current.singleTokenZoom,
      ),
    },
  });
}

export async function setPlayerAutoFocusEnabled(
  autoFocusEnabled: boolean,
): Promise<void> {
  await updatePlayerSettings({ autoFocusEnabled });
}

export async function setPlayerSingleTokenZoom(
  singleTokenZoom: number,
): Promise<void> {
  await updatePlayerSettings({ singleTokenZoom });
}

export async function setPlayerHighlightEnabled(
  highlightEnabled: boolean,
): Promise<void> {
  await updatePlayerSettings({ highlightEnabled });
}

export async function setPlayerSettingsExpanded(
  settingsExpanded: boolean,
): Promise<void> {
  await updatePlayerSettings({ settingsExpanded });
}

export async function setPlayerHighlightColor(
  highlightColorMode: "DEFAULT" | "CUSTOM",
  highlightColor: string,
): Promise<void> {
  await updatePlayerSettings({
    highlightColorMode,
    highlightColor: readColor(highlightColor),
  });
}

export async function getRoomSettings(): Promise<RoomSettings> {
  const metadata = await OBR.room.getMetadata();
  const settings = readRoomSettings(metadata);
  if (
    metadata[ROOM_SETTINGS_METADATA_KEY] == null &&
    isValidLegacyRoomSettings(metadata[LEGACY_ROOM_SETTINGS_METADATA_KEY]) &&
    (await OBR.player.getRole()) === "GM"
  ) {
    await OBR.room.setMetadata({
      [ROOM_SETTINGS_METADATA_KEY]: {
        globalEnabled: settings.globalEnabled,
      },
      [LEGACY_ROOM_SETTINGS_METADATA_KEY]: null,
    });
  }
  return settings;
}

export async function setGlobalEnabled(globalEnabled: boolean): Promise<void> {
  const role = await OBR.player.getRole();
  if (role !== "GM") {
    throw new Error("Only a GM can update the global Where am I? setting.");
  }

  await OBR.room.setMetadata({
    [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled },
  });
}

export async function setRoomHighlightColor(
  highlightColorMode: "DEFAULT" | "CUSTOM",
  highlightColor: string,
): Promise<void> {
  if ((await OBR.player.getRole()) !== "GM") {
    throw new Error("Only a GM can update the room highlight color.");
  }
  await OBR.room.setMetadata({
    [GM_HIGHLIGHT_SETTINGS_METADATA_KEY]: {
      highlightColorMode,
      highlightColor: readColor(highlightColor),
    },
  });
}

export function resolveHighlightColor(
  role: "GM" | "PLAYER",
  playerSettings: PlayerSettings,
  roomSettings: RoomSettings,
): string {
  if (role === "GM") {
    return roomSettings.highlightColorMode === "CUSTOM"
      ? roomSettings.highlightColor
      : HIGHLIGHT_COLOR;
  }
  return playerSettings.highlightColorMode === "CUSTOM"
    ? playerSettings.highlightColor
    : roomSettings.highlightColorMode === "CUSTOM"
      ? roomSettings.highlightColor
      : HIGHLIGHT_COLOR;
}
