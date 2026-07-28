import type {
  BoundingBox,
  Image,
  Item,
  Player,
  Vector2,
} from "@owlbear-rodeo/sdk";

import {
  DEFAULT_SINGLE_TOKEN_ZOOM,
  MAX_SINGLE_TOKEN_ZOOM,
  MIN_SINGLE_TOKEN_ZOOM,
} from "./constants";

export interface CharacterItem {
  id: string;
  layer: Item["layer"];
  visible: boolean;
  createdUserId: string;
  name: string;
}

export interface CharacterDisplay {
  imageUrl?: string;
  tokenText?: string;
  characterName: string;
}

function isImageToken(item: Item): item is Image {
  return item.type === "IMAGE";
}

export function isCharacter(item: Pick<Item, "layer">): boolean {
  return item.layer === "CHARACTER";
}

export interface PartyPlayer {
  id: string;
  connectionId: string;
  role: Player["role"];
  color: string;
  name: string;
}

export function isVisibleCharacter(
  item: Pick<Item, "layer" | "visible">,
): boolean {
  return isCharacter(item) && item.visible;
}

export function filterCharacterTokens<T extends Pick<Item, "layer">>(
  items: readonly T[],
): T[] {
  return items.filter(isCharacter);
}

export function getCharacterDisplay(item: Item): CharacterDisplay {
  const tokenText = isImageToken(item) ? item.text.plainText.trim() : "";
  const imageUrl = isImageToken(item) ? item.image.url.trim() : "";
  return {
    ...(imageUrl ? { imageUrl } : {}),
    ...(tokenText ? { tokenText } : {}),
    characterName: formatCharacterName(item.name),
  };
}

export function filterVisibleOwnedCharacters<T extends CharacterItem>(
  items: readonly T[],
  targetPlayerId: string,
): T[] {
  return items.filter(
    (item) => isVisibleCharacter(item) && item.createdUserId === targetPlayerId,
  );
}

export function filterVisiblePartyCharacters<T extends CharacterItem>(
  items: readonly T[],
  playerIds: ReadonlySet<string>,
): T[] {
  return items.filter(
    (item) => isVisibleCharacter(item) && playerIds.has(item.createdUserId),
  );
}

export function groupVisibleCharactersByPlayer<T extends CharacterItem>(
  items: readonly T[],
): Map<string, T[]> {
  const charactersByPlayer = new Map<string, T[]>();
  for (const item of items) {
    if (!isVisibleCharacter(item)) {
      continue;
    }
    const characters = charactersByPlayer.get(item.createdUserId) ?? [];
    characters.push(item);
    charactersByPlayer.set(item.createdUserId, characters);
  }
  return charactersByPlayer;
}

export function formatCharacterName(characterName: string): string {
  return characterName.trim() || "Unnamed character";
}

export function groupPlayerConnections<T extends PartyPlayer>(
  players: readonly T[],
): T[] {
  const uniquePlayers = new Map<string, T>();

  for (const player of players) {
    if (player.role === "PLAYER" && !uniquePlayers.has(player.id)) {
      uniquePlayers.set(player.id, player);
    }
  }

  return [...uniquePlayers.values()];
}

export function formatPlayerName(playerId: string, playerName: string): string {
  const name = playerName.trim();
  if (name) {
    return name;
  }
  const suffix = playerId.slice(-6) || "unknown";
  return `Player • ${suffix}`;
}

export function normalizeZoomScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SINGLE_TOKEN_ZOOM;
  }
  return Math.min(
    MAX_SINGLE_TOKEN_ZOOM,
    Math.max(MIN_SINGLE_TOKEN_ZOOM, value),
  );
}

export function createBoundsForZoom(
  center: Vector2,
  zoomScale: number,
  viewportWidth: number,
  viewportHeight: number,
): BoundingBox {
  const scale = normalizeZoomScale(zoomScale);
  const safeWidth =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1;
  const safeHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1;
  const width = safeWidth / scale;
  const height = safeHeight / scale;
  const min = {
    x: center.x - width / 2,
    y: center.y - height / 2,
  };
  const max = {
    x: center.x + width / 2,
    y: center.y + height / 2,
  };

  return { min, max, width, height, center: { ...center } };
}

export function calculatePadding(
  gridDpi: number,
  minimumPadding = 100,
): number {
  const safeMinimum =
    Number.isFinite(minimumPadding) && minimumPadding > 0
      ? minimumPadding
      : 100;
  const gridPadding = Number.isFinite(gridDpi) && gridDpi > 0 ? gridDpi * 2 : 0;
  return Math.max(safeMinimum, gridPadding);
}

export function padBounds(
  bounds: BoundingBox,
  gridDpi: number,
  minimumPadding = 100,
): BoundingBox {
  const padding = calculatePadding(gridDpi, minimumPadding);
  const min = {
    x: bounds.min.x - padding,
    y: bounds.min.y - padding,
  };
  const max = {
    x: bounds.max.x + padding,
    y: bounds.max.y + padding,
  };
  const width = max.x - min.x;
  const height = max.y - min.y;

  return {
    min,
    max,
    width,
    height,
    center: {
      x: min.x + width / 2,
      y: min.y + height / 2,
    },
  };
}

export function resolveEnablement(
  globalEnabled: boolean,
  playerAutoFocusEnabled: boolean,
): boolean {
  return globalEnabled && playerAutoFocusEnabled;
}
