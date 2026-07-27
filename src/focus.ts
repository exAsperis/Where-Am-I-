import OBR, { type Item } from "@owlbear-rodeo/sdk";

import { DEFAULT_SINGLE_TOKEN_ZOOM } from "./constants";
import {
  createBoundsForZoom,
  filterVisibleOwnedCharacters,
  filterVisiblePartyCharacters,
  isVisibleCharacter,
  padBounds,
} from "./domain";

export type FocusFailureReason =
  "SCENE_UNAVAILABLE" | "NOT_FOUND" | "SDK_ERROR";

export type FocusFailure = {
  ok: false;
  reason: FocusFailureReason;
  error?: unknown;
};

export type FocusResult = { ok: true; itemCount: number } | FocusFailure;

async function getReadySceneItems(): Promise<
  { ok: true; items: Item[] } | FocusFailure
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

export async function focusViewportOnCharacterItems(
  itemsOrIds: readonly Item[] | readonly string[],
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
): Promise<FocusResult> {
  try {
    if (!(await OBR.scene.isReady())) {
      return { ok: false, reason: "SCENE_UNAVAILABLE" };
    }

    const items =
      itemsOrIds.length === 0
        ? []
        : typeof itemsOrIds[0] === "string"
          ? await OBR.scene.items.getItems(
              Array.from(itemsOrIds as readonly string[]),
            )
          : (itemsOrIds as readonly Item[]);
    const characterItems = items.filter(isVisibleCharacter);

    if (characterItems.length === 0) {
      return { ok: false, reason: "NOT_FOUND" };
    }

    const ids = characterItems.map((item) => item.id);
    const bounds = await OBR.scene.items.getItemBounds(ids);
    if (ids.length === 1) {
      const [viewportWidth, viewportHeight] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      await OBR.viewport.animateToBounds(
        createBoundsForZoom(
          bounds.center,
          singleTokenZoom,
          viewportWidth,
          viewportHeight,
        ),
      );
    } else {
      const gridDpi = await OBR.scene.grid.getDpi();
      await OBR.viewport.animateToBounds(padBounds(bounds, gridDpi));
    }
    return { ok: true, itemCount: ids.length };
  } catch (error) {
    console.error("Where am I? failed to focus the viewport.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

export async function focusViewportOnPlayerCharacters(
  targetPlayerId: string,
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
): Promise<FocusResult> {
  const scene = await getReadySceneItems();
  if (!scene.ok) {
    return scene;
  }

  return focusViewportOnCharacterItems(
    filterVisibleOwnedCharacters(scene.items, targetPlayerId),
    singleTokenZoom,
  );
}

export async function focusViewportOnPartyCharacters(
  playerIds: ReadonlySet<string>,
  singleTokenZoom = DEFAULT_SINGLE_TOKEN_ZOOM,
): Promise<FocusResult> {
  const scene = await getReadySceneItems();
  if (!scene.ok) {
    return scene;
  }

  return focusViewportOnCharacterItems(
    filterVisiblePartyCharacters(scene.items, playerIds),
    singleTokenZoom,
  );
}
