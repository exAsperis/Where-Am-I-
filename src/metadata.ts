import OBR, { type Metadata } from "@owlbear-rodeo/sdk";

import {
  DEFAULT_GLOBAL_ENABLED,
  DEFAULT_PLAYER_AUTO_FOCUS_ENABLED,
  PLAYER_SETTINGS_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
} from "./constants";

export interface PlayerSettings {
  autoFocusEnabled: boolean;
}

export interface RoomSettings {
  globalEnabled: boolean;
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
  return {
    autoFocusEnabled: readBooleanSetting(
      metadata,
      PLAYER_SETTINGS_METADATA_KEY,
      "autoFocusEnabled",
      DEFAULT_PLAYER_AUTO_FOCUS_ENABLED,
    ),
  };
}

export function readRoomSettings(metadata: Metadata): RoomSettings {
  return {
    globalEnabled: readBooleanSetting(
      metadata,
      ROOM_SETTINGS_METADATA_KEY,
      "globalEnabled",
      DEFAULT_GLOBAL_ENABLED,
    ),
  };
}

export async function getPlayerSettings(): Promise<PlayerSettings> {
  return readPlayerSettings(await OBR.player.getMetadata());
}

export async function setPlayerAutoFocusEnabled(
  autoFocusEnabled: boolean,
): Promise<void> {
  await OBR.player.setMetadata({
    [PLAYER_SETTINGS_METADATA_KEY]: { autoFocusEnabled },
  });
}

export async function getRoomSettings(): Promise<RoomSettings> {
  return readRoomSettings(await OBR.room.getMetadata());
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
