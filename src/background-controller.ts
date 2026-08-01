import OBR from "@owlbear-rodeo/sdk";

import {
  LEGACY_FOCUS_BROADCAST_CHANNEL,
  TARGET_ACTION_BROADCAST_CHANNEL,
  FOCUS_PARTY_CONTEXT_MENU_ID,
  HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
} from "./constants";
import {
  focusViewportOnItems,
  focusViewportOnCharacterItems,
  focusViewportOnPlayerCharacters,
  highlightItems,
  highlightCharacterItems,
  type TargetActionResult,
} from "./target-actions";
import {
  getPlayerSettings,
  getRoomSettings,
  readRoomSettings,
  resolveHighlightColor,
} from "./metadata";
import { SceneReadinessTrigger } from "./readiness";
import {
  createLegacyFocusCommand,
  createTargetActionCommand,
  formatTargetActionToast,
  isTargetActionCommand,
  RecentRequestIds,
  routeTargetAction,
  type TargetAction,
} from "./remote-actions";

export class BackgroundController {
  readonly #disposeCallbacks: Array<() => void> = [];
  readonly #readiness = new SceneReadinessTrigger();
  readonly #recentRequestIds = new RecentRequestIds();
  #globalEnabled = true;
  #autoFocusInFlight = false;
  #autoFocusQueued = false;
  #disposed = false;
  #playerId = "";

  async start(): Promise<void> {
    const role = await OBR.player.getRole();
    if (role === "GM") {
      this.#disposeCallbacks.push(
        OBR.broadcast.onMessage(TARGET_ACTION_BROADCAST_CHANNEL, ({ data }) => {
          void this.#relayGmPanelAction(data);
        }),
      );
      await this.#startGmContextMenus();
      return;
    }

    this.#playerId = OBR.player.id;

    try {
      this.#globalEnabled = (await getRoomSettings()).globalEnabled;
    } catch (error) {
      console.error(
        "Where am I? could not read the global setting; using its enabled default.",
        error,
      );
    }

    this.#disposeCallbacks.push(
      OBR.room.onMetadataChange((metadata) => {
        this.#globalEnabled = readRoomSettings(metadata).globalEnabled;
      }),
      OBR.scene.onReadyChange((ready) => {
        if (this.#readiness.observe(ready)) {
          void this.#runAutomaticFocus("scene change");
        }
      }),
      OBR.broadcast.onMessage(
        TARGET_ACTION_BROADCAST_CHANNEL,
        ({ data, connectionId }) => {
          void this.#handleRemoteCommand(data, connectionId);
        },
      ),
      OBR.broadcast.onMessage(
        LEGACY_FOCUS_BROADCAST_CHANNEL,
        ({ data, connectionId }) => {
          void this.#handleRemoteCommand(data, connectionId);
        },
      ),
    );

    try {
      const ready = await OBR.scene.isReady();
      if (this.#readiness.observe(ready)) {
        await this.#runAutomaticFocus("initialization");
      }
    } catch (error) {
      console.error(
        "Where am I? could not read initial scene readiness.",
        error,
      );
    }
  }

  async #relayGmPanelAction(data: unknown): Promise<void> {
    if (!isTargetActionCommand(data)) return;
    await OBR.broadcast.sendMessage(TARGET_ACTION_BROADCAST_CHANNEL, data, {
      destination: "REMOTE",
    });
    if (data.action === "FOCUS" && data.recipient.scope === "PLAYER") {
      await OBR.broadcast.sendMessage(
        LEGACY_FOCUS_BROADCAST_CHANNEL,
        createLegacyFocusCommand(
          data.recipient.playerId,
          data.requestId,
          data.targetCharacterIds.length === 1
            ? data.targetCharacterIds[0]
            : undefined,
        ),
        { destination: "REMOTE" },
      );
    }
  }

  async #startGmContextMenus(): Promise<void> {
    const icon = `${import.meta.env.BASE_URL}icon.svg`;
    const createMenu = async (
      id: string,
      label: string,
      action: TargetAction,
    ): Promise<void> => {
      await OBR.contextMenu.create({
        id,
        icons: [{ icon, label, filter: { roles: ["GM"], min: 1 } }],
        onClick: (context) => {
          void this.#sendContextAction(
            action,
            context.items.map((item) => ({ id: item.id, name: item.name })),
          );
        },
      });
      this.#disposeCallbacks.push(() => {
        void OBR.contextMenu.remove(id);
      });
    };
    await Promise.all([
      createMenu(FOCUS_PARTY_CONTEXT_MENU_ID, "Focus → Party", "FOCUS"),
      createMenu(
        HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
        "Highlight → Party",
        "HIGHLIGHT",
      ),
    ]);
  }

  async #sendContextAction(
    action: TargetAction,
    targets: Array<{ id: string; name: string }>,
  ): Promise<void> {
    if (targets.length === 0) return;
    const [roomSettings, actorName] = await Promise.all([
      getRoomSettings(),
      OBR.player.getName(),
    ]);
    if (!roomSettings.globalEnabled) return;
    const targetLabel =
      targets.length === 1
        ? targets[0]?.name.trim() || "an item"
        : `${targets.length} selected items`;
    await OBR.broadcast.sendMessage(
      TARGET_ACTION_BROADCAST_CHANNEL,
      createTargetActionCommand(
        action,
        { scope: "PARTY" },
        targets.map((target) => target.id),
        true,
        "ALL_ITEMS",
        actorName.trim() || "The GM",
        targetLabel,
      ),
      { destination: "REMOTE" },
    );
  }

  dispose(): void {
    this.#disposed = true;
    for (const dispose of this.#disposeCallbacks.splice(0)) {
      dispose();
    }
  }

  async #runAutomaticFocus(trigger: string): Promise<void> {
    if (this.#disposed || !this.#globalEnabled) {
      return;
    }
    if (this.#autoFocusInFlight) {
      this.#autoFocusQueued = true;
      return;
    }

    this.#autoFocusInFlight = true;
    try {
      const [settings, roomSettings] = await Promise.all([
        getPlayerSettings(),
        getRoomSettings(),
      ]);
      if (!this.#globalEnabled || !settings.autoFocusEnabled) {
        return;
      }

      const result = await focusViewportOnPlayerCharacters(
        this.#playerId,
        settings.singleTokenZoom,
        settings.highlightEnabled,
        undefined,
        resolveHighlightColor("PLAYER", settings, roomSettings),
      );
      if (!result.ok && result.reason === "SDK_ERROR") {
        console.error(`Where am I? automatic focus failed during ${trigger}.`);
      }
    } catch (error) {
      console.error(
        `Where am I? could not resolve automatic focus during ${trigger}.`,
        error,
      );
    } finally {
      this.#autoFocusInFlight = false;
      if (this.#autoFocusQueued) {
        this.#autoFocusQueued = false;
        void this.#runAutomaticFocus("queued scene change");
      }
    }
  }

  async #handleRemoteCommand(
    data: unknown,
    senderConnectionId: string,
  ): Promise<void> {
    try {
      const [roomSettings, connectedPlayers] = await Promise.all([
        getRoomSettings(),
        OBR.party.getPlayers(),
      ]);
      this.#globalEnabled = roomSettings.globalEnabled;

      const decision = routeTargetAction({
        data,
        currentPlayerId: this.#playerId,
        senderConnectionId,
        connectedPlayers,
        globalEnabled: this.#globalEnabled,
        recentRequestIds: this.#recentRequestIds,
      });

      if (decision.execute) {
        const settings = await getPlayerSettings();
        const highlightColor = resolveHighlightColor(
          "PLAYER",
          settings,
          roomSettings,
        );
        if (decision.routed.kind === "LEGACY_FOCUS") {
          await focusViewportOnPlayerCharacters(
            this.#playerId,
            settings.singleTokenZoom,
            settings.highlightEnabled,
            decision.routed.command.targetCharacterId,
            highlightColor,
          );
        } else {
          const command = decision.routed.command;
          let result: TargetActionResult;
          if (
            command.targetMode === "ALL_ITEMS" &&
            command.action === "HIGHLIGHT"
          ) {
            result = await highlightItems(
              command.targetCharacterIds,
              highlightColor,
            );
          } else if (command.targetMode === "ALL_ITEMS") {
            result = await focusViewportOnItems(
              command.targetCharacterIds,
              settings.singleTokenZoom,
              settings.highlightEnabled,
              highlightColor,
            );
          } else if (command.action === "HIGHLIGHT") {
            result = await highlightCharacterItems(
              command.targetCharacterIds,
              command.includeHidden,
              highlightColor,
            );
          } else {
            result = await focusViewportOnCharacterItems(
              command.targetCharacterIds,
              settings.singleTokenZoom,
              settings.highlightEnabled,
              command.includeHidden,
              highlightColor,
            );
          }
          const toast = formatTargetActionToast(command);
          if (result.ok && toast) {
            await OBR.notification.show(toast, "INFO");
          }
        }
      }
    } catch (error) {
      console.error(
        "Where am I? failed to handle a remote focus command.",
        error,
      );
    }
  }
}
