import type { Item, Metadata } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID,
  FOCUS_PARTY_CONTEXT_MENU_ID,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
  PENDING_PARTY_ACTIONS_METADATA_KEY,
  PLAYER_SETTINGS_METADATA_KEY,
  PLAY_AREA_METADATA_KEY,
  ROOM_SETTINGS_METADATA_KEY,
  SET_PLAYER_PLAY_AREA_CONTEXT_MENU_ID,
  TARGET_ACTION_BROADCAST_CHANNEL,
} from "./constants";

const state = vi.hoisted(() => ({
  sceneMetadata: {} as Metadata,
  items: [] as Item[],
  itemChange: undefined as undefined | ((items: Item[]) => void),
  readyCallbacks: [] as Array<(ready: boolean) => void>,
  contextMenus: new Map<
    string,
    {
      icons?: unknown;
      onClick?: (context: { items: Item[] }, elementId: string) => void;
    }
  >(),
}));
const actions = vi.hoisted(() => ({
  focusViewportOnAllCharacters: vi.fn(async () => ({ ok: true as const })),
  focusViewportOnPlayerCharacters: vi.fn(async () => ({ ok: true as const })),
}));
const playArea = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  setGlobalEnabled: vi.fn(),
  refreshScene: vi.fn(async () => undefined),
  handleSceneMetadata: vi.fn(),
  enqueue: vi.fn(),
  dispose: vi.fn(),
  constructor: vi.fn(),
}));
const sdk = vi.hoisted(() => ({
  player: {
    id: "gm",
    getRole: vi.fn<() => Promise<"GM" | "PLAYER">>(async () => "GM"),
    getConnectionId: vi.fn(async () => "gm-a"),
    getName: vi.fn(async () => "GM Ada"),
    getMetadata: vi.fn(async () => ({})),
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
    onReadyChange: vi.fn((callback: (ready: boolean) => void) => {
      state.readyCallbacks.push(callback);
      return vi.fn();
    }),
    items: {
      getItems: vi.fn(async (ids?: string[]) =>
        ids ? state.items.filter((item) => ids.includes(item.id)) : state.items,
      ),
      getItemBounds: vi.fn(async () => ({
        min: { x: 10, y: 20 },
        max: { x: 110, y: 220 },
        width: 100,
        height: 200,
        center: { x: 60, y: 120 },
      })),
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
vi.mock("./target-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./target-actions")>()),
  focusViewportOnAllCharacters: actions.focusViewportOnAllCharacters,
  focusViewportOnPlayerCharacters: actions.focusViewportOnPlayerCharacters,
}));
vi.mock("./play-area", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./play-area")>()),
  PlayerPlayAreaEnforcer: class {
    constructor(playerId: string) {
      playArea.constructor(playerId);
    }
    initialize = playArea.initialize;
    setGlobalEnabled = playArea.setGlobalEnabled;
    refreshScene = playArea.refreshScene;
    handleSceneMetadata = playArea.handleSceneMetadata;
    enqueue = playArea.enqueue;
    dispose = playArea.dispose;
  },
}));

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
    state.readyCallbacks = [];
    sdk.player.id = "gm";
    sdk.player.getRole.mockResolvedValue("GM");
    sdk.scene.isReady.mockResolvedValue(true);
    sdk.player.getMetadata.mockResolvedValue({});
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
    expect(
      state.contextMenus.get(SET_PLAYER_PLAY_AREA_CONTEXT_MENU_ID)?.icons,
    ).toEqual([
      expect.objectContaining({
        label: "Set Play Area",
        filter: { roles: ["GM"], min: 1 },
      }),
    ]);

    state.contextMenus
      .get(SET_PLAYER_PLAY_AREA_CONTEXT_MENU_ID)
      ?.onClick?.({ items: state.items }, SET_PLAYER_PLAY_AREA_CONTEXT_MENU_ID);
    await vi.waitFor(() => {
      expect(state.sceneMetadata[PLAY_AREA_METADATA_KEY]).toEqual({
        version: 1,
        enabled: true,
        min: { x: 10, y: 20 },
        max: { x: 110, y: 220 },
      });
    });

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

describe("automatic focus startup lifecycle", () => {
  const settings = {
    autoFocusEnabled: true,
    gmAutoFocusEnabled: true,
    singleTokenZoom: 1.75,
    highlightEnabled: true,
    highlightThickness: 6,
    settingsExpanded: false,
    highlightColorMode: "CUSTOM",
    highlightColor: "#123456",
  };

  function storeSettings(playerId: string, overrides: object = {}): void {
    void playerId;
    sdk.player.getMetadata.mockResolvedValue({
      [PLAYER_SETTINGS_METADATA_KEY]: { ...settings, ...overrides },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.sceneMetadata = {};
    state.items = [];
    state.contextMenus.clear();
    state.itemChange = undefined;
    state.readyCallbacks = [];
    sdk.player.id = "gm";
    sdk.player.getRole.mockResolvedValue("GM");
    sdk.scene.isReady.mockResolvedValue(true);
    sdk.player.getMetadata.mockResolvedValue({});
  });

  it("runs GM autofocus on initialization with the GM's settings", async () => {
    storeSettings("gm");
    const controller = new BackgroundController();

    await controller.start();

    expect(actions.focusViewportOnAllCharacters).toHaveBeenCalledOnce();
    expect(actions.focusViewportOnAllCharacters).toHaveBeenCalledWith(
      1.75,
      true,
      HIGHLIGHT_COLOR,
      6,
    );
    expect(actions.focusViewportOnPlayerCharacters).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("runs GM autofocus when a new scene becomes ready", async () => {
    storeSettings("gm");
    const controller = new BackgroundController();
    await controller.start();
    actions.focusViewportOnAllCharacters.mockClear();

    for (const callback of state.readyCallbacks) callback(false);
    for (const callback of state.readyCallbacks) callback(true);

    await vi.waitFor(() => {
      expect(actions.focusViewportOnAllCharacters).toHaveBeenCalledOnce();
    });
    controller.dispose();
  });

  it("does not run GM autofocus when the setting is disabled", async () => {
    storeSettings("gm", { gmAutoFocusEnabled: false });
    const controller = new BackgroundController();
    await controller.start();

    for (const callback of state.readyCallbacks) callback(false);
    for (const callback of state.readyCallbacks) callback(true);

    await vi.waitFor(() => {
      expect(sdk.player.getMetadata).toHaveBeenCalledTimes(2);
    });
    expect(actions.focusViewportOnAllCharacters).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not initialize Player Play Area enforcement for a GM", async () => {
    storeSettings("gm", { gmAutoFocusEnabled: false });

    const controller = new BackgroundController();
    await controller.start();

    expect(playArea.constructor).not.toHaveBeenCalled();
    expect(playArea.initialize).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps PLAYER autofocus and Play Area initialization role-scoped", async () => {
    sdk.player.id = "player";
    sdk.player.getRole.mockResolvedValue("PLAYER");
    storeSettings("player");

    const controller = new BackgroundController();
    await controller.start();

    expect(playArea.constructor).toHaveBeenCalledWith("player");
    expect(playArea.initialize).toHaveBeenCalledWith(true);
    expect(actions.focusViewportOnPlayerCharacters).toHaveBeenCalledOnce();
    expect(actions.focusViewportOnAllCharacters).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps PLAYER autofocus disabled by the room global switch", async () => {
    sdk.player.id = "player";
    sdk.player.getRole.mockResolvedValue("PLAYER");
    sdk.room.getMetadata.mockResolvedValueOnce({
      [ROOM_SETTINGS_METADATA_KEY]: { globalEnabled: false },
    });
    storeSettings("player");

    const controller = new BackgroundController();
    await controller.start();

    expect(playArea.initialize).toHaveBeenCalledWith(false);
    expect(actions.focusViewportOnPlayerCharacters).not.toHaveBeenCalled();
    controller.dispose();
  });
});
