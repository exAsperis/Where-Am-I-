import OBR, { type Metadata } from "@owlbear-rodeo/sdk";

import {
  DEFAULT_GLOBAL_ENABLED,
  DEFAULT_PLAYER_AUTO_FOCUS_ENABLED,
  DEFAULT_SINGLE_TOKEN_ZOOM,
  DEFAULT_TARGET_INDICATOR_ENABLED,
  LEGACY_PLAYER_SETTINGS_METADATA_KEY,
  LEGACY_ROOM_SETTINGS_METADATA_KEY,
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";
import { normalizeZoomScale } from "./domain";

export interface PlayerSettings {
  autoFocusEnabled: boolean;
  singleTokenZoom: number;
  targetIndicatorEnabled: boolean;
}

export interface RoomSettings {
  globalEnabled: boolean;
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
    targetIndicatorEnabled: readBooleanSetting(
      metadata,
      metadata[PLAYER_SETTINGS_METADATA_KEY] == null
        ? LEGACY_PLAYER_SETTINGS_METADATA_KEY
        : PLAYER_SETTINGS_METADATA_KEY,
      "targetIndicatorEnabled",
      DEFAULT_TARGET_INDICATOR_ENABLED,
    ),
  };
}

export function readRoomSettings(metadata: Metadata): RoomSettings {
  const key =
    metadata[ROOM_SETTINGS_METADATA_KEY] == null
      ? LEGACY_ROOM_SETTINGS_METADATA_KEY
      : ROOM_SETTINGS_METADATA_KEY;
  return {
    globalEnabled: readBooleanSetting(
      metadata,
      key,
      "globalEnabled",
      DEFAULT_GLOBAL_ENABLED,
    ),
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
      [PLAYER_SETTINGS_METADATA_KEY]: settings,
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

export async function setPlayerTargetIndicatorEnabled(
  targetIndicatorEnabled: boolean,
): Promise<void> {
  await updatePlayerSettings({ targetIndicatorEnabled });
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
      [ROOM_SETTINGS_METADATA_KEY]: settings,
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
