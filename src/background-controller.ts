import OBR from "@owlbear-rodeo/sdk";

import { TARGET_ACTION_BROADCAST_CHANNEL } from "./constants";
import {
  focusViewportOnCharacterItems,
  focusViewportOnPlayerCharacters,
  highlightCharacterItems,
} from "./target-actions";
import {
  getPlayerSettings,
  getRoomSettings,
  readRoomSettings,
} from "./metadata";
import { SceneReadinessTrigger } from "./readiness";
import { RecentRequestIds, routeTargetAction } from "./remote-actions";

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
    if (role !== "PLAYER") {
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
      const settings = await getPlayerSettings();
      if (!this.#globalEnabled || !settings.autoFocusEnabled) {
        return;
      }

      const result = await focusViewportOnPlayerCharacters(
        this.#playerId,
        settings.singleTokenZoom,
        settings.highlightEnabled,
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
        if (decision.routed.kind === "LEGACY_FOCUS") {
          await focusViewportOnPlayerCharacters(
            this.#playerId,
            settings.singleTokenZoom,
            settings.highlightEnabled,
            decision.routed.command.targetCharacterId,
          );
        } else {
          const command = decision.routed.command;
          if (command.action === "HIGHLIGHT") {
            await highlightCharacterItems(
              command.targetCharacterIds,
              command.includeHidden,
            );
          } else {
            await focusViewportOnCharacterItems(
              command.targetCharacterIds,
              settings.singleTokenZoom,
              settings.highlightEnabled,
              command.includeHidden,
            );
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
