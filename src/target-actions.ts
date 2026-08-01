import OBR, { type Item } from "@owlbear-rodeo/sdk";

import {
  DEFAULT_SINGLE_TOKEN_ZOOM,
  FOCUS_HIGHLIGHT_DELAY_MS,
} from "./constants";
import {
  calculateCenterAnchoredViewportPosition,
  calculateHighlightFitScale,
  createBoundsForZoom,
  capBoundsZoom,
  filterVisibleOwnedCharacters,
  filterVisiblePartyCharacters,
  isCharacter,
  isVisibleCharacter,
  padBounds,
} from "./domain";
import { showHighlights } from "./highlight";

export type TargetActionFailureReason =
  "SCENE_UNAVAILABLE" | "NOT_FOUND" | "SDK_ERROR";
export type TargetActionFailure = {
  ok: false;
  reason: TargetActionFailureReason;
  error?: unknown;
};
export type TargetActionResult =
  { ok: true; itemCount: number } | TargetActionFailure;

async function getReadySceneItems(): Promise<
  { ok: true; items: Item[] } | TargetActionFailure
> {
  try {
    if (!(await OBR.scene.isReady())) {
      return { ok: false, reason: "SCENE_UNAVAILABLE" };
    }
    return { ok: true, items: await OBR.scene.items.getItems() };
  } catch (error) {
    console.error("Where am I? failed to read the active scene.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

async function resolveCharacterItems(
  itemsOrIds: readonly Item[] | readonly string[],
  includeHidden: boolean,
): Promise<Item[]> {
  const items =
    itemsOrIds.length === 0
      ? []
      : typeof itemsOrIds[0] === "string"
        ? await OBR.scene.items.getItems([...itemsOrIds] as string[])
        : (itemsOrIds as readonly Item[]);
  return items.filter(includeHidden ? isCharacter : isVisibleCharacter);
}

async function resolveItems(
  itemsOrIds: readonly Item[] | readonly string[],
): Promise<Item[]> {
  return itemsOrIds.length === 0
    ? []
    : typeof itemsOrIds[0] === "string"
      ? OBR.scene.items.getItems([...itemsOrIds] as string[])
      : [...(itemsOrIds as readonly Item[])];
}

function allRequestedItemsWereResolved(
  itemsOrIds: readonly Item[] | readonly string[],
  items: readonly Item[],
): boolean {
  const expectedIds = new Set(
    itemsOrIds.map((itemOrId) =>
      typeof itemOrId === "string" ? itemOrId : itemOrId.id,
    ),
  );
  return items.length === expectedIds.size;
}

function waitForFocusHighlight(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, FOCUS_HIGHLIGHT_DELAY_MS);
  });
}

async function zoomOutToShowHighlightTargets(items: readonly Item[]) {
  try {
    const ids = items.map((item) => item.id);
    const [bounds, position, scale, width, height] = await Promise.all([
      OBR.scene.items.getItemBounds(ids),
      OBR.viewport.getPosition(),
      OBR.viewport.getScale(),
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const viewportCenter = await OBR.viewport.inverseTransformPoint({
      x: width / 2,
      y: height / 2,
    });
    const fitScale = calculateHighlightFitScale(
      bounds,
      viewportCenter,
      scale,
      width,
      height,
    );
    if (fitScale !== undefined) {
      const targetPosition = calculateCenterAnchoredViewportPosition(
        position,
        scale,
        fitScale,
        width,
        height,
      );
      if (!targetPosition) {
        throw new Error("Invalid Highlight viewport transform.");
      }
      await OBR.viewport.animateTo({
        position: targetPosition,
        scale: fitScale,
      });
    }
  } catch (error) {
    console.error("Where am I? could not fit Highlight targets.", error);
  }
}

export async function highlightItems(
  itemsOrIds: readonly Item[] | readonly string[],
  color?: string,
  requireVisible = false,
): Promise<TargetActionResult> {
  try {
    if (!(await OBR.scene.isReady())) {
      return { ok: false, reason: "SCENE_UNAVAILABLE" };
    }
    const items = await resolveItems(itemsOrIds);
    if (items.length === 0) return { ok: false, reason: "NOT_FOUND" };
    if (requireVisible && !allRequestedItemsWereResolved(itemsOrIds, items)) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    await zoomOutToShowHighlightTargets(items);
    await showHighlights(items, true, color);
    return { ok: true, itemCount: items.length };
  } catch (error) {
    console.error("Where am I? failed to highlight items.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

export async function highlightCharacterItems(
  itemsOrIds: readonly Item[] | readonly string[],
  includeHidden = false,
  color?: string,
): Promise<TargetActionResult> {
  try {
    if (!(await OBR.scene.isReady())) {
      return { ok: false, reason: "SCENE_UNAVAILABLE" };
    }
    const items = await resolveCharacterItems(itemsOrIds, includeHidden);
    if (items.length === 0) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    await zoomOutToShowHighlightTargets(items);
    await showHighlights(items, true, color);
    return { ok: true, itemCount: items.length };
  } catch (error) {
    console.error("Where am I? failed to highlight characters.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

export async function focusViewportOnCharacterItems(
  itemsOrIds: readonly Item[] | readonly string[],
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
  highlightEnabled = true,
  includeHidden = false,
  highlightColor?: string,
): Promise<TargetActionResult> {
  return focusViewportOnItemsInternal(
    itemsOrIds,
    singleTokenZoom,
    highlightEnabled,
    includeHidden,
    highlightColor,
  );
}

export async function focusViewportOnItems(
  itemsOrIds: readonly Item[] | readonly string[],
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
  highlightEnabled = true,
  highlightColor?: string,
  requireVisible = false,
): Promise<TargetActionResult> {
  return focusViewportOnItemsInternal(
    itemsOrIds,
    singleTokenZoom,
    highlightEnabled,
    undefined,
    highlightColor,
    requireVisible,
  );
}

async function focusViewportOnItemsInternal(
  itemsOrIds: readonly Item[] | readonly string[],
  singleTokenZoom: number,
  highlightEnabled: boolean,
  includeHidden: boolean | undefined,
  highlightColor: string | undefined,
  requireVisible = false,
): Promise<TargetActionResult> {
  try {
    if (!(await OBR.scene.isReady())) {
      return { ok: false, reason: "SCENE_UNAVAILABLE" };
    }
    const items =
      includeHidden === undefined
        ? await resolveItems(itemsOrIds)
        : await resolveCharacterItems(itemsOrIds, includeHidden);
    if (items.length === 0) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    if (requireVisible && !allRequestedItemsWereResolved(itemsOrIds, items)) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    const ids = items.map((item) => item.id);
    const bounds = await OBR.scene.items.getItemBounds(ids);
    if (!highlightEnabled) {
      try {
        await showHighlights(items, false, highlightColor);
      } catch (error) {
        console.error("Where am I? highlight cleanup failed.", error);
      }
    }
    if (ids.length === 1) {
      const [width, height] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      await OBR.viewport.animateToBounds(
        createBoundsForZoom(bounds.center, singleTokenZoom, width, height),
      );
    } else {
      const [gridDpi, viewportWidth, viewportHeight] = await Promise.all([
        OBR.scene.grid.getDpi(),
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      await OBR.viewport.animateToBounds(
        capBoundsZoom(
          padBounds(bounds, gridDpi),
          singleTokenZoom,
          viewportWidth,
          viewportHeight,
        ),
      );
    }
    if (highlightEnabled) {
      await waitForFocusHighlight();
      try {
        await showHighlights(items, true, highlightColor);
      } catch (error) {
        console.error("Where am I? highlight setup failed.", error);
      }
    }
    return { ok: true, itemCount: ids.length };
  } catch (error) {
    console.error("Where am I? failed to focus the viewport.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

export async function getPlayerCharacterTargets(
  playerId: string,
  characterId?: string,
): Promise<{ ok: true; items: Item[] } | TargetActionFailure> {
  const scene = await getReadySceneItems();
  if (!scene.ok) return scene;
  const owned = filterVisibleOwnedCharacters(scene.items, playerId);
  return {
    ok: true,
    items: characterId
      ? owned.filter((item) => item.id === characterId)
      : owned,
  };
}

export async function getPartyCharacterTargets(
  playerIds: ReadonlySet<string>,
): Promise<{ ok: true; items: Item[] } | TargetActionFailure> {
  const scene = await getReadySceneItems();
  if (!scene.ok) return scene;
  return {
    ok: true,
    items: filterVisiblePartyCharacters(scene.items, playerIds),
  };
}

export async function focusViewportOnPlayerCharacters(
  playerId: string,
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
  highlightEnabled = true,
  characterId?: string,
  highlightColor?: string,
): Promise<TargetActionResult> {
  const targets = await getPlayerCharacterTargets(playerId, characterId);
  return targets.ok
    ? focusViewportOnCharacterItems(
        targets.items,
        singleTokenZoom,
        highlightEnabled,
        false,
        highlightColor,
      )
    : targets;
}

export async function focusViewportOnPartyCharacters(
  playerIds: ReadonlySet<string>,
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
  highlightEnabled = true,
  highlightColor?: string,
): Promise<TargetActionResult> {
  const targets = await getPartyCharacterTargets(playerIds);
  return targets.ok
    ? focusViewportOnCharacterItems(
        targets.items,
        singleTokenZoom,
        highlightEnabled,
        false,
        highlightColor,
      )
    : targets;
}
