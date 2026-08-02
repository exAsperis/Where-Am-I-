import OBR, { type Item, type Player, type Theme } from "@owlbear-rodeo/sdk";

import {
  TARGET_ACTION_BROADCAST_CHANNEL,
  GM_POPOVER_MAX_HEIGHT,
  GM_POPOVER_MIN_HEIGHT,
  HIGHLIGHT_COLOR,
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
  getGmPlayerAvailabilityHint,
  getOwnedTargetAvailability,
  getPartyAvailabilityHint,
  getPartyTargetAvailability,
  getPlayerAvailabilityHint,
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
  setPlayerSettingsExpanded,
  setPlayerHighlightColor,
  setRoomHighlightColor,
  setShowMoveHere,
} from "./metadata";
import {
  createTargetActionCommand,
  type TargetAction,
  type TargetRecipient,
} from "./remote-actions";
import {
  cancelPendingPartyActionsForItems,
  findPendingActionForItem,
  formatPendingCanceledToast,
  formatPendingConfiguredToast,
  formatPendingConflictToast,
  getPendingPartyActions,
  queuePendingPartyAction,
  readPendingPartyActions,
  type PendingPartyAction,
} from "./pending-actions";
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
  #showMoveHere = false;
  #autoFocusEnabled = true;
  #singleTokenZoom = 0.5;
  #highlightEnabled = true;
  #settingsExpanded = false;
  #playerHighlightColorMode: "DEFAULT" | "CUSTOM" = "DEFAULT";
  #playerHighlightColor = "#fa5300";
  #roomHighlightColorMode: "DEFAULT" | "CUSTOM" = "DEFAULT";
  #roomHighlightColor = "#fa5300";
  #players: Player[] = [];
  #items: Item[] = [];
  readonly #expandedPlayerIds = new Set<string>();
  #allCharactersExpanded = false;
  #busyAction: string | undefined;
  #status: Status | undefined;
  #helpId = 0;
  #availabilityId = 0;
  #sceneReady = false;
  #ownerOnlyEnabled = false;
  #pendingActions: PendingPartyAction[] = [];

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  async start(): Promise<void> {
    document.documentElement.dataset.release = RELEASE_VERSION;
    const dismissMenus = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element && target.closest(".action-menu"))) {
        for (const menu of this.#root.querySelectorAll<HTMLElement>(
          ".action-menu--open",
        )) {
          menu.classList.remove("action-menu--open");
          menu
            .querySelector<HTMLElement>("[aria-expanded]")
            ?.setAttribute("aria-expanded", "false");
        }
      }
      if (!(target instanceof Element && target.closest(".setting-help"))) {
        for (const help of this.#root.querySelectorAll<HTMLElement>(
          ".setting-help--open",
        )) {
          help.classList.remove("setting-help--open");
          help
            .querySelector<HTMLElement>("[aria-expanded]")
            ?.setAttribute("aria-expanded", "false");
        }
      }
    };
    document.addEventListener("pointerdown", dismissMenus);
    this.#disposeCallbacks.push(() =>
      document.removeEventListener("pointerdown", dismissMenus),
    );

    try {
      const [
        role,
        theme,
        roomSettings,
        playerSettings,
        sceneReady,
        permissions,
      ] = await Promise.all([
        OBR.player.getRole(),
        OBR.theme.getTheme(),
        getRoomSettings(),
        getPlayerSettings(),
        OBR.scene.isReady(),
        OBR.room.getPermissions(),
      ]);
      this.#role = role;
      this.#globalEnabled = roomSettings.globalEnabled;
      this.#showMoveHere = roomSettings.showMoveHere;
      this.#autoFocusEnabled = playerSettings.autoFocusEnabled;
      this.#singleTokenZoom = playerSettings.singleTokenZoom;
      this.#highlightEnabled = playerSettings.highlightEnabled;
      this.#settingsExpanded = playerSettings.settingsExpanded;
      this.#playerHighlightColorMode = playerSettings.highlightColorMode;
      this.#playerHighlightColor = playerSettings.highlightColor;
      this.#roomHighlightColorMode = roomSettings.highlightColorMode;
      this.#roomHighlightColor = roomSettings.highlightColor;
      this.#sceneReady = sceneReady;
      this.#ownerOnlyEnabled = permissions.includes("CHARACTER_OWNER_ONLY");
      this.#applyTheme(theme);

      this.#disposeCallbacks.push(
        OBR.theme.onChange((nextTheme) => this.#applyTheme(nextTheme)),
        OBR.room.onPermissionsChange((permissions) => {
          this.#ownerOnlyEnabled = permissions.includes("CHARACTER_OWNER_ONLY");
          this.#render();
        }),
        OBR.room.onMetadataChange((metadata) => {
          const settings = readRoomSettings(metadata);
          this.#globalEnabled = settings.globalEnabled;
          this.#showMoveHere = settings.showMoveHere;
          this.#roomHighlightColorMode = settings.highlightColorMode;
          this.#roomHighlightColor = settings.highlightColor;
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
          this.#settingsExpanded = settings.settingsExpanded;
          this.#playerHighlightColorMode = settings.highlightColorMode;
          this.#playerHighlightColor = settings.highlightColor;
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
        this.#sceneReady = ready;
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
    const [players, items, pendingActions] = await Promise.all([
      OBR.party.getPlayers(),
      this.#getSceneItems(),
      getPendingPartyActions(),
    ]);
    this.#players = groupPlayerConnections(players);
    this.#items = items;
    this.#pendingActions = pendingActions;

    this.#disposeCallbacks.push(
      OBR.party.onChange((players) => {
        this.#players = groupPlayerConnections(players);
        this.#render();
      }),
      OBR.scene.items.onChange((items) => {
        this.#items = items;
        this.#render();
      }),
      OBR.scene.onMetadataChange((metadata) => {
        this.#pendingActions = readPendingPartyActions(metadata);
        this.#render();
      }),
      OBR.scene.onReadyChange((ready) => {
        this.#sceneReady = ready;
        if (ready) {
          void this.#refreshItems();
        } else {
          this.#items = [];
          this.#pendingActions = [];
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
      const [items, pendingActions] = await Promise.all([
        this.#getSceneItems(),
        this.#role === "GM" ? getPendingPartyActions() : Promise.resolve([]),
      ]);
      this.#items = items;
      this.#pendingActions = pendingActions;
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
    const icon = document.createElement("img");
    icon.className = "header-icon";
    icon.src = `${import.meta.env.BASE_URL}icon.svg`;
    icon.alt = "";
    const title = document.createElement("h1");
    title.id = "app-title";
    title.textContent = "Where am I?";
    header.append(icon, title);
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

    const version = document.createElement("p");
    version.className = "version";
    version.textContent = `Version ${RELEASE_VERSION}`;
    app.append(version);

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

    const toggle = this.#createToggle(
      "Automatically focus my character",
      "Automatically focuses your visible characters when the extension starts or the scene changes.",
      this.#autoFocusEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updatePlayerPreference(enabled),
    );
    controls.append(
      this.#createSettingsSection(
        this.#createZoomField(),
        this.#createHighlightToggle(),
        this.#createHighlightColorField(),
        toggle,
      ),
    );

    const ownedCharacters = filterVisibleOwnedCharacters(
      this.#items,
      OBR.player.id,
    );
    const availability = getOwnedTargetAvailability(
      this.#items,
      OBR.player.id,
      this.#sceneReady,
      this.#globalEnabled,
    );
    const hintText = getPlayerAvailabilityHint(
      availability,
      this.#ownerOnlyEnabled,
    );
    const hint = hintText ? this.#createAvailabilityHint(hintText) : undefined;
    const focusButton = this.#createButton(
      this.#busyAction === "focus-self" ? "Focusing…" : "Focus me now",
      "primary",
      availability !== "AVAILABLE" || this.#busyAction !== undefined,
      () => void this.#focusSelf(),
      undefined,
      hint?.id,
    );
    controls.append(focusButton);
    if (hint) controls.append(hint);

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
            hint?.id,
          ),
        );
        list.append(row);
      }
      section.append(list);
      controls.append(section);
    }

    return controls;
  }

  #renderGmControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "controls";
    const globalToggle = this.#createToggle(
      "Enable Where am I? for players",
      "Allows non-GM players to use automatic and manual Focus actions and receive remote Focus or Highlight actions.",
      this.#globalEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updateGlobalSetting(enabled),
    );
    const moveHereToggle = this.#createToggle(
      'Show "Move here" actions',
      "Shows a GM-only action for moving a character token to the center of your current viewport.",
      this.#showMoveHere,
      this.#busyAction !== undefined,
      (enabled) => void this.#updateShowMoveHere(enabled),
    );
    controls.append(
      this.#createSettingsSection(
        this.#createZoomField(),
        this.#createHighlightToggle(),
        this.#createHighlightColorField(),
        globalToggle,
        moveHereToggle,
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
      empty.id = "connected-players-availability";
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

    const partyTile = document.createElement("section");
    partyTile.className = "action-tile";
    const partyIdentity = document.createElement("div");
    partyIdentity.className = "player-identity";
    const partyIcon = document.createElement("span");
    partyIcon.className = "party-icon";
    partyIcon.setAttribute("aria-hidden", "true");
    for (const color of ["#fa5300", "#29c5d6", "#8f6cff", "#f5bf42"]) {
      const circle = document.createElement("span");
      circle.style.backgroundColor = color;
      partyIcon.append(circle);
    }
    const partyTitle = document.createElement("h2");
    partyTitle.textContent = "Party";
    partyIdentity.append(partyIcon, partyTitle);
    const partyActions = document.createElement("div");
    partyActions.className = "action-menu-row";
    const connectedIds = new Set(this.#players.map((player) => player.id));
    const partyAvailability = getPartyTargetAvailability(
      this.#items,
      connectedIds,
      this.#sceneReady,
    );
    const partyHintText = getPartyAvailabilityHint(
      partyAvailability,
      this.#ownerOnlyEnabled,
    );
    const partyHint = partyHintText
      ? this.#createAvailabilityHint(partyHintText)
      : undefined;
    const targets = this.#items.filter(
      (item) =>
        item.layer === "CHARACTER" &&
        item.visible &&
        connectedIds.has(item.createdUserId),
    );
    partyActions.append(
      this.#createGmActionMenu(
        "FOCUS",
        targets,
        false,
        undefined,
        "Party",
        partyHint?.id,
      ),
      this.#createGmActionMenu(
        "HIGHLIGHT",
        targets,
        false,
        undefined,
        "Party",
        partyHint?.id,
      ),
    );
    partyTile.append(partyIdentity, partyActions);
    if (partyHint) partyTile.append(partyHint);
    controls.append(partyTile, section);
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
      empty.textContent = this.#sceneReady
        ? "No character tokens are in the current scene."
        : "No scene is open.";
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
        actions.classList.toggle(
          "character-actions--with-move",
          this.#showMoveHere,
        );
        const label = getCharacterDisplay(character).characterName;
        if (this.#showMoveHere) {
          actions.append(
            this.#createButton(
              this.#busyAction === `move-token-${character.id}`
                ? "Moving…"
                : "Move here",
              "small",
              this.#busyAction !== undefined,
              () => void this.#moveTokenToViewportCenter(character.id),
              `Move ${label} to the center of the viewport`,
            ),
          );
        }
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
        row.append(
          display,
          this.#createVisibilityButton(character, label),
          actions,
        );
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
    const availability = getOwnedTargetAvailability(
      this.#items,
      player.id,
      this.#sceneReady,
    );
    const hintText = getGmPlayerAvailabilityHint(
      availability,
      this.#ownerOnlyEnabled,
    );
    const hint = hintText ? this.#createAvailabilityHint(hintText) : undefined;
    actions.append(
      this.#createGmActionMenu(
        "FOCUS",
        playerTargets,
        false,
        player.id,
        playerLabel,
        hint?.id,
      ),
      this.#createGmActionMenu(
        "HIGHLIGHT",
        playerTargets,
        false,
        player.id,
        playerLabel,
        hint?.id,
      ),
    );

    row.append(identity, actions);
    group.append(row);
    if (hint) group.append(hint);

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

  #createVisibilityButton(character: Item, label: string): HTMLButtonElement {
    const action = character.visible ? "Hide" : "Show";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "visibility-button";
    if (findPendingActionForItem(this.#pendingActions, character.id)) {
      button.classList.add("visibility-button--pending");
    }
    button.disabled = this.#busyAction !== undefined;
    button.setAttribute("aria-label", `${action} ${label}`);
    button.title = `${action} ${label}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      character.visible
        ? "M12 4C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4m0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3"
        : "M12 6.5c2.76 0 5 2.24 5 5 0 .51-.1 1-.24 1.46l3.06 3.06c1.39-1.23 2.49-2.77 3.18-4.53C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.57l2.17 2.17c.47-.14.96-.24 1.47-.24M2.71 3.16c-.39.39-.39 1.02 0 1.41l1.97 1.97C3.06 7.83 1.77 9.53 1 11.5 2.73 15.89 7 19 12 19c1.52 0 2.97-.3 4.31-.82l2.72 2.72c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L4.13 3.16c-.39-.39-1.03-.39-1.42 0M12 16.5c-2.76 0-5-2.24-5-5 0-.77.18-1.5.49-2.14l1.57 1.57c-.03.18-.06.37-.06.57 0 1.66 1.34 3 3 3 .2 0 .38-.03.57-.07L14.14 16c-.65.32-1.37.5-2.14.5m2.97-5.33c-.15-1.4-1.25-2.49-2.64-2.64z",
    );
    svg.append(path);
    button.append(svg);
    button.addEventListener(
      "click",
      () => void this.#toggleTokenVisibility(character.id),
    );
    return button;
  }

  #createGmActionMenu(
    action: TargetAction,
    targets: readonly Item[],
    includeHidden: boolean,
    controllingPlayerId: string | undefined,
    targetLabel: string,
    describedBy?: string,
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "action-menu";
    const pending =
      targets.length === 1
        ? findPendingActionForItem(this.#pendingActions, targets[0]!.id)
        : undefined;
    const pendingForAction = pending?.action === action ? pending : undefined;
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
      describedBy,
    );
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    if (pendingForAction) trigger.classList.add("button--pending");
    const menu = document.createElement("div");
    menu.className = "action-menu__items";
    menu.setAttribute("role", "menu");
    const recipients: Array<{ label: string; recipient?: TargetRecipient }> = [
      { label: "for Me" },
      ...(controllingPlayerId
        ? [
            {
              label: "for Player",
              recipient: {
                scope: "PLAYER" as const,
                playerId: controllingPlayerId,
              },
            },
          ]
        : []),
      { label: "for Party", recipient: { scope: "PARTY" } },
    ];
    for (const option of recipients) {
      const item = this.#createButton(
        option.label,
        "small",
        option.recipient !== undefined &&
          (!this.#globalEnabled ||
            (option.recipient.scope === "PARTY" &&
              (this.#players.length === 0 || pendingForAction !== undefined))),
        () => {
          container.classList.remove("action-menu--open");
          trigger.setAttribute("aria-expanded", "false");
          void this.#performGmTargetAction(
            action,
            option.recipient,
            targets,
            includeHidden,
            targetLabel,
          );
        },
        `${action === "FOCUS" ? "Focus" : "Highlight"} ${targetLabel} ${option.label}`,
      );
      item.setAttribute("role", "menuitem");
      if (option.recipient?.scope === "PARTY" && this.#players.length === 0) {
        item.setAttribute("aria-describedby", "connected-players-availability");
      }
      menu.append(item);
    }
    if (pendingForAction) {
      const cancel = this.#createButton(
        "Cancel",
        "small",
        this.#busyAction !== undefined,
        () => {
          container.classList.remove("action-menu--open");
          trigger.setAttribute("aria-expanded", "false");
          void this.#cancelPendingAction(pendingForAction);
        },
        `Cancel pending ${action === "FOCUS" ? "focus" : "highlight"} for ${targetLabel}`,
      );
      cancel.classList.add("button--pending-cancel");
      cancel.setAttribute("role", "menuitem");
      menu.append(cancel);
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
    container.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && container.contains(nextTarget)) return;
      container.classList.remove("action-menu--open");
      trigger.setAttribute("aria-expanded", "false");
    });
    container.append(trigger, menu);
    return container;
  }

  #createToggle(
    labelText: string,
    helpText: string,
    checked: boolean,
    disabled: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const field = document.createElement("div");
    field.className = "toggle";
    const input = document.createElement("input");
    input.id = `setting-toggle-${++this.#helpId}`;
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener("change", () => onChange(input.checked));
    const visual = document.createElement("span");
    visual.className = "switch";
    visual.setAttribute("aria-hidden", "true");
    const control = document.createElement("label");
    control.className = "toggle-control";
    control.htmlFor = input.id;
    control.append(input, visual);
    field.append(
      this.#createSettingLabel(labelText, helpText, input.id),
      control,
    );
    return field;
  }

  #createSettingsSection(...settings: HTMLElement[]): HTMLDetailsElement {
    const details = document.createElement("details");
    details.className = "settings-disclosure";
    details.open = this.#settingsExpanded;
    const summary = document.createElement("summary");
    summary.textContent = "Settings";
    const content = document.createElement("div");
    content.className = "settings-content";
    content.append(...settings);
    details.append(summary, content);
    details.addEventListener("toggle", () => {
      if (details.open === this.#settingsExpanded) return;
      this.#settingsExpanded = details.open;
      void setPlayerSettingsExpanded(details.open).catch((error: unknown) => {
        console.error("Where am I? could not save Settings state.", error);
        this.#status = {
          message: "The Settings section state could not be saved.",
          tone: "error",
        };
        this.#render();
      });
      const resize =
        this.#role === "GM"
          ? this.#resizeGmPopover()
          : this.#resizePlayerPopover();
      void resize.catch((error: unknown) => {
        console.error("Where am I? could not resize the popover.", error);
      });
    });
    return details;
  }

  #createZoomField(): HTMLElement {
    const field = document.createElement("div");
    field.className = "setting-field";
    const value = document.createElement("span");
    value.className = "zoom-value";
    const input = document.createElement("input");
    input.id = "maximum-zoom";
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
    field.append(
      this.#createSettingLabel(
        "Maximum zoom",
        "Sets the closest viewport zoom used by Focus, including when multiple characters are focused together.",
        input.id,
      ),
      value,
    );
    return field;
  }

  #createHighlightColorField(): HTMLElement {
    const field = document.createElement("div");
    field.className = "setting-field color-setting";
    const selectId = "highlight-color-mode";
    const controls = document.createElement("div");
    controls.className = "color-controls";
    const select = document.createElement("select");
    select.id = selectId;
    select.disabled = this.#busyAction !== undefined;
    select.innerHTML =
      '<option value="DEFAULT">Default</option><option value="CUSTOM">Custom</option>';
    const mode =
      this.#role === "GM"
        ? this.#roomHighlightColorMode
        : this.#playerHighlightColorMode;
    const color =
      this.#role === "GM"
        ? this.#roomHighlightColor
        : this.#playerHighlightColor;
    select.value = mode;
    select.addEventListener("change", () => {
      void this.#updateHighlightColor(
        select.value === "CUSTOM" ? "CUSTOM" : "DEFAULT",
        color,
      );
    });
    controls.append(select);
    if (mode === "CUSTOM") {
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = color;
      picker.disabled = this.#busyAction !== undefined;
      picker.setAttribute("aria-label", "Custom highlight color");
      picker.addEventListener("change", () => {
        void this.#updateHighlightColor("CUSTOM", picker.value);
      });
      controls.append(picker);
    }
    field.append(
      this.#createSettingLabel(
        "Highlight color",
        this.#role === "GM"
          ? "Default uses orange. A custom color becomes the shared default for players in this room."
          : "Default uses the GM's shared room color, or orange when no custom room color is set. Custom saves your personal color.",
        selectId,
      ),
      controls,
    );
    return field;
  }

  #createHighlightToggle(): HTMLElement {
    return this.#createToggle(
      "Show highlights",
      "Shows a highlight after Focus. An explicit Highlight action is always shown even when this setting is off.",
      this.#highlightEnabled,
      this.#busyAction !== undefined,
      (enabled) => void this.#updateHighlightPreference(enabled),
    );
  }

  #createSettingLabel(
    text: string,
    helpText: string,
    htmlFor?: string,
  ): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "setting-label-group";
    const label = document.createElement(htmlFor ? "label" : "span");
    label.className = "setting-label";
    label.textContent = text;
    if (label instanceof HTMLLabelElement && htmlFor) label.htmlFor = htmlFor;
    const help = document.createElement("span");
    help.className = "setting-help";
    const helpId = `setting-help-${++this.#helpId}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "setting-help__button";
    button.textContent = "?";
    button.setAttribute("aria-label", `Help for ${text}`);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", helpId);
    const popover = document.createElement("span");
    popover.id = helpId;
    popover.className = "setting-help__popover";
    popover.setAttribute("role", "tooltip");
    popover.textContent = helpText;
    button.addEventListener("click", () => {
      for (const other of this.#root.querySelectorAll<HTMLElement>(
        ".setting-help--open",
      )) {
        if (other === help) continue;
        other.classList.remove("setting-help--open");
        other
          .querySelector<HTMLElement>("[aria-expanded]")
          ?.setAttribute("aria-expanded", "false");
      }
      const open = help.classList.toggle("setting-help--open");
      button.setAttribute("aria-expanded", String(open));
      if (open) {
        const margin = 8;
        const gap = 6;
        const buttonBounds = button.getBoundingClientRect();
        const popoverBounds = popover.getBoundingClientRect();
        const left = Math.min(
          Math.max(margin, buttonBounds.left - 4),
          Math.max(margin, window.innerWidth - popoverBounds.width - margin),
        );
        const below = buttonBounds.bottom + gap;
        const top =
          below + popoverBounds.height <= window.innerHeight - margin
            ? below
            : Math.max(margin, buttonBounds.top - gap - popoverBounds.height);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
      }
    });
    help.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      help.classList.remove("setting-help--open");
      button.setAttribute("aria-expanded", "false");
      button.focus();
    });
    help.append(button, popover);
    wrapper.append(label, help);
    return wrapper;
  }

  #createAvailabilityHint(message: string): HTMLParagraphElement {
    const hint = document.createElement("p");
    hint.id = `availability-hint-${++this.#availabilityId}`;
    hint.className = "availability-hint";
    hint.textContent = message;
    return hint;
  }

  #createButton(
    text: string,
    variant: "primary" | "secondary" | "small",
    disabled: boolean,
    onClick: () => void,
    accessibleLabel?: string,
    describedBy?: string,
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
    if (describedBy) button.setAttribute("aria-describedby", describedBy);
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
        message: `Maximum zoom set to ${Math.round(singleTokenZoom * 100)}%.`,
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

  async #updateHighlightColor(
    mode: "DEFAULT" | "CUSTOM",
    color: string,
  ): Promise<void> {
    await this.#runAction("highlight-color-setting", async () => {
      if (this.#role === "GM") {
        await setRoomHighlightColor(mode, color);
        this.#roomHighlightColorMode = mode;
        this.#roomHighlightColor = color;
      } else {
        await setPlayerHighlightColor(mode, color);
        this.#playerHighlightColorMode = mode;
        this.#playerHighlightColor = color;
      }
      this.#status = {
        message:
          mode === "CUSTOM"
            ? "Custom highlight color saved."
            : "Default highlight color selected.",
        tone: "success",
      };
    });
  }

  #getEffectiveHighlightColor(): string {
    if (this.#role === "GM") {
      return this.#roomHighlightColorMode === "CUSTOM"
        ? this.#roomHighlightColor
        : HIGHLIGHT_COLOR;
    }
    if (this.#playerHighlightColorMode === "CUSTOM") {
      return this.#playerHighlightColor;
    }
    return this.#roomHighlightColorMode === "CUSTOM"
      ? this.#roomHighlightColor
      : HIGHLIGHT_COLOR;
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

  async #updateShowMoveHere(enabled: boolean): Promise<void> {
    await this.#runAction("move-here-setting", async () => {
      await setShowMoveHere(enabled);
      this.#showMoveHere = enabled;
      this.#status = {
        message: `Move here actions are now ${enabled ? "shown" : "hidden"}.`,
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
          undefined,
          this.#getEffectiveHighlightColor(),
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
          false,
          this.#getEffectiveHighlightColor(),
        ),
      );
    });
  }

  async #performGmTargetAction(
    action: TargetAction,
    recipient: TargetRecipient | undefined,
    targets: readonly Item[],
    includeHidden: boolean,
    targetLabel: string,
  ): Promise<void> {
    const actionId = `${action.toLowerCase()}-${recipient?.scope.toLowerCase() ?? "me"}`;
    await this.#runAction(actionId, async () => {
      if (recipient) {
        if (!(await this.#confirmGlobalEnabled())) return;
        if ((await OBR.player.getRole()) !== "GM") {
          throw new Error("Only a GM can send a remote target action.");
        }
        const actorName = (await OBR.player.getName()).trim() || "The GM";
        let targetIds = targets.map((target) => target.id);
        if (recipient.scope === "PARTY") {
          const queued = await queuePendingPartyAction({
            action,
            targetIds,
            targetMode: "ALL_ITEMS",
            actorName,
            targetLabel,
          });
          if (queued.kind === "CONFLICT") {
            const message = formatPendingConflictToast(
              action,
              queued.item,
              queued.pending,
            );
            this.#status = { message, tone: "error" };
            await OBR.notification.show(message, "ERROR");
            return;
          }
          if (queued.kind === "MISSING") {
            this.#status = {
              message: "One or more selected items are no longer available.",
              tone: "error",
            };
            return;
          }
          if (queued.kind === "QUEUED") {
            this.#pendingActions = await getPendingPartyActions();
            const message = formatPendingConfiguredToast(queued.pending);
            this.#status = { message, tone: "success" };
            await OBR.notification.show(message, "INFO");
            return;
          }
          targetIds = queued.targetIds;
        }
        const command = createTargetActionCommand(
          action,
          recipient,
          targetIds,
          recipient.scope === "PARTY" ? false : includeHidden,
          "ALL_ITEMS",
          actorName,
          targetLabel,
          recipient.scope === "PARTY" ? { requireVisible: true } : undefined,
        );
        await OBR.broadcast.sendMessage(
          TARGET_ACTION_BROADCAST_CHANNEL,
          command,
          { destination: "LOCAL" },
        );
        this.#status = {
          message: `${action === "FOCUS" ? "Focus" : "Highlight"} sent to ${recipient.scope === "PARTY" ? "the party" : "the player"}.`,
          tone: "success",
        };
        return;
      }
      const result =
        action === "HIGHLIGHT"
          ? await highlightCharacterItems(
              targets,
              includeHidden,
              this.#getEffectiveHighlightColor(),
            )
          : await focusViewportOnCharacterItems(
              targets,
              this.#singleTokenZoom,
              this.#highlightEnabled,
              includeHidden,
              this.#getEffectiveHighlightColor(),
            );
      this.#setTargetActionStatus(result, action);
    });
  }

  async #cancelPendingAction(pending: PendingPartyAction): Promise<void> {
    await this.#runAction(`cancel-pending-${pending.id}`, async () => {
      const removed = await cancelPendingPartyActionsForItems(
        pending.action,
        pending.targetIds,
      );
      if (removed.length === 0) return;
      this.#pendingActions = await getPendingPartyActions();
      const message = formatPendingCanceledToast(pending);
      this.#status = { message, tone: "success" };
      await OBR.notification.show(message, "INFO");
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
