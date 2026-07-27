import OBR, { type Item, type Player, type Theme } from "@owlbear-rodeo/sdk";

import {
  FOCUS_BROADCAST_CHANNEL,
  GM_POPOVER_MAX_HEIGHT,
  GM_POPOVER_MIN_HEIGHT,
  PLAYER_POPOVER_HEIGHT,
  POPOVER_WIDTH,
} from "./constants";
import {
  filterVisibleOwnedCharacters,
  formatPlayerLabel,
  groupPlayerConnections,
} from "./domain";
import {
  focusViewportOnPartyCharacters,
  focusViewportOnPlayerCharacters,
  type FocusResult,
} from "./focus";
import {
  getPlayerSettings,
  getRoomSettings,
  readPlayerSettings,
  readRoomSettings,
  setGlobalEnabled,
  setPlayerAutoFocusEnabled,
} from "./metadata";
import { createFocusCommand } from "./remote-focus";
import "./styles.css";
import { RELEASE_VERSION } from "./version";

type StatusTone = "neutral" | "success" | "warning" | "error";

interface Status {
  message: string;
  tone: StatusTone;
}

class PopoverController {
  readonly #root: HTMLElement;
  readonly #disposeCallbacks: Array<() => void> = [];
  #role: Player["role"] = "PLAYER";
  #globalEnabled = true;
  #autoFocusEnabled = true;
  #players: Player[] = [];
  #items: Item[] = [];
  #busyAction: string | undefined;
  #status: Status | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  async start(): Promise<void> {
    document.documentElement.dataset.release = RELEASE_VERSION;

    try {
      const [role, theme, roomSettings] = await Promise.all([
        OBR.player.getRole(),
        OBR.theme.getTheme(),
        getRoomSettings(),
      ]);
      this.#role = role;
      this.#globalEnabled = roomSettings.globalEnabled;
      this.#applyTheme(theme);

      this.#disposeCallbacks.push(
        OBR.theme.onChange((nextTheme) => this.#applyTheme(nextTheme)),
        OBR.room.onMetadataChange((metadata) => {
          this.#globalEnabled = readRoomSettings(metadata).globalEnabled;
          if (!this.#globalEnabled && this.#role === "PLAYER") {
            this.#status = {
              message: "The GM has disabled Where am I? for players.",
              tone: "warning",
            };
          }
          this.#render();
        }),
      );

      if (role === "GM") {
        await this.#startGmView();
      } else {
        await this.#startPlayerView();
      }
    } catch (error) {
      console.error("Where am I? popover failed to initialize.", error);
      this.#status = {
        message: "An unexpected Owlbear Rodeo error occurred.",
        tone: "error",
      };
    }

    this.#render();
  }

  dispose(): void {
    for (const dispose of this.#disposeCallbacks.splice(0)) {
      dispose();
    }
  }

  async #startPlayerView(): Promise<void> {
    try {
      this.#autoFocusEnabled = (await getPlayerSettings()).autoFocusEnabled;
    } catch (error) {
      console.error("Where am I? could not read the player preference.", error);
      this.#status = {
        message: "Your saved preference could not be read.",
        tone: "error",
      };
    }

    this.#disposeCallbacks.push(
      OBR.player.onChange((player) => {
        this.#autoFocusEnabled = readPlayerSettings(
          player.metadata,
        ).autoFocusEnabled;
        this.#render();
      }),
    );
    await Promise.all([
      OBR.action.setWidth(POPOVER_WIDTH),
      OBR.action.setHeight(PLAYER_POPOVER_HEIGHT),
    ]);
  }

  async #startGmView(): Promise<void> {
    const [players, items] = await Promise.all([
      OBR.party.getPlayers(),
      this.#getSceneItems(),
    ]);
    this.#players = groupPlayerConnections(players);
    this.#items = items;

    this.#disposeCallbacks.push(
      OBR.party.onChange((players) => {
        this.#players = groupPlayerConnections(players);
        void this.#resizeGmPopover().catch((error: unknown) => {
          console.error("Where am I? could not resize the GM popover.", error);
        });
        this.#render();
      }),
      OBR.scene.items.onChange((items) => {
        this.#items = items;
        this.#render();
      }),
      OBR.scene.onReadyChange((ready) => {
        if (ready) {
          void this.#refreshItems();
        } else {
          this.#items = [];
          this.#render();
        }
      }),
    );
    await OBR.action.setWidth(POPOVER_WIDTH);
    await this.#resizeGmPopover();
  }

  async #getSceneItems(): Promise<Item[]> {
    if (!(await OBR.scene.isReady())) {
      return [];
    }
    return OBR.scene.items.getItems();
  }

  async #refreshItems(): Promise<void> {
    try {
      this.#items = await this.#getSceneItems();
      this.#render();
    } catch (error) {
      console.error("Where am I? could not refresh character labels.", error);
    }
  }

  async #resizeGmPopover(): Promise<void> {
    const desiredHeight = 230 + this.#players.length * 66;
    await OBR.action.setHeight(
      Math.min(
        GM_POPOVER_MAX_HEIGHT,
        Math.max(GM_POPOVER_MIN_HEIGHT, desiredHeight),
      ),
    );
  }

  #applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme.mode.toLowerCase();
    const style = document.documentElement.style;
    style.setProperty("--color-background", theme.background.paper);
    style.setProperty("--color-surface", theme.background.default);
    style.setProperty("--color-text", theme.text.primary);
    style.setProperty("--color-muted", theme.text.secondary);
    style.setProperty("--color-disabled", theme.text.disabled);
    style.setProperty("--color-primary", theme.primary.main);
    style.setProperty("--color-primary-text", theme.primary.contrastText);
  }

  #render(): void {
    this.#root.replaceChildren();

    const app = document.createElement("section");
    app.className = "app";
    app.setAttribute("aria-labelledby", "app-title");

    const header = document.createElement("header");
    header.className = "header";
    header.innerHTML = `
      <div>
        <p class="eyebrow">Viewport helper</p>
        <h1 id="app-title">Where am I?</h1>
      </div>
    `;
    app.append(header);

    if (this.#role === "GM") {
      app.append(this.#renderGmControls());
    } else {
      app.append(this.#renderPlayerControls());
    }

    const status = document.createElement("p");
    status.className = `status status--${this.#status?.tone ?? "neutral"}`;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent =
      this.#status?.message ??
      (this.#role === "GM"
        ? "Choose a local view or send a player to their character."
        : "Only your local viewport moves when you find yourself.");
    app.append(status);

    this.#root.append(app);
  }

  #renderPlayerControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "controls";

    const toggle = this.#createToggle(
      "Automatically find my character",
      this.#autoFocusEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updatePlayerPreference(enabled),
    );
    controls.append(toggle);

    const findButton = this.#createButton(
      this.#busyAction === "find-self" ? "Finding…" : "Find me now",
      "primary",
      !this.#globalEnabled || this.#busyAction !== undefined,
      () => void this.#findSelf(),
    );
    controls.append(findButton);

    if (!this.#globalEnabled) {
      const explanation = document.createElement("p");
      explanation.className = "help";
      explanation.textContent =
        "The GM has disabled player focusing. Your automatic preference is preserved.";
      controls.append(explanation);
    }

    return controls;
  }

  #renderGmControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "controls";
    controls.append(
      this.#createToggle(
        "Enable Where am I? for players",
        this.#globalEnabled,
        this.#busyAction !== undefined,
        (enabled) => void this.#updateGlobalSetting(enabled),
      ),
    );

    const section = document.createElement("section");
    section.className = "party";
    const heading = document.createElement("div");
    heading.className = "section-heading";
    heading.innerHTML = "<h2>Connected players</h2>";
    section.append(heading);

    if (this.#players.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No players are currently connected.";
      section.append(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "player-list";
      for (const player of this.#players) {
        list.append(this.#renderPlayerRow(player));
      }
      section.append(list);
    }

    controls.append(section);
    controls.append(
      this.#createButton(
        this.#busyAction === "whole-party"
          ? "Framing party…"
          : "View whole party",
        "secondary",
        this.#busyAction !== undefined || this.#players.length === 0,
        () => void this.#viewWholeParty(),
      ),
    );
    return controls;
  }

  #renderPlayerRow(player: Player): HTMLLIElement {
    const ownedCharacters = filterVisibleOwnedCharacters(
      this.#items,
      player.id,
    );
    const row = document.createElement("li");
    row.className = "player-row";

    const identity = document.createElement("div");
    identity.className = "player-identity";
    const color = document.createElement("span");
    color.className = "player-color";
    color.style.backgroundColor = player.color;
    color.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "player-label";
    label.textContent = formatPlayerLabel(
      player.id,
      ownedCharacters.map((item) => item.name),
    );
    identity.append(color, label);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      this.#createButton(
        this.#busyAction === `send-${player.id}`
          ? "Sending…"
          : "Send to character",
        "small",
        !this.#globalEnabled || this.#busyAction !== undefined,
        () => void this.#sendToPlayer(player.id),
      ),
      this.#createButton(
        this.#busyAction === `view-${player.id}`
          ? "Viewing…"
          : "View character",
        "small",
        this.#busyAction !== undefined,
        () => void this.#viewPlayer(player.id),
      ),
    );

    row.append(identity, actions);
    return row;
  }

  #createToggle(
    labelText: string,
    checked: boolean,
    disabled: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "toggle";
    const text = document.createElement("span");
    text.className = "toggle-label";
    text.textContent = labelText;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener("change", () => onChange(input.checked));
    const visual = document.createElement("span");
    visual.className = "switch";
    visual.setAttribute("aria-hidden", "true");
    label.append(text, input, visual);
    return label;
  }

  #createButton(
    text: string,
    variant: "primary" | "secondary" | "small",
    disabled: boolean,
    onClick: () => void,
    accessibleLabel?: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button--${variant}`;
    button.disabled = disabled;
    button.textContent = text;
    if (accessibleLabel) {
      button.setAttribute("aria-label", accessibleLabel);
      button.title = accessibleLabel;
    }
    button.addEventListener("click", onClick);
    return button;
  }

  async #runAction(
    action: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    if (this.#busyAction !== undefined) {
      return;
    }
    this.#busyAction = action;
    this.#render();
    try {
      await operation();
    } catch (error) {
      console.error(`Where am I? action "${action}" failed.`, error);
      this.#status = {
        message: "An unexpected Owlbear Rodeo error occurred.",
        tone: "error",
      };
    } finally {
      this.#busyAction = undefined;
      this.#render();
    }
  }

  async #updatePlayerPreference(enabled: boolean): Promise<void> {
    await this.#runAction("player-setting", async () => {
      await setPlayerAutoFocusEnabled(enabled);
      this.#autoFocusEnabled = enabled;
      this.#status = {
        message: enabled
          ? "Automatic finding is enabled."
          : "Automatic finding is disabled. Find me now remains available.",
        tone: "success",
      };
    });
  }

  async #updateGlobalSetting(enabled: boolean): Promise<void> {
    await this.#runAction("global-setting", async () => {
      await setGlobalEnabled(enabled);
      this.#globalEnabled = enabled;
      this.#status = {
        message: enabled
          ? "Player focusing is enabled."
          : "Player focusing is disabled. GM-local views remain available.",
        tone: "success",
      };
    });
  }

  async #findSelf(): Promise<void> {
    await this.#runAction("find-self", async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      this.#setFocusStatus(
        await focusViewportOnPlayerCharacters(OBR.player.id),
      );
    });
  }

  async #sendToPlayer(playerId: string): Promise<void> {
    await this.#runAction(`send-${playerId}`, async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      if ((await OBR.player.getRole()) !== "GM") {
        throw new Error("Only a GM can send a remote focus command.");
      }
      await OBR.broadcast.sendMessage(
        FOCUS_BROADCAST_CHANNEL,
        createFocusCommand(playerId),
        { destination: "REMOTE" },
      );
      this.#status = {
        message: "Remote focus command sent.",
        tone: "success",
      };
    });
  }

  async #viewPlayer(playerId: string): Promise<void> {
    await this.#runAction(`view-${playerId}`, async () => {
      this.#setFocusStatus(await focusViewportOnPlayerCharacters(playerId));
    });
  }

  async #viewWholeParty(): Promise<void> {
    await this.#runAction("whole-party", async () => {
      const currentPlayers = groupPlayerConnections(
        await OBR.party.getPlayers(),
      );
      this.#players = currentPlayers;
      this.#setFocusStatus(
        await focusViewportOnPartyCharacters(
          new Set(currentPlayers.map((player) => player.id)),
        ),
      );
    });
  }

  async #confirmGlobalEnabled(): Promise<boolean> {
    const enabled = (await getRoomSettings()).globalEnabled;
    this.#globalEnabled = enabled;
    if (!enabled) {
      this.#status = {
        message: "The GM has disabled Where am I? for players.",
        tone: "warning",
      };
    }
    return enabled;
  }

  #setFocusStatus(result: FocusResult): void {
    if (result.ok) {
      this.#status = {
        message:
          result.itemCount === 1
            ? "Character centered."
            : `${result.itemCount} characters framed together.`,
        tone: "success",
      };
      return;
    }

    if (result.reason === "SCENE_UNAVAILABLE") {
      this.#status = {
        message: "No scene is open and ready.",
        tone: "warning",
      };
    } else if (result.reason === "NOT_FOUND") {
      this.#status = {
        message: "No visible owned character was found.",
        tone: "warning",
      };
    } else {
      this.#status = {
        message: "An unexpected Owlbear Rodeo error occurred.",
        tone: "error",
      };
    }
  }
}

OBR.onReady(() => {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    throw new Error("Where am I? app root was not found.");
  }

  const controller = new PopoverController(root);
  void controller.start();
  window.addEventListener("pagehide", () => controller.dispose(), {
    once: true,
  });
});
