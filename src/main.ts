import OBR, { type Item, type Player, type Theme } from "@owlbear-rodeo/sdk";

import {
  FOCUS_BROADCAST_CHANNEL,
  GM_POPOVER_MAX_HEIGHT,
  GM_POPOVER_MIN_HEIGHT,
  PLAYER_POPOVER_MAX_HEIGHT,
  PLAYER_POPOVER_MIN_HEIGHT,
  POPOVER_WIDTH,
} from "./constants";
import {
  filterVisibleOwnedCharacters,
  formatCharacterName,
  formatPlayerName,
  groupVisibleCharactersByPlayer,
  groupPlayerConnections,
  normalizeZoomScale,
} from "./domain";
import {
  focusViewportOnCharacterItems,
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
  setPlayerSingleTokenZoom,
  setPlayerTargetIndicatorEnabled,
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
  #singleTokenZoom = 0.5;
  #targetIndicatorEnabled = true;
  #players: Player[] = [];
  #items: Item[] = [];
  readonly #expandedPlayerIds = new Set<string>();
  #busyAction: string | undefined;
  #status: Status | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  async start(): Promise<void> {
    document.documentElement.dataset.release = RELEASE_VERSION;

    try {
      const [role, theme, roomSettings, playerSettings] = await Promise.all([
        OBR.player.getRole(),
        OBR.theme.getTheme(),
        getRoomSettings(),
        getPlayerSettings(),
      ]);
      this.#role = role;
      this.#globalEnabled = roomSettings.globalEnabled;
      this.#autoFocusEnabled = playerSettings.autoFocusEnabled;
      this.#singleTokenZoom = playerSettings.singleTokenZoom;
      this.#targetIndicatorEnabled = playerSettings.targetIndicatorEnabled;
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
        OBR.player.onChange((player) => {
          const settings = readPlayerSettings(player.metadata);
          this.#autoFocusEnabled = settings.autoFocusEnabled;
          this.#singleTokenZoom = settings.singleTokenZoom;
          this.#targetIndicatorEnabled = settings.targetIndicatorEnabled;
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
    this.#items = await this.#getSceneItems();
    this.#disposeCallbacks.push(
      OBR.scene.items.onChange((items) => {
        this.#items = items;
        void this.#resizePlayerPopover().catch((error: unknown) => {
          console.error(
            "Where am I? could not resize the player popover.",
            error,
          );
        });
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
    await this.#resizePlayerPopover();
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
        void this.#resizeGmPopover().catch((error: unknown) => {
          console.error("Where am I? could not resize the GM popover.", error);
        });
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
      if (this.#role === "GM") {
        await this.#resizeGmPopover();
      } else {
        await this.#resizePlayerPopover();
      }
      this.#render();
    } catch (error) {
      console.error("Where am I? could not refresh character labels.", error);
    }
  }

  async #resizeGmPopover(): Promise<void> {
    const charactersByPlayer = groupVisibleCharactersByPlayer(this.#items);
    const expandedHeight = this.#players.reduce((total, player) => {
      const count = charactersByPlayer.get(player.id)?.length ?? 0;
      return (
        total +
        (this.#expandedPlayerIds.has(player.id) && count > 1
          ? 38 + count * 45
          : 0)
      );
    }, 0);
    const desiredHeight = 332 + this.#players.length * 66 + expandedHeight;
    await OBR.action.setHeight(
      Math.min(
        GM_POPOVER_MAX_HEIGHT,
        Math.max(GM_POPOVER_MIN_HEIGHT, desiredHeight),
      ),
    );
  }

  async #resizePlayerPopover(): Promise<void> {
    const characterCount = filterVisibleOwnedCharacters(
      this.#items,
      OBR.player.id,
    ).length;
    const desiredHeight =
      350 + (characterCount > 1 ? 42 + characterCount * 45 : 0);
    await OBR.action.setHeight(
      Math.min(
        PLAYER_POPOVER_MAX_HEIGHT,
        Math.max(PLAYER_POPOVER_MIN_HEIGHT, desiredHeight),
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

    controls.append(this.#createZoomField());
    controls.append(this.#createIndicatorToggle());

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

    const ownedCharacters = filterVisibleOwnedCharacters(
      this.#items,
      OBR.player.id,
    );
    if (ownedCharacters.length > 1) {
      const section = document.createElement("section");
      section.className = "party";
      const heading = document.createElement("div");
      heading.className = "section-heading";
      heading.innerHTML = "<h2>My characters</h2>";
      section.append(heading);

      const list = document.createElement("ul");
      list.className = "character-list";
      for (const character of ownedCharacters) {
        const row = document.createElement("li");
        row.className = "character-row";
        const name = document.createElement("span");
        name.className = "player-label";
        name.textContent = formatCharacterName(character.name);
        row.append(
          name,
          this.#createButton(
            this.#busyAction === `character-${character.id}`
              ? "Finding…"
              : "Find",
            "small",
            !this.#globalEnabled || this.#busyAction !== undefined,
            () => void this.#findCharacter(character.id),
            `Find ${name.textContent}`,
          ),
        );
        list.append(row);
      }
      section.append(list);
      controls.append(section);
    }

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
    controls.append(this.#createZoomField());
    controls.append(this.#createIndicatorToggle());
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
    const group = document.createElement("li");
    group.className = "player-group";
    const row = document.createElement("div");
    row.className = "player-row";

    const identity = document.createElement("div");
    identity.className = "player-identity";
    const color = document.createElement("span");
    color.className = "player-color";
    color.style.backgroundColor = player.color;
    color.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "player-label";
    label.textContent = formatPlayerName(player.id, player.name);
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
    group.append(row);

    const characters = filterVisibleOwnedCharacters(this.#items, player.id);
    if (characters.length > 1) {
      const details = document.createElement("details");
      details.className = "character-disclosure";
      details.open = this.#expandedPlayerIds.has(player.id);
      const summary = document.createElement("summary");
      summary.textContent = `Characters (${characters.length})`;
      details.append(summary);

      const list = document.createElement("ul");
      list.className = "character-list character-list--gm";
      for (const character of characters) {
        const characterRow = document.createElement("li");
        characterRow.className = "character-row character-row--gm";
        const name = document.createElement("span");
        name.className = "player-label";
        name.textContent = formatCharacterName(character.name);
        const characterActions = document.createElement("div");
        characterActions.className = "character-actions";
        characterActions.append(
          this.#createButton(
            this.#busyAction === `send-${player.id}-${character.id}`
              ? "Sending…"
              : "Send",
            "small",
            !this.#globalEnabled || this.#busyAction !== undefined,
            () => void this.#sendToPlayer(player.id, character.id),
            `Send ${name.textContent} to ${formatPlayerName(player.id, player.name)}`,
          ),
          this.#createButton(
            this.#busyAction === `view-${player.id}-${character.id}`
              ? "Viewing…"
              : "View",
            "small",
            this.#busyAction !== undefined,
            () => void this.#viewPlayer(player.id, character.id),
            `View ${name.textContent}`,
          ),
        );
        characterRow.append(name, characterActions);
        list.append(characterRow);
      }
      details.append(list);
      details.addEventListener("toggle", () => {
        if (details.open) {
          this.#expandedPlayerIds.add(player.id);
        } else {
          this.#expandedPlayerIds.delete(player.id);
        }
        void this.#resizeGmPopover().catch((error: unknown) => {
          console.error("Where am I? could not resize the GM popover.", error);
        });
      });
      group.append(details);
    }
    return group;
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

  #createZoomField(): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "setting-field";
    const text = document.createElement("span");
    text.className = "setting-label";
    text.textContent = "Single-character zoom";
    const value = document.createElement("span");
    value.className = "zoom-value";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "10";
    input.max = "200";
    input.step = "5";
    input.inputMode = "numeric";
    input.value = String(Math.round(this.#singleTokenZoom * 100));
    input.disabled = this.#busyAction !== undefined;
    input.setAttribute("aria-describedby", "zoom-unit");
    input.addEventListener("change", () => {
      const scale = normalizeZoomScale(Number(input.value) / 100);
      void this.#updateSingleTokenZoom(scale);
    });
    const unit = document.createElement("span");
    unit.id = "zoom-unit";
    unit.textContent = "%";
    value.append(input, unit);
    label.append(text, value);
    return label;
  }

  #createIndicatorToggle(): HTMLLabelElement {
    return this.#createToggle(
      "Show target indicators",
      this.#targetIndicatorEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updateTargetIndicatorPreference(enabled),
    );
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

  async #updateSingleTokenZoom(singleTokenZoom: number): Promise<void> {
    await this.#runAction("zoom-setting", async () => {
      await setPlayerSingleTokenZoom(singleTokenZoom);
      this.#singleTokenZoom = singleTokenZoom;
      this.#status = {
        message: `Single-character zoom set to ${Math.round(singleTokenZoom * 100)}%.`,
        tone: "success",
      };
    });
  }

  async #updateTargetIndicatorPreference(enabled: boolean): Promise<void> {
    await this.#runAction("indicator-setting", async () => {
      await setPlayerTargetIndicatorEnabled(enabled);
      this.#targetIndicatorEnabled = enabled;
      this.#status = {
        message: enabled
          ? "Target indicators are enabled."
          : "Target indicators are disabled.",
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
        await focusViewportOnPlayerCharacters(
          OBR.player.id,
          this.#singleTokenZoom,
          this.#targetIndicatorEnabled,
        ),
      );
    });
  }

  async #findCharacter(characterId: string): Promise<void> {
    await this.#runAction(`character-${characterId}`, async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      this.#setFocusStatus(
        await focusViewportOnCharacterItems(
          [characterId],
          this.#singleTokenZoom,
          this.#targetIndicatorEnabled,
        ),
      );
    });
  }

  async #sendToPlayer(
    playerId: string,
    targetCharacterId?: string,
  ): Promise<void> {
    const action = targetCharacterId
      ? `send-${playerId}-${targetCharacterId}`
      : `send-${playerId}`;
    await this.#runAction(action, async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      if ((await OBR.player.getRole()) !== "GM") {
        throw new Error("Only a GM can send a remote focus command.");
      }
      await OBR.broadcast.sendMessage(
        FOCUS_BROADCAST_CHANNEL,
        createFocusCommand(playerId, targetCharacterId),
        { destination: "REMOTE" },
      );
      this.#status = {
        message: "Remote focus command sent.",
        tone: "success",
      };
    });
  }

  async #viewPlayer(
    playerId: string,
    targetCharacterId?: string,
  ): Promise<void> {
    const action = targetCharacterId
      ? `view-${playerId}-${targetCharacterId}`
      : `view-${playerId}`;
    await this.#runAction(action, async () => {
      this.#setFocusStatus(
        await focusViewportOnPlayerCharacters(
          playerId,
          this.#singleTokenZoom,
          this.#targetIndicatorEnabled,
          targetCharacterId,
        ),
      );
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
          this.#singleTokenZoom,
          this.#targetIndicatorEnabled,
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
