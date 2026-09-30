import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAY_AREA_METADATA_KEY } from "./constants";

const state = vi.hoisted(() => ({
  metadata: {} as Metadata,
  items: [] as Item[],
  boundsCalls: 0,
  boundsGate: undefined as Promise<void> | undefined,
  screenOffset: { x: 0, y: 0 },
}));
const sdk = vi.hoisted(() => ({
  scene: {
    isReady: vi.fn(async () => true),
    getMetadata: vi.fn(async () => state.metadata),
    setMetadata: vi.fn(async () => undefined),
    items: {
      getItems: vi.fn(async () => state.items),
      getItemBounds: vi.fn(async (ids: string[]) => {
        state.boundsCalls++;
        await state.boundsGate;
        const items = state.items.filter((item) => ids.includes(item.id));
        const min = {
          x: Math.min(...items.map((item) => item.position.x - 10)),
          y: Math.min(...items.map((item) => item.position.y - 10)),
        };
        const max = {
          x: Math.max(...items.map((item) => item.position.x + 10)),
          y: Math.max(...items.map((item) => item.position.y + 10)),
        };
        return {
          min,
          max,
          width: max.x - min.x,
          height: max.y - min.y,
          center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
        };
      }),
      updateItems: vi.fn(
        async (ids: string[], update: (items: Item[]) => void) => {
          update(state.items.filter((item) => ids.includes(item.id)));
        },
      ),
    },
  },
  viewport: {
    getWidth: vi.fn(async () => 200),
    getHeight: vi.fn(async () => 200),
    transformPoint: vi.fn(async (point: { x: number; y: number }) => ({
      x: point.x + state.screenOffset.x,
      y: point.y + state.screenOffset.y,
    })),
  },
  notification: { show: vi.fn(async () => undefined) },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));
vi.mock("./metadata", () => ({
  getPlayerSettings: vi.fn(async () => ({
    singleTokenZoom: 0.5,
    highlightEnabled: true,
  })),
  getRoomSettings: vi.fn(async () => ({})),
  resolveHighlightColor: vi.fn(() => "#fa5300"),
}));
const focus = vi.hoisted(() => vi.fn(async () => ({ ok: true, itemCount: 1 })));
vi.mock("./target-actions", () => ({
  focusViewportOnCharacterItems: focus,
}));

import { PlayerPlayAreaEnforcer } from "./play-area";

function character(
  id: string,
  x: number,
  user = "player",
  scale = 1,
  rotation = 0,
): Item {
  return {
    id,
    type: "IMAGE",
    name: id,
    visible: true,
    locked: false,
    createdUserId: user,
    zIndex: 0,
    lastModified: String(Math.random()),
    lastModifiedUserId: user,
    position: { x, y: 50 },
    rotation,
    scale: { x: scale, y: scale },
    metadata: {},
    layer: "CHARACTER",
  };
}

async function settle(): Promise<void> {
  await vi.waitFor(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Player Play Area runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.metadata = {
      [PLAY_AREA_METADATA_KEY]: {
        version: 1,
        enabled: true,
        min: { x: 0, y: 0 },
        max: { x: 100, y: 100 },
      },
    };
    state.items = [character("hero", 150)];
    state.boundsCalls = 0;
    state.boundsGate = undefined;
    state.screenOffset = { x: 0, y: 0 };
  });

  it("hydrates without relocating existing Characters", async () => {
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    await settle();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    enforcer.dispose();
  });

  it("constrains player movement but ignores GM and other-player changes", async () => {
    const enforcer = new PlayerPlayAreaEnforcer("player");
    state.items = [character("hero", 50)];
    await enforcer.initialize(true);

    state.items[0] = character("hero", 150, "gm");
    enforcer.enqueue([...state.items]);
    await settle();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();

    state.items[0] = character("hero", 160, "other-player");
    enforcer.enqueue([...state.items]);
    await settle();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();

    state.items[0] = character("hero", 170, "player");
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() =>
      expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(1),
    );
    expect(state.items[0]?.position.x).toBe(90);
    enforcer.dispose();
  });

  it("detects a newly added player Character", async () => {
    state.items = [];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    state.items = [character("new", -100)];
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() => expect(state.items[0]?.position.x).toBe(10));
    enforcer.dispose();
  });

  it("suppresses its correction echo but accepts the next distinct live proposal", async () => {
    state.items = [character("hero", 50)];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    state.items[0] = character("hero", 120);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() =>
      expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(1),
    );
    enforcer.enqueue([...state.items]);
    await settle();
    expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(1);
    state.items[0] = character("hero", 140);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() =>
      expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(2),
    );
    enforcer.dispose();
  });

  it("stops when globally disabled or Play Area enforcement is disabled", async () => {
    state.items = [character("hero", 50)];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    enforcer.setGlobalEnabled(false);
    state.items[0] = character("hero", 150);
    enforcer.enqueue([...state.items]);
    await settle();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    enforcer.setGlobalEnabled(true);
    await settle();
    enforcer.handleSceneMetadata({
      [PLAY_AREA_METADATA_KEY]: {
        ...(state.metadata[PLAY_AREA_METADATA_KEY] as object),
        enabled: false,
      },
    });
    state.items[0] = character("hero", 170);
    enforcer.enqueue([...state.items]);
    await settle();
    expect(sdk.scene.items.updateItems).not.toHaveBeenCalled();
    enforcer.dispose();
  });

  it("reuses cached geometry and invalidates it for scale or rotation changes", async () => {
    state.items = [character("hero", 50)];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    state.items[0] = character("hero", 120);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() => expect(state.boundsCalls).toBe(1));
    await settle();
    state.items[0] = character("hero", 130);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() =>
      expect(sdk.scene.items.updateItems).toHaveBeenCalledTimes(2),
    );
    expect(state.boundsCalls).toBe(1);
    state.items[0] = character("hero", 140, "player", 2);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() => expect(state.boundsCalls).toBe(2));
    await settle();
    state.items[0] = character("hero", 150, "player", 2, 45);
    enforcer.enqueue([...state.items]);
    await vi.waitFor(() => expect(state.boundsCalls).toBe(3));
    enforcer.dispose();
  });

  it("serializes correction work and coalesces to the newest pending state", async () => {
    state.items = [character("hero", 50)];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    let releaseBounds = (): void => undefined;
    state.boundsGate = new Promise<void>((resolve) => {
      releaseBounds = resolve;
    });
    state.items[0] = character("hero", 120);
    enforcer.enqueue([...state.items]);
    state.items[0] = character("hero", 130);
    enforcer.enqueue([...state.items]);
    state.items[0] = character("hero", 140);
    enforcer.enqueue([...state.items]);
    releaseBounds();
    state.boundsGate = undefined;
    await vi.waitFor(() => expect(state.items[0]?.position.x).toBe(90));
    expect(sdk.scene.items.updateItems.mock.calls.length).toBeLessThanOrEqual(
      2,
    );
    enforcer.dispose();
  });

  it("focuses only when corrected bounds are wholly offscreen", async () => {
    vi.useFakeTimers();
    state.items = [character("hero", 50)];
    const enforcer = new PlayerPlayAreaEnforcer("player");
    await enforcer.initialize(true);
    state.items[0] = character("hero", 150);
    enforcer.enqueue([...state.items]);
    await vi.runAllTimersAsync();
    expect(focus).not.toHaveBeenCalled();

    state.screenOffset = { x: 500, y: 500 };
    state.items[0] = character("hero", -150);
    enforcer.enqueue([...state.items]);
    await vi.runAllTimersAsync();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(sdk.notification.show).toHaveBeenCalledWith(
      "Character kept inside the Play Area.",
      "INFO",
    );
    enforcer.dispose();
    vi.useRealTimers();
  });
});
