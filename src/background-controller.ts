import OBR from "@owlbear-rodeo/sdk";

import {
  LEGACY_FOCUS_BROADCAST_CHANNEL,
  TARGET_ACTION_BROADCAST_CHANNEL,
  FOCUS_PARTY_CONTEXT_MENU_ID,
  HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
  CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID,
  CANCEL_HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
  PENDING_FOCUS_PARTY_ITEM_METADATA_KEY,
  PENDING_HIGHLIGHT_PARTY_ITEM_METADATA_KEY,
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
import {
  cancelPendingPartyActionsForItems,
  formatPendingCanceledToast,
  formatPendingConfiguredToast,
  formatPendingConflictToast,
  getPendingPartyActions,
  getPendingTargetState,
  isElectedPendingExecutor,
  queuePendingPartyAction,
  removePendingPartyActions,
  synchronizePendingPartyMarkers,
} from "./pending-actions";

export class BackgroundController {
  readonly #disposeCallbacks: Array<() => void> = [];
  readonly #readiness = new SceneReadinessTrigger();
  readonly #recentRequestIds = new RecentRequestIds();
  #globalEnabled = true;
  #autoFocusInFlight = false;
  #autoFocusQueued = false;
  #disposed = false;
  #playerId = "";
  #gmConnectionId = "";
  #pendingInFlight = false;
  #pendingQueued = false;

  async start(): Promise<void> {
    const role = await OBR.player.getRole();
    if (role === "GM") {
      this.#gmConnectionId = await OBR.player.getConnectionId();
      this.#disposeCallbacks.push(
        OBR.broadcast.onMessage(TARGET_ACTION_BROADCAST_CHANNEL, ({ data }) => {
          void this.#relayGmPanelAction(data);
        }),
        OBR.scene.items.onChange(() => this.#requestPendingProcessing()),
        OBR.scene.onMetadataChange(() => this.#requestPendingProcessing()),
        OBR.party.onChange(() => this.#requestPendingProcessing()),
        OBR.room.onMetadataChange(() => this.#requestPendingProcessing()),
        OBR.scene.onReadyChange(() => this.#requestPendingProcessing()),
      );
      await this.#startGmContextMenus();
      this.#requestPendingProcessing();
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
          void this.#sendContextAction(action, context.items);
        },
      });
      this.#disposeCallbacks.push(() => {
        void OBR.contextMenu.remove(id);
      });
    };
    const createCancelMenu = async (
      id: string,
      label: string,
      action: TargetAction,
      markerKey: string,
    ): Promise<void> => {
      await OBR.contextMenu.create({
        id,
        icons: [
          {
            icon,
            label,
            filter: {
              roles: ["GM"],
              min: 1,
              some: [
                {
                  key: ["metadata", markerKey],
                  value: true,
                },
              ],
            },
          },
        ],
        onClick: (context) => {
          void this.#cancelContextActions(
            action,
            context.items.map((item) => item.id),
          );
        },
      });
      this.#disposeCallbacks.push(() => {
        void OBR.contextMenu.remove(id);
      });
    };
    await Promise.all([
      createMenu(FOCUS_PARTY_CONTEXT_MENU_ID, "Focus for Party", "FOCUS"),
      createMenu(
        HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
        "Highlight for Party",
        "HIGHLIGHT",
      ),
      createCancelMenu(
        CANCEL_FOCUS_PARTY_CONTEXT_MENU_ID,
        "Cancel pending focus",
        "FOCUS",
        PENDING_FOCUS_PARTY_ITEM_METADATA_KEY,
      ),
      createCancelMenu(
        CANCEL_HIGHLIGHT_PARTY_CONTEXT_MENU_ID,
        "Cancel pending highlight",
        "HIGHLIGHT",
        PENDING_HIGHLIGHT_PARTY_ITEM_METADATA_KEY,
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
    const actor = actorName.trim() || "The GM";
    const queued = await queuePendingPartyAction({
      action,
      targetIds: targets.map((target) => target.id),
      targetMode: "ALL_ITEMS",
      actorName: actor,
      targetLabel,
    });
    if (queued.kind === "CONFLICT") {
      await OBR.notification.show(
        formatPendingConflictToast(action, queued.item, queued.pending),
        "ERROR",
      );
      return;
    }
    if (queued.kind === "MISSING") return;
    if (queued.kind === "QUEUED") {
      await OBR.notification.show(
        formatPendingConfiguredToast(queued.pending),
        "INFO",
      );
      this.#requestPendingProcessing();
      return;
    }
    await OBR.broadcast.sendMessage(
      TARGET_ACTION_BROADCAST_CHANNEL,
      createTargetActionCommand(
        action,
        { scope: "PARTY" },
        queued.targetIds,
        false,
        "ALL_ITEMS",
        actor,
        targetLabel,
        { requireVisible: true },
      ),
      { destination: "REMOTE" },
    );
  }

  async #cancelContextActions(
    action: TargetAction,
    itemIds: readonly string[],
  ): Promise<void> {
    const removed = await cancelPendingPartyActionsForItems(action, itemIds);
    if (removed.length === 0) return;
    const message =
      removed.length === 1
        ? formatPendingCanceledToast(removed[0]!)
        : `${removed.length} pending ${action === "FOCUS" ? "Focus" : "Highlight"} for Party actions canceled.`;
    await OBR.notification.show(message, "INFO");
  }

  #requestPendingProcessing(): void {
    if (this.#disposed) return;
    if (this.#pendingInFlight) {
      this.#pendingQueued = true;
      return;
    }
    void this.#processPendingActions();
  }

  async #processPendingActions(): Promise<void> {
    this.#pendingInFlight = true;
    try {
      if (!(await OBR.scene.isReady())) return;
      const [pendingActions, players, roomSettings] = await Promise.all([
        getPendingPartyActions(),
        OBR.party.getPlayers(),
        getRoomSettings(),
      ]);
      if (!isElectedPendingExecutor(this.#gmConnectionId, players)) return;
      await synchronizePendingPartyMarkers(pendingActions);
      if (
        !roomSettings.globalEnabled ||
        !players.some((player) => player.role !== "GM")
      ) {
        return;
      }

      for (const pending of pendingActions) {
        const items = await OBR.scene.items.getItems(pending.targetIds);
        const targetState = getPendingTargetState(pending, items);
        if (targetState === "MISSING") {
          await removePendingPartyActions([pending.id]);
          continue;
        }
        if (targetState === "HIDDEN") continue;
        await OBR.broadcast.sendMessage(
          TARGET_ACTION_BROADCAST_CHANNEL,
          createTargetActionCommand(
            pending.action,
            { scope: "PARTY" },
            pending.targetIds,
            false,
            pending.targetMode,
            pending.actorName,
            pending.targetLabel,
            {
              requestId: pending.executionRequestId,
              sentAt: Date.now(),
              requireVisible: true,
            },
          ),
          { destination: "REMOTE" },
        );
        await removePendingPartyActions([pending.id]);
      }
    } catch (error) {
      console.error(
        "Where am I? could not process pending Party actions.",
        error,
      );
    } finally {
      this.#pendingInFlight = false;
      if (this.#pendingQueued) {
        this.#pendingQueued = false;
        this.#requestPendingProcessing();
      }
    }
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
              command.requireVisible,
            );
          } else if (command.targetMode === "ALL_ITEMS") {
            result = await focusViewportOnItems(
              command.targetCharacterIds,
              settings.singleTokenZoom,
              settings.highlightEnabled,
              highlightColor,
              command.requireVisible,
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
