import OBR, { buildShape, type Item } from "@owlbear-rodeo/sdk";

import { HIGHLIGHT_COLOR, MOVE_HERE_RETICLE_METADATA_KEY } from "./constants";

let requestGeneration = 0;
let activeReticleId: string | undefined;

function isMoveHereReticle(item: Item): boolean {
  return item.metadata[MOVE_HERE_RETICLE_METADATA_KEY] === true;
}

async function deleteExistingReticles(): Promise<void> {
  const activeId = activeReticleId;
  activeReticleId = undefined;
  const existing = await OBR.scene.local.getItems(isMoveHereReticle);
  const ids = [
    ...new Set([
      ...(activeId ? [activeId] : []),
      ...existing.map((item) => item.id),
    ]),
  ];
  if (ids.length > 0) await OBR.scene.local.deleteItems(ids);
}

export async function clearMoveHereReticle(): Promise<void> {
  requestGeneration += 1;
  try {
    await deleteExistingReticles();
  } catch (error) {
    console.error("Where am I? could not clear the Move here reticle.", error);
  }
}

export async function showMoveHereReticle(character: Item): Promise<void> {
  const generation = ++requestGeneration;

  try {
    await deleteExistingReticles();
    if (generation !== requestGeneration) return;
    const [bounds, width, height] = await Promise.all([
      OBR.scene.items.getItemBounds([character.id]),
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const side = Math.max(bounds.width, bounds.height);
    if (!Number.isFinite(side) || side <= 0) return;

    const center = await OBR.viewport.inverseTransformPoint({
      x: width / 2,
      y: height / 2,
    });
    if (generation !== requestGeneration) return;
    const position = {
      x: center.x - side / 2,
      y: center.y - side / 2,
    };

    const reticle = buildShape()
      .name(`Where am I? Move here reticle: ${character.name}`)
      .position(position)
      .width(side)
      .height(side)
      .shapeType("RECTANGLE")
      .fillColor(HIGHLIGHT_COLOR)
      .fillOpacity(0.08)
      .strokeColor(HIGHLIGHT_COLOR)
      .strokeOpacity(1)
      .strokeWidth(6)
      .strokeDash([12, 8])
      .locked(true)
      .disableHit(true)
      .layer("POPOVER")
      .metadata({ [MOVE_HERE_RETICLE_METADATA_KEY]: true })
      .build();

    await OBR.scene.local.addItems([reticle]);
    if (generation === requestGeneration) {
      activeReticleId = reticle.id;
    } else {
      await OBR.scene.local.deleteItems([reticle.id]);
    }
  } catch (error) {
    console.error("Where am I? could not show the Move here reticle.", error);
  }
}
