import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID,
  FOCUS_PARTY_CONTEXT_MENU_ID,
  HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
  PENDING_PARTY_ACTIONS_METADATA_KEY,
  TARGET_ACTION_BROADCAST_CHANNEL,
} from "./constants";

const state = vi.hoisted(() => ({
  sceneMetadata: {} as Metadata,
  items: [] as Item[],
  itemChange: undefined as undefined | ((items: Item[]) => void),
  contextMenus: new Map<
    string,
    {
      icons?: unknown;
      onClick?: (context: { items: Item[] }, elementId: string) => void;
    }
  >(),
}));
const sdk = vi.hoisted(() => ({
  player: {
    id: "gm",
    getRole: vi.fn(async () => "GM" as const),
    getConnectionId: vi.fn(async () => "gm-a"),
    getName: vi.fn(async () => "GM Ada"),
  },
  broadcast: {
    onMessage: vi.fn(() => vi.fn()),
    sendMessage: vi.fn(async () => undefined),
  },
  contextMenu: {
    create: vi.fn(async (menu: { id: string; onClick?: never }) => {
      state.contextMenus.set(menu.id, menu);
    }),
    remove: vi.fn(async () => undefined),
  },
  notification: { show: vi.fn(async () => undefined) },
  scene: {
    isReady: vi.fn(async () => true),
    getMetadata: vi.fn(async () => state.sceneMetadata),
    setMetadata: vi.fn(async (update: Metadata) => {
      state.sceneMetadata = { ...state.sceneMetadata, ...update };
    }),
    onMetadataChange: vi.fn(() => vi.fn()),
    onReadyChange: vi.fn(() => vi.fn()),
    items: {
      getItems: vi.fn(async (ids?: string[]) =>
        ids ? state.items.filter((item) => ids.includes(item.id)) : state.items,
      ),
      updateItems: vi.fn(
        async (ids: string[], update: (items: Item[]) => void) => {
          update(state.items.filter((item) => ids.includes(item.id)));
        },
      ),
      onChange: vi.fn((callback: (items: Item[]) => void) => {
        state.itemChange = callback;
        return vi.fn();
      }),
    },
  },
  party: {
    getPlayers: vi.fn(async () => [
      {
        id: "player",
        connectionId: "player-connection",
        role: "PLAYER" as const,
      },
    ]),
    onChange: vi.fn(() => vi.fn()),
  },
  room: {
    getMetadata: vi.fn(async () => ({})),
    onMetadataChange: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: sdk }));

import { BackgroundController } from "./background-controller";

function hiddenItem(): Item {
  return {
    id: "dragon",
    type: "IMAGE",
    name: "Ancient Dragon",
    visible: false,
    locked: false,
    createdUserId: "gm",
    zIndex: 0,
    lastModified: "now",
    lastModifiedUserId: "gm",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: {},
    layer: "PROP",
  };
}

describe("GM pending Party action integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.sceneMetadata = {};
    state.items = [hiddenItem()];
    state.contextMenus.clear();
    state.itemChange = undefined;
  });

  it("queues, rejects overlap, cancels, and executes after visibility", async () => {
    const controller = new BackgroundController();
    await controller.start();
    expect(
      state.contextMenus.get(CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID)?.icons,
    ).toEqual([
      expect.objectContaining({
        label: "Cancel pending focus",
        filter: expect.objectContaining({
          roles: ["GM"],
          some: [
            expect.objectContaining({
              key: ["metadata", "com.ex-asperis.whereami/pending-focus-party"],
              value: true,
            }),
          ],
        }),
      }),
    ]);

    state.contextMenus
      .get(FOCUS_PARTY_CONTEXT_MENU_ID)
      ?.onClick?.({ items: state.items }, FOCUS_PARTY_CONTEXT_MENU_ID);
    await vi.waitFor(() => {
      expect(sdk.notification.show).toHaveBeenCalledWith(
        expect.stringContaining("Focus for Party is pending"),
        "INFO",
      );
    });
    expect(
      (state.sceneMetadata[PENDING_PARTY_ACTIONS_METADATA_KEY] as unknown[])
        .length,
    ).toBe(1);

    state.contextMenus
      .get(HIGHLIGHT_PARTY_CONTEXT_MENU_ID)
      ?.onClick?.({ items: state.items }, HIGHLIGHT_PARTY_CONTEXT_MENU_ID);
    await vi.waitFor(() => {
      expect(sdk.notification.show).toHaveBeenCalledWith(
        expect.stringContaining("already belongs to a pending Focus"),
        "ERROR",
      );
    });

    state.contextMenus
      .get(CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID)
      ?.onClick?.({ items: state.items }, CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID);
    await vi.waitFor(() => {
      expect(sdk.notification.show).toHaveBeenCalledWith(
        expect.stringContaining("canceled"),
        "INFO",
      );
    });

    state.contextMenus
      .get(FOCUS_PARTY_CONTEXT_MENU_ID)
      ?.onClick?.({ items: state.items }, FOCUS_PARTY_CONTEXT_MENU_ID);
    await vi.waitFor(() => {
      expect(
        (state.sceneMetadata[PENDING_PARTY_ACTIONS_METADATA_KEY] as unknown[])
          .length,
      ).toBe(1);
    });
    state.items[0]!.visible = true;
    state.itemChange?.(state.items);

    await vi.waitFor(() => {
      expect(sdk.broadcast.sendMessage).toHaveBeenCalledWith(
        TARGET_ACTION_BROADCAST_CHANNEL,
        expect.objectContaining({
          action: "FOCUS",
          recipient: { scope: "PARTY" },
          targetCharacterIds: ["dragon"],
          requireVisible: true,
        }),
        { destination: "REMOTE" },
      );
    });
    expect(
      (state.sceneMetadata[PENDING_PARTY_ACTIONS_METADATA_KEY] as unknown[])
        .length,
    ).toBe(0);
    controller.dispose();
  });
});
