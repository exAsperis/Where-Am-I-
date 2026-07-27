import type { BoundingBox, Item, Player } from "@owlbear-rodeo/sdk";

export interface CharacterItem {
  id: string;
  layer: Item["layer"];
  visible: boolean;
  createdUserId: string;
  name: string;
}

export interface PartyPlayer {
  id: string;
  connectionId: string;
  role: Player["role"];
  color: string;
}

export function isVisibleCharacter(
  item: Pick<Item, "layer" | "visible">,
): boolean {
  return item.layer === "CHARACTER" && item.visible;
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

export function formatPlayerLabel(
  playerId: string,
  characterNames: readonly string[],
): string {
  const names = [
    ...new Set(characterNames.map((name) => name.trim()).filter(Boolean)),
  ];

  if (names.length > 0) {
    return names.join(", ");
  }

  const suffix = playerId.slice(-6) || "unknown";
  return `Player • ${suffix}`;
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
