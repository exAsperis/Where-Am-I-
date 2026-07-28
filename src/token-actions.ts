import OBR, { type Item } from "@owlbear-rodeo/sdk";

export async function getGmCharacterToken(characterId: string): Promise<Item> {
  if ((await OBR.player.getRole()) !== "GM") {
    throw new Error("Only a GM can manage character tokens.");
  }
  if (!(await OBR.scene.isReady())) {
    throw new Error("No scene is open and ready.");
  }
  const [character] = await OBR.scene.items.getItems([characterId]);
  if (!character || character.layer !== "CHARACTER") {
    throw new Error("The character token is no longer in the scene.");
  }
  return character;
}

export async function toggleCharacterTokenVisibility(
  characterId: string,
): Promise<boolean> {
  const character = await getGmCharacterToken(characterId);
  const visible = !character.visible;
  await OBR.scene.items.updateItems([character], (items) => {
    for (const item of items) {
      item.visible = visible;
    }
  });
  return visible;
}

export async function moveCharacterTokenToViewportCenter(
  characterId: string,
): Promise<void> {
  const character = await getGmCharacterToken(characterId);
  const [width, height] = await Promise.all([
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  const center = await OBR.viewport.inverseTransformPoint({
    x: width / 2,
    y: height / 2,
  });
  await OBR.scene.items.updateItems([character], (items) => {
    for (const item of items) {
      item.position = center;
    }
  });
}
