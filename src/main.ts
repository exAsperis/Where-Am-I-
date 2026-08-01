import OBR, { type Item, type Player, type Theme } from "@owlbear-rodeo/sdk";

import {
  TARGET_ACTION_BROADCAST_CHANNEL,
  GM_POPOVER_MAX_HEIGHT,
  GM_POPOVER_MIN_HEIGHT,
  PLAYER_POPOVER_MAX_HEIGHT,
  PLAYER_POPOVER_MIN_HEIGHT,
  POPOVER_WIDTH,
} from "./constants";
import {
  filterVisibleOwnedCharacters,
  filterCharacterTokens,
  formatCharacterName,
  formatPlayerName,
  getCharacterDisplay,
  groupPlayerConnections,
  normalizeZoomScale,
} from "./domain";
import {
  focusViewportOnCharacterItems,
  focusViewportOnPlayerCharacters,
  highlightCharacterItems,
  type TargetActionResult,
} from "./target-actions";
import {
  getPlayerSettings,
  getRoomSettings,
  readPlayerSettings,
  readRoomSettings,
  setGlobalEnabled,
  setPlayerAutoFocusEnabled,
  setPlayerSingleTokenZoom,
  setPlayerHighlightEnabled,
} from "./metadata";
import {
  createTargetActionCommand,
  type TargetAction,
  type TargetRecipient,
} from "./remote-actions";
import {
  moveCharacterTokenToViewportCenter,
  toggleCharacterTokenVisibility,
} from "./token-actions";
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
  #highlightEnabled = true;
  #players: Player[] = [];
  #items: Item[] = [];
  readonly #expandedPlayerIds = new Set<string>();
  #allCharactersExpanded = false;
  #busyAction: string | undefined;
  #status: Status | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  async start(): Promise<void> {
    document.documentElement.dataset.release = RELEASE_VERSION;
    const dismissMenus = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".action-menu")) return;
      for (const menu of this.#root.querySelectorAll<HTMLElement>(
        ".action-menu--open",
      )) {
        menu.classList.remove("action-menu--open");
        menu
          .querySelector<HTMLElement>("[aria-expanded]")
          ?.setAttribute("aria-expanded", "false");
      }
    };
    document.addEventListener("pointerdown", dismissMenus);
    this.#disposeCallbacks.push(() =>
      document.removeEventListener("pointerdown", dismissMenus),
    );

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
      this.#highlightEnabled = playerSettings.highlightEnabled;
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
          this.#highlightEnabled = settings.highlightEnabled;
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
    await OBR.action.setHeight(PLAYER_POPOVER_MIN_HEIGHT);
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
    await OBR.action.setHeight(GM_POPOVER_MIN_HEIGHT);
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
    const desiredHeight = this.#measureRenderedHeight(GM_POPOVER_MIN_HEIGHT);
    await OBR.action.setHeight(
      Math.min(
        GM_POPOVER_MAX_HEIGHT,
        Math.max(GM_POPOVER_MIN_HEIGHT, desiredHeight),
      ),
    );
  }

  async #resizePlayerPopover(): Promise<void> {
    const desiredHeight = this.#measureRenderedHeight(
      PLAYER_POPOVER_MIN_HEIGHT,
    );
    await OBR.action.setHeight(
      Math.min(
        PLAYER_POPOVER_MAX_HEIGHT,
        Math.max(PLAYER_POPOVER_MIN_HEIGHT, desiredHeight),
      ),
    );
  }

  #measureRenderedHeight(fallbackHeight: number): number {
    const app = this.#root.querySelector<HTMLElement>(".app");
    return app ? Math.ceil(app.scrollHeight) + 2 : fallbackHeight;
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
        ? "Choose an action and who should see it."
        : "Only your local viewport moves when you focus yourself.");
    app.append(status);

    this.#root.append(app);
    const resize =
      this.#role === "GM"
        ? this.#resizeGmPopover()
        : this.#resizePlayerPopover();
    void resize.catch((error: unknown) => {
      console.error("Where am I? could not resize the popover.", error);
    });
  }

  #renderPlayerControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "controls";

    controls.append(this.#createZoomField());
    controls.append(this.#createHighlightToggle());

    const toggle = this.#createToggle(
      "Automatically focus my character",
      this.#autoFocusEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updatePlayerPreference(enabled),
    );
    controls.append(toggle);

    const focusButton = this.#createButton(
      this.#busyAction === "focus-self" ? "Focusing…" : "Focus me now",
      "primary",
      !this.#globalEnabled || this.#busyAction !== undefined,
      () => void this.#focusSelf(),
    );
    controls.append(focusButton);

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
        const identity = this.#createCharacterIdentity(character);
        const characterLabel = formatCharacterName(character.name);
        row.append(
          identity,
          this.#createButton(
            this.#busyAction === `character-${character.id}`
              ? "Focusing…"
              : "Focus",
            "small",
            !this.#globalEnabled || this.#busyAction !== undefined,
            () => void this.#focusCharacter(character.id),
            `Focus ${characterLabel}`,
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
    controls.append(this.#createHighlightToggle());
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
    const partyTile = document.createElement("section");
    partyTile.className = "action-tile";
    const partyTitle = document.createElement("h2");
    partyTitle.textContent = "Party";
    const partyActions = document.createElement("div");
    partyActions.className = "action-menu-row";
    const connectedIds = new Set(this.#players.map((player) => player.id));
    const targets = this.#items.filter(
      (item) =>
        item.layer === "CHARACTER" &&
        item.visible &&
        connectedIds.has(item.createdUserId),
    );
    partyActions.append(
      this.#createGmActionMenu("FOCUS", targets, false, undefined, "Party"),
      this.#createGmActionMenu("HIGHLIGHT", targets, false, undefined, "Party"),
    );
    partyTile.append(partyTitle, partyActions);
    controls.append(partyTile);
    controls.append(this.#renderAllCharacterTokens());
    return controls;
  }

  #renderAllCharacterTokens(): HTMLElement {
    const characters = filterCharacterTokens(this.#items);
    const details = document.createElement("details");
    details.className = "character-disclosure character-disclosure--all";
    details.open = this.#allCharactersExpanded;

    const summary = document.createElement("summary");
    summary.textContent = `All character tokens (${characters.length})`;
    details.append(summary);

    if (characters.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No character tokens are in the current scene.";
      details.append(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "character-list";
      for (const character of characters) {
        const row = document.createElement("li");
        row.className = "character-row character-row--gm character-row--all";
        const display = this.#createCharacterIdentity(character);
        const actions = document.createElement("div");
        actions.className = "character-actions character-actions--all";
        const label = getCharacterDisplay(character).characterName;
        actions.append(
          this.#createGmActionMenu(
            "FOCUS",
            [character],
            true,
            undefined,
            label,
          ),
          this.#createGmActionMenu(
            "HIGHLIGHT",
            [character],
            true,
            undefined,
            label,
          ),
        );
        const management = document.createElement("div");
        management.className = "token-management-actions";
        management.append(
          this.#createButton(
            this.#busyAction === `visibility-token-${character.id}`
              ? "Updating…"
              : character.visible
                ? "Hide"
                : "Show",
            "small",
            this.#busyAction !== undefined,
            () => void this.#toggleTokenVisibility(character.id),
            `${character.visible ? "Hide" : "Show"} ${label}`,
          ),
          this.#createButton(
            this.#busyAction === `move-token-${character.id}`
              ? "Moving…"
              : "Move",
            "small",
            this.#busyAction !== undefined,
            () => void this.#moveTokenToViewportCenter(character.id),
            `Move ${label} to the center of the viewport`,
          ),
        );
        actions.append(management);
        row.append(display, actions);
        list.append(row);
      }
      details.append(list);
    }

    details.addEventListener("toggle", () => {
      this.#allCharactersExpanded = details.open;
      void this.#resizeGmPopover().catch((error: unknown) => {
        console.error("Where am I? could not resize the GM popover.", error);
      });
    });
    return details;
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
    const playerTargets = filterVisibleOwnedCharacters(this.#items, player.id);
    const playerLabel = formatPlayerName(player.id, player.name);
    actions.append(
      this.#createGmActionMenu(
        "FOCUS",
        playerTargets,
        false,
        player.id,
        playerLabel,
      ),
      this.#createGmActionMenu(
        "HIGHLIGHT",
        playerTargets,
        false,
        player.id,
        playerLabel,
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
        const name = this.#createCharacterIdentity(character);
        const characterLabel = formatCharacterName(character.name);
        const characterActions = document.createElement("div");
        characterActions.className = "character-actions";
        characterActions.append(
          this.#createGmActionMenu(
            "FOCUS",
            [character],
            false,
            player.id,
            characterLabel,
          ),
          this.#createGmActionMenu(
            "HIGHLIGHT",
            [character],
            false,
            player.id,
            characterLabel,
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

  #createCharacterIdentity(character: Item): HTMLElement {
    const display = getCharacterDisplay(character);
    const identity = document.createElement("div");
    identity.className = "character-identity";

    if (display.imageUrl) {
      const image = document.createElement("img");
      image.className = "character-thumbnail";
      image.src = display.imageUrl;
      image.alt = "";
      identity.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className =
        "character-thumbnail character-thumbnail--placeholder";
      placeholder.textContent = "?";
      placeholder.setAttribute("aria-hidden", "true");
      identity.append(placeholder);
    }

    const labels = document.createElement("span");
    labels.className = "character-labels";
    if (display.tokenText) {
      const tokenText = document.createElement("span");
      tokenText.className = "character-token-text";
      tokenText.textContent = display.tokenText;
      labels.append(tokenText);
    }
    const characterName = document.createElement("span");
    characterName.className = "character-name";
    characterName.textContent = display.characterName;
    labels.append(characterName);
    identity.append(labels);
    return identity;
  }

  #createGmActionMenu(
    action: TargetAction,
    targets: readonly Item[],
    includeHidden: boolean,
    controllingPlayerId: string | undefined,
    targetLabel: string,
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "action-menu";
    const trigger = this.#createButton(
      action === "FOCUS" ? "Focus ▾" : "Highlight ▾",
      "small",
      this.#busyAction !== undefined || targets.length === 0,
      () => {
        const open = container.classList.toggle("action-menu--open");
        trigger.setAttribute("aria-expanded", String(open));
        if (open) {
          container
            .querySelector<HTMLButtonElement>('[role="menuitem"]')
            ?.focus();
        }
      },
      `${action === "FOCUS" ? "Focus" : "Highlight"} ${targetLabel}`,
    );
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "action-menu__items";
    menu.setAttribute("role", "menu");
    const recipients: Array<{ label: string; recipient?: TargetRecipient }> = [
      { label: "Me" },
      ...(controllingPlayerId
        ? [
            {
              label: "Player",
              recipient: {
                scope: "PLAYER" as const,
                playerId: controllingPlayerId,
              },
            },
          ]
        : []),
      { label: "Party", recipient: { scope: "PARTY" } },
    ];
    for (const option of recipients) {
      const item = this.#createButton(
        option.label,
        "small",
        option.recipient !== undefined && !this.#globalEnabled,
        () => {
          container.classList.remove("action-menu--open");
          trigger.setAttribute("aria-expanded", "false");
          void this.#performGmTargetAction(
            action,
            option.recipient,
            targets,
            includeHidden,
          );
        },
        `${action === "FOCUS" ? "Focus" : "Highlight"} ${targetLabel} for ${option.label}`,
      );
      item.setAttribute("role", "menuitem");
      menu.append(item);
    }
    container.addEventListener("keydown", (event) => {
      const items = [
        ...menu.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)',
        ),
      ];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") {
        container.classList.remove("action-menu--open");
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      } else if (event.key === "ArrowDown" && items.length > 0) {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp" && items.length > 0) {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      }
    });
    container.addEventListener("focusout", () => {
      queueMicrotask(() => {
        if (!container.contains(document.activeElement)) {
          container.classList.remove("action-menu--open");
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    });
    container.append(trigger, menu);
    return container;
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

  #createHighlightToggle(): HTMLLabelElement {
    return this.#createToggle(
      "Show highlights",
      this.#highlightEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updateHighlightPreference(enabled),
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
          ? "Automatic focusing is enabled."
          : "Automatic focusing is disabled. Focus me now remains available.",
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

  async #updateHighlightPreference(enabled: boolean): Promise<void> {
    await this.#runAction("highlight-setting", async () => {
      await setPlayerHighlightEnabled(enabled);
      this.#highlightEnabled = enabled;
      this.#status = {
        message: enabled
          ? "Highlights are enabled."
          : "Highlights are disabled.",
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
          : "Player focusing is disabled. GM-local focusing remains available.",
        tone: "success",
      };
    });
  }

  async #focusSelf(): Promise<void> {
    await this.#runAction("focus-self", async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      this.#setTargetActionStatus(
        await focusViewportOnPlayerCharacters(
          OBR.player.id,
          this.#singleTokenZoom,
          this.#highlightEnabled,
        ),
      );
    });
  }

  async #focusCharacter(characterId: string): Promise<void> {
    await this.#runAction(`character-${characterId}`, async () => {
      if (!(await this.#confirmGlobalEnabled())) {
        return;
      }
      this.#setTargetActionStatus(
        await focusViewportOnCharacterItems(
          [characterId],
          this.#singleTokenZoom,
          this.#highlightEnabled,
        ),
      );
    });
  }

  async #performGmTargetAction(
    action: TargetAction,
    recipient: TargetRecipient | undefined,
    targets: readonly Item[],
    includeHidden: boolean,
  ): Promise<void> {
    const actionId = `${action.toLowerCase()}-${recipient?.scope.toLowerCase() ?? "me"}`;
    await this.#runAction(actionId, async () => {
      if (recipient) {
        if (!(await this.#confirmGlobalEnabled())) return;
        if ((await OBR.player.getRole()) !== "GM") {
          throw new Error("Only a GM can send a remote target action.");
        }
        await OBR.broadcast.sendMessage(
          TARGET_ACTION_BROADCAST_CHANNEL,
          createTargetActionCommand(
            action,
            recipient,
            targets.map((target) => target.id),
            includeHidden,
          ),
          { destination: "REMOTE" },
        );
        this.#status = {
          message: `${action === "FOCUS" ? "Focus" : "Highlight"} sent to ${recipient.scope === "PARTY" ? "the party" : "the player"}.`,
          tone: "success",
        };
        return;
      }
      const result =
        action === "HIGHLIGHT"
          ? await highlightCharacterItems(targets, includeHidden)
          : await focusViewportOnCharacterItems(
              targets,
              this.#singleTokenZoom,
              this.#highlightEnabled,
              includeHidden,
            );
      this.#setTargetActionStatus(result, action);
    });
  }

  async #toggleTokenVisibility(characterId: string): Promise<void> {
    await this.#runAction(`visibility-token-${characterId}`, async () => {
      const visible = await toggleCharacterTokenVisibility(characterId);
      this.#status = {
        message: `Character token ${visible ? "shown" : "hidden"}.`,
        tone: "success",
      };
    });
  }

  async #moveTokenToViewportCenter(characterId: string): Promise<void> {
    await this.#runAction(`move-token-${characterId}`, async () => {
      await moveCharacterTokenToViewportCenter(characterId);
      this.#status = {
        message: "Character token moved to the viewport center.",
        tone: "success",
      };
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

  #setTargetActionStatus(
    result: TargetActionResult,
    action: TargetAction = "FOCUS",
  ): void {
    if (result.ok) {
      this.#status = {
        message:
          result.itemCount === 1
            ? action === "FOCUS"
              ? "Character focused."
              : "Character highlighted."
            : action === "FOCUS"
              ? `${result.itemCount} characters focused together.`
              : `${result.itemCount} characters highlighted.`,
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
