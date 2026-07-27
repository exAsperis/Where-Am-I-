# Where am I?

Where am I? is an [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that
helps players and GMs find player-owned characters on the current scene.

## For players and GMs

The extension is already hosted. You do not need to download this repository,
build the project, deploy a package, or host your own copy.

### Install the extension

Add this public manifest URL to your Owlbear Rodeo room:

<https://exasperis.github.io/Where-Am-I-/manifest.json>

Once installed by the room's GM, players can open **Where am I?** from the
Owlbear Rodeo extension bar.

### Player controls

- **Automatically find my character** focuses your character when the
  extension starts and when a new scene becomes ready. It defaults to enabled.
- **Find me now** frames all your visible characters together.
- **Single-character zoom** controls how closely one selected character is
  framed. It defaults to 50% and accepts 10–200%.
- If you own several visible characters, **My characters** lets you focus one
  named token at a time.

Your automatic-focus and zoom settings are saved to your Owlbear Rodeo player
metadata.

### GM controls

- **Enable Where am I? for players** enables or disables player-facing
  behavior for the room.
- **Send to character** asks the selected player's clients to focus their
  character.
- **View character** frames one player's visible characters in your viewport.
- **View whole party** frames the visible characters owned by connected
  players in your viewport.

The GM player list uses Owlbear player names. GM-local actions use the GM's own
saved zoom setting, while remotely focused players use their own settings.

### Character ownership and privacy

Where am I? includes visible items on the `CHARACTER` layer that were created
by the player. Hidden items and items on other layers are excluded. When a
player owns several visible characters, the extension can frame their combined
bounds with extra scene-grid padding.

Each client's viewport acts independently. A player's local action never moves
another client's viewport, and a GM moves a player's viewport only by
explicitly sending that player a focus command.

The extension has no backend, accounts, analytics, or external data storage.
Preferences use namespaced Owlbear Rodeo player metadata, global enablement
uses room metadata, and GM focus requests use Owlbear Rodeo broadcasts.

### Support

For help, bug reports, or feature requests, open a
[GitHub issue](https://github.com/exAsperis/Where-Am-I-/issues).

---

## For developers and contributors

Everything below this point concerns source development, testing, releases,
hosting, and extension-store maintenance. End users do not need these steps.

### Development setup

The project requires Node.js 20 or newer and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
```

Codex Desktop contributors must follow
[`docs/development-environment.md`](docs/development-environment.md), which
documents the bundled toolchain, version synchronization, production base
path, deployment workflow, and OneDrive recovery procedure.

The production build emits `main.html`, `background.html`, the manifest, store
listing, and assets into the ignored `dist/` directory. For GitHub Pages, build
with the repository subpath:

```powershell
$env:VITE_BASE_PATH = "/Where-Am-I-/"
pnpm run build
```

Do not use a local browser preview for Owlbear integration in this workspace.
Deploy an explicitly authorized build, verify its public manifest and assets,
and then test through the hosted manifest in Owlbear Rodeo.

### Extension-store publication

The store listing source is [`public/store.md`](public/store.md), hosted at
<https://exasperis.github.io/Where-Am-I-/store.md>.

To submit the extension, add this entry to the official Owlbear Rodeo
extensions repository's `extensions.json` in a single-commit pull request:

```json
"where-am-i": "https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/public/store.md"
```

### Manual Owlbear Rodeo release checklist

Use separate signed-in clients where the scenario requires more than one
connection:

1. Player with one owned token joins while enabled.
2. Player with several owned tokens joins while enabled.
3. Player with automatic behavior disabled joins.
4. Enabled player changes scenes.
5. Disabled player changes scenes.
6. Player presses **Find me now**.
7. One player's local action does not affect another player.
8. GM disables and re-enables the feature without changing player preferences.
9. GM remotely focuses one player without moving other players.
10. GM focuses their viewport on one player and then the whole party.
11. A player has no owned character.
12. A token is hidden.
13. A player joins from two simultaneous connections.
14. Players join and leave while the GM popover is open.
15. Player and GM zoom preferences default to 50%.
16. Each role changes its zoom preference and sees it persist after reopening.
17. A multi-token player focuses each named token individually.
18. GM player rows use Owlbear player names rather than token names.
19. The extension bar and manifest use the orange/blue logo artwork.

Also confirm concise feedback for an absent scene, an absent character, a
completed focus, a disabled global feature, and a sent remote command. Check
keyboard focus visibility and both Owlbear light and dark themes.
