import OBR, { type Item } from "@owlbear-rodeo/sdk";

import {
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
    const [bounds, gridDpi] = await Promise.all([
      OBR.scene.items.getItemBounds(ids),
      OBR.scene.grid.getDpi(),
    ]);

    await OBR.viewport.animateToBounds(padBounds(bounds, gridDpi));
    return { ok: true, itemCount: ids.length };
  } catch (error) {
    console.error("Where am I? failed to focus the viewport.", error);
    return { ok: false, reason: "SDK_ERROR", error };
  }
}

export async function focusViewportOnPlayerCharacters(
  targetPlayerId: string,
): Promise<FocusResult> {
  const scene = await getReadySceneItems();
  if (!scene.ok) {
    return scene;
  }

  return focusViewportOnCharacterItems(
    filterVisibleOwnedCharacters(scene.items, targetPlayerId),
  );
}

export async function focusViewportOnPartyCharacters(
  playerIds: ReadonlySet<string>,
): Promise<FocusResult> {
  const scene = await getReadySceneItems();
  if (!scene.ok) {
    return scene;
  }

  return focusViewportOnCharacterItems(
    filterVisiblePartyCharacters(scene.items, playerIds),
  );
}
