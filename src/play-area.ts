import OBR, {
  type Item,
  type Metadata,
  type Vector2,
} from "@owlbear-rodeo/sdk";

import {
  PLAY_AREA_CORRECTION_EPSILON,
  PLAY_AREA_METADATA_KEY,
  PLAY_AREA_RECOVERY_DEBOUNCE_MS,
} from "./constants";
import {
  clampItemGroup,
  getBoundsOffsets,
  isCharacter,
  positionsApproximatelyEqual,
  type AxisAlignedRect,
  type ItemBoundsOffsets,
} from "./domain";
import {
  getPlayerSettings,
  getRoomSettings,
  resolveHighlightColor,
} from "./metadata";
import { focusViewportOnCharacterItems } from "./target-actions";

export interface PlayAreaSettings extends AxisAlignedRect {
  version: 1;
  enabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPoint(value: unknown): Vector2 | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  return typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y)
    ? { x, y }
    : undefined;
}

export function readPlayAreaSettings(
  metadata: Metadata,
): PlayAreaSettings | undefined {
  const value = metadata[PLAY_AREA_METADATA_KEY];
  if (!isRecord(value) || value.version !== 1) return undefined;
  const min = readPoint(value.min);
  const max = readPoint(value.max);
  if (
    !min ||
    !max ||
    max.x <= min.x ||
    max.y <= min.y ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  return { version: 1, enabled: value.enabled, min, max };
}

export async function getPlayAreaSettings(): Promise<
  PlayAreaSettings | undefined
> {
  if (!(await OBR.scene.isReady())) return undefined;
  return readPlayAreaSettings(await OBR.scene.getMetadata());
}

export async function setPlayAreaEnabled(enabled: boolean): Promise<void> {
  const settings = await getPlayAreaSettings();
  if (!settings) return;
  await OBR.scene.setMetadata({
    [PLAY_AREA_METADATA_KEY]: { ...settings, enabled },
  });
}

export async function clearPlayArea(): Promise<void> {
  if (!(await OBR.scene.isReady())) return;
  await OBR.scene.setMetadata({ [PLAY_AREA_METADATA_KEY]: null });
}

interface GeometryCacheEntry {
  signature: string;
  offsets: ItemBoundsOffsets;
}

function geometrySignature(item: Item): string {
  const geometry = { ...item } as Record<string, unknown>;
  for (const property of [
    "position",
    "lastModified",
    "lastModifiedUserId",
    "metadata",
    "name",
    "visible",
    "locked",
    "zIndex",
    "createdUserId",
    "layer",
  ]) {
    delete geometry[property];
  }
  return JSON.stringify(geometry);
}

export class PlayerPlayAreaEnforcer {
  readonly #playerId: string;
  readonly #baseline = new Map<string, Item>();
  readonly #geometry = new Map<string, GeometryCacheEntry>();
  readonly #expectedCorrections = new Map<string, Vector2>();
  readonly #oversizedNotified = new Set<string>();
  readonly #recoveryIds = new Set<string>();
  #settings: PlayAreaSettings | undefined;
  #globalEnabled = true;
  #processing = false;
  #pendingItems: Item[] | undefined;
  #generation = 0;
  #recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  #hydrated = false;

  constructor(playerId: string) {
    this.#playerId = playerId;
  }

  async initialize(globalEnabled: boolean): Promise<void> {
    this.#globalEnabled = globalEnabled;
    await this.refreshScene();
  }

  async refreshScene(): Promise<void> {
    const generation = ++this.#generation;
    this.#hydrated = false;
    this.#clearTransientState();
    if (!(await OBR.scene.isReady())) return;
    const [metadata, items] = await Promise.all([
      OBR.scene.getMetadata(),
      OBR.scene.items.getItems(),
    ]);
    if (this.#disposed || generation !== this.#generation) return;
    this.#settings = readPlayAreaSettings(metadata);
    this.#replaceBaseline(items);
    await this.#warmGeometry(items, generation);
    if (this.#disposed || generation !== this.#generation) return;
    this.#hydrated = true;
  }

  handleSceneMetadata(metadata: Metadata): void {
    const previous = this.#settings;
    this.#settings = readPlayAreaSettings(metadata);
    if (
      previous?.enabled !== this.#settings?.enabled ||
      JSON.stringify(previous?.min) !== JSON.stringify(this.#settings?.min) ||
      JSON.stringify(previous?.max) !== JSON.stringify(this.#settings?.max)
    ) {
      void this.#rehydrateBaseline();
    }
  }

  setGlobalEnabled(enabled: boolean): void {
    if (this.#globalEnabled === enabled) return;
    this.#globalEnabled = enabled;
    ++this.#generation;
    if (enabled) void this.#rehydrateBaseline();
    else this.#clearTransientState(false);
  }

  enqueue(items: Item[]): void {
    if (this.#disposed || !this.#hydrated) return;
    this.#pendingItems = items;
    if (!this.#processing) void this.#drain();
  }

  dispose(): void {
    this.#disposed = true;
    ++this.#generation;
    this.#clearTransientState();
  }

  async #rehydrateBaseline(): Promise<void> {
    const generation = ++this.#generation;
    this.#hydrated = false;
    this.#clearTransientState(false);
    try {
      if (!(await OBR.scene.isReady())) return;
      const items = await OBR.scene.items.getItems();
      if (this.#disposed || generation !== this.#generation) return;
      this.#replaceBaseline(items);
      await this.#warmGeometry(items, generation);
      if (this.#disposed || generation !== this.#generation) return;
      this.#hydrated = true;
    } catch (error) {
      console.error(
        "Where am I? could not refresh the Play Area baseline.",
        error,
      );
    }
  }

  #replaceBaseline(items: readonly Item[]): void {
    this.#baseline.clear();
    for (const item of items) {
      if (isCharacter(item)) this.#baseline.set(item.id, item);
    }
  }

  async #warmGeometry(
    items: readonly Item[],
    generation: number,
  ): Promise<void> {
    if (!this.#globalEnabled || !this.#settings?.enabled) return;
    await Promise.all(
      items.filter(isCharacter).map(async (item) => {
        const bounds = await OBR.scene.items.getItemBounds([item.id]);
        if (this.#disposed || generation !== this.#generation) return;
        this.#geometry.set(item.id, {
          signature: geometrySignature(item),
          offsets: getBoundsOffsets(item.position, bounds),
        });
      }),
    );
  }

  #clearTransientState(clearBaseline = true): void {
    if (clearBaseline) this.#hydrated = false;
    if (clearBaseline) this.#baseline.clear();
    this.#geometry.clear();
    this.#expectedCorrections.clear();
    this.#oversizedNotified.clear();
    this.#recoveryIds.clear();
    this.#pendingItems = undefined;
    if (this.#recoveryTimer !== undefined) clearTimeout(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
  }

  async #drain(): Promise<void> {
    this.#processing = true;
    try {
      while (this.#pendingItems && !this.#disposed) {
        const items = this.#pendingItems;
        this.#pendingItems = undefined;
        await this.#process(items);
      }
    } catch (error) {
      console.error(
        "Where am I? could not enforce the Player Play Area.",
        error,
      );
    } finally {
      this.#processing = false;
      if (this.#pendingItems && !this.#disposed) void this.#drain();
    }
  }

  async #process(items: Item[]): Promise<void> {
    const currentCharacters = new Map(
      items.filter(isCharacter).map((item) => [item.id, item]),
    );
    for (const id of this.#baseline.keys()) {
      if (!currentCharacters.has(id)) {
        this.#baseline.delete(id);
        this.#geometry.delete(id);
        this.#expectedCorrections.delete(id);
      }
    }

    const changed: Item[] = [];
    for (const item of currentCharacters.values()) {
      const previous = this.#baseline.get(item.id);
      const expected = this.#expectedCorrections.get(item.id);
      if (
        expected &&
        positionsApproximatelyEqual(
          item.position,
          expected,
          PLAY_AREA_CORRECTION_EPSILON,
        )
      ) {
        this.#expectedCorrections.delete(item.id);
        this.#baseline.set(item.id, item);
        continue;
      }
      if (expected) this.#expectedCorrections.delete(item.id);
      const isNew = previous === undefined;
      const moved =
        previous !== undefined &&
        !positionsApproximatelyEqual(
          previous.position,
          item.position,
          PLAY_AREA_CORRECTION_EPSILON,
        );
      if (
        (isNew || moved) &&
        item.lastModifiedUserId === this.#playerId &&
        (!isNew ||
          item.createdUserId === this.#playerId ||
          item.lastModifiedUserId === this.#playerId)
      ) {
        changed.push(item);
      }
      this.#baseline.set(item.id, item);
    }

    const settings = this.#settings;
    if (this.#recoveryIds.size > 0 && changed.length > 0) {
      this.#scheduleRecovery();
    }
    if (!this.#globalEnabled || !settings?.enabled || changed.length === 0)
      return;
    const generation = this.#generation;
    const positioned = await Promise.all(
      changed.map(async (item) => ({
        item,
        offsets: await this.#getOffsets(item),
      })),
    );
    if (this.#disposed || generation !== this.#generation) return;
    const group = clampItemGroup(
      positioned.map(({ item, offsets }) => ({
        position: item.position,
        offsets,
      })),
      settings,
      PLAY_AREA_CORRECTION_EPSILON,
    );
    if (!group.changed) return;

    const corrections = positioned.map(({ item }) => ({
      id: item.id,
      position: {
        x: item.position.x + group.delta.x,
        y: item.position.y + group.delta.y,
      },
    }));
    for (const correction of corrections) {
      this.#expectedCorrections.set(correction.id, correction.position);
      this.#recoveryIds.add(correction.id);
    }
    await OBR.scene.items.updateItems(
      corrections.map((correction) => correction.id),
      (drafts) => {
        for (const draft of drafts) {
          const correction = corrections.find((value) => value.id === draft.id);
          if (correction) draft.position = correction.position;
        }
      },
    );
    if (this.#disposed || generation !== this.#generation) return;
    if (group.oversizedX || group.oversizedY) {
      const newOversized = corrections.some(
        (correction) => !this.#oversizedNotified.has(correction.id),
      );
      for (const correction of corrections)
        this.#oversizedNotified.add(correction.id);
      if (newOversized) {
        await OBR.notification.show(
          "This character is too large to fit inside the Play Area.",
          "WARNING",
        );
      }
    }
    this.#scheduleRecovery();
  }

  async #getOffsets(item: Item): Promise<ItemBoundsOffsets> {
    const signature = geometrySignature(item);
    const cached = this.#geometry.get(item.id);
    if (cached?.signature === signature) return cached.offsets;
    const bounds = await OBR.scene.items.getItemBounds([item.id]);
    const offsets = getBoundsOffsets(item.position, bounds);
    this.#geometry.set(item.id, {
      signature,
      offsets,
    });
    return offsets;
  }

  #scheduleRecovery(): void {
    if (this.#recoveryTimer !== undefined) clearTimeout(this.#recoveryTimer);
    const generation = this.#generation;
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = undefined;
      void this.#recover(generation);
    }, PLAY_AREA_RECOVERY_DEBOUNCE_MS);
  }

  async #recover(generation: number): Promise<void> {
    const ids = [...this.#recoveryIds];
    this.#recoveryIds.clear();
    if (ids.length === 0 || generation !== this.#generation || this.#disposed)
      return;
    try {
      const [bounds, width, height] = await Promise.all([
        Promise.all(ids.map((id) => OBR.scene.items.getItemBounds([id]))),
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      const visibility = await Promise.all(
        bounds.map(async (itemBounds, index) => {
          const corners = await Promise.all([
            OBR.viewport.transformPoint(itemBounds.min),
            OBR.viewport.transformPoint(itemBounds.max),
            OBR.viewport.transformPoint({
              x: itemBounds.min.x,
              y: itemBounds.max.y,
            }),
            OBR.viewport.transformPoint({
              x: itemBounds.max.x,
              y: itemBounds.min.y,
            }),
          ]);
          const screen = {
            minX: Math.min(...corners.map((point) => point.x)),
            maxX: Math.max(...corners.map((point) => point.x)),
            minY: Math.min(...corners.map((point) => point.y)),
            maxY: Math.max(...corners.map((point) => point.y)),
          };
          return {
            id: ids[index]!,
            visible:
              screen.maxX >= 0 &&
              screen.minX <= width &&
              screen.maxY >= 0 &&
              screen.minY <= height,
          };
        }),
      );
      if (generation !== this.#generation || this.#disposed) return;
      const offscreenIds = visibility
        .filter((entry) => !entry.visible)
        .map((entry) => entry.id);
      if (offscreenIds.length > 0) {
        const [player, room] = await Promise.all([
          getPlayerSettings(),
          getRoomSettings(),
        ]);
        await focusViewportOnCharacterItems(
          offscreenIds,
          player.singleTokenZoom,
          player.highlightEnabled,
          false,
          resolveHighlightColor("PLAYER", player, room),
        );
      }
      await OBR.notification.show(
        "Character kept inside the Play Area.",
        "INFO",
      );
    } catch (error) {
      console.error(
        "Where am I? could not complete Play Area recovery.",
        error,
      );
    }
  }
}
