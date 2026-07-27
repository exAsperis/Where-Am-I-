import OBR from "@owlbear-rodeo/sdk";

import { FOCUS_BROADCAST_CHANNEL } from "./constants";
import { focusViewportOnPlayerCharacters } from "./focus";
import {
  getPlayerSettings,
  getRoomSettings,
  readRoomSettings,
} from "./metadata";
import { SceneReadinessTrigger } from "./readiness";
import { RecentRequestIds, routeFocusCommand } from "./remote-focus";

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
        FOCUS_BROADCAST_CHANNEL,
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

      const result = await focusViewportOnPlayerCharacters(this.#playerId);
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

      const decision = routeFocusCommand({
        data,
        currentPlayerId: this.#playerId,
        senderConnectionId,
        connectedPlayers,
        globalEnabled: this.#globalEnabled,
        recentRequestIds: this.#recentRequestIds,
      });

      if (decision.execute) {
        await focusViewportOnPlayerCharacters(this.#playerId);
      }
    } catch (error) {
      console.error(
        "Where am I? failed to handle a remote focus command.",
        error,
      );
    }
  }
}
