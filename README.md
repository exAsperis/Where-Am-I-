# Where am I?

Where am I? is an [Owlbear Rodeo](https://www.owlbear.rodeo/) extension
that frames the visible characters owned by a player in that client’s
viewport. Each client acts independently: a player’s local action never moves
another client, and a GM can move a player’s viewport only by explicitly
sending that player a remote focus command.

## How ownership and framing work

An item belongs to a player only when it is on the `CHARACTER` layer and its
`createdUserId` is that player’s stable ID. Selection, movement permissions,
metadata, `lastModifiedUserId`, and recent movement do not affect ownership.
Hidden items and items on other layers are excluded.

When a player owns several visible characters, Where am I? obtains their
combined Owlbear Rodeo bounds and frames all of them together. The extension
adds about two scene-grid cells of padding on every side, with a practical
minimum when the grid DPI is unavailable or very small.

When an action targets one character, the viewport centers that token at the
user's preferred zoom. The preference defaults to 50% and can be changed from
either the player or GM popover.

## Player controls

- **Automatically find my character** controls local automatic focusing when
  the extension initializes with a ready scene and when a new scene becomes
  ready. It defaults to enabled and is stored in player metadata.
- **Find me now** performs a one-time local focus even when the personal
  automatic setting is off.
- **Single-character zoom** sets the zoom used whenever that client focuses one
  token. It accepts 10–200% and defaults to 50%.
- Players who own more than one visible character get a **My characters** list,
  labeled by token name, for focusing one token at a time. **Find me now**
  continues to frame all of their tokens together.

The GM’s global setting overrides player behavior. While it is off, automatic
focus, **Find me now**, and remote GM focus commands are suppressed. A player’s
personal preference is retained and becomes effective again when the GM
re-enables the feature.

The automatic-focus and single-character zoom preferences are stored together
in namespaced player metadata, so each GM and player keeps their own settings.

## GM controls

- **Enable Where am I? for players** controls player automatic, explicit, and
  remotely requested focusing for the room.
- **Send to character** sends a short-lived command to the selected player’s
  connected clients.
- **View character** frames that player’s visible characters only in the GM’s
  viewport.
- **View whole party** frames all visible Character-layer items owned by
  currently connected players in the GM’s viewport.

Duplicate connections with the same stable player ID appear as one row. Rows
use Owlbear player names, with a short non-sensitive player-ID suffix only when
the name is blank. GM-local view actions use the GM's own single-character zoom
and remain available while the global player feature is disabled. Remotely
focused players use their own zoom preference.

## Install and build

The project requires Node.js 20 or newer and pnpm 11. From a normal development
environment:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
```

Codex Desktop contributors should follow
[`docs/development-environment.md`](docs/development-environment.md), which
documents the bundled Node and pnpm paths, version synchronization, production
base path, deployment workflow, and OneDrive recovery procedure.

The production build emits `main.html`, `background.html`, the manifest, and
assets into the ignored `dist/` directory. For GitHub Pages, build with the
repository subpath:

```powershell
$env:VITE_BASE_PATH = "/Where-Am-I-/"
pnpm run build
```

Do not use a local browser preview for Owlbear integration in this workspace.
Deploy an explicitly authorized build, verify its public manifest and assets,
and then install the public manifest URL in Owlbear Rodeo.

## Manual Owlbear Rodeo checklist

Use separate signed-in clients where the scenario requires more than one
connection:

1. Player with one owned token joins while enabled.
2. Player with several owned tokens joins while enabled.
3. Player with automatic behavior disabled joins.
4. Enabled player changes scenes.
5. Disabled player changes scenes.
6. Player presses **Find me now**.
7. One player’s local action does not affect another player.
8. GM disables the feature globally.
9. GM re-enables it without changing player preferences.
10. GM remotely focuses one player without moving other players.
11. GM focuses their own viewport on one player.
12. GM focuses their own viewport on the whole party.
13. A player has no owned character.
14. A token is hidden.
15. A player joins from two simultaneous connections.
16. Players join and leave while the GM popover is open.
17. Player and GM single-character zoom preferences default to 50%.
18. Each role changes its zoom preference and sees it persist after reopening.
19. A multi-token player focuses each named token individually.
20. GM player rows use Owlbear player names rather than token names.
21. The extension bar and manifest use the new orange/blue `logo.svg` artwork.

Also confirm concise feedback for an absent scene, an absent character, a
completed focus, a disabled global feature, and a sent remote command; check
keyboard focus visibility and both Owlbear light and dark themes.
