---
title: Where am I?
description: Focus and highlight characters in Owlbear Rodeo.
author: ex Asperis
image: https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/screenshots/wai-party-focus.jpg?v=1.0.1
icon: https://exasperis.github.io/Where-Am-I-/icon.svg?v=1.0.1
tags:
  - automation
manifest: https://exasperis.github.io/Where-Am-I-/manifest.json
learn-more: https://github.com/exAsperis/Where-Am-I-
---

# Where am I?

Where am I? keeps players oriented by focusing their visible, player-owned
Character-layer tokens and moving only their local Owlbear Rodeo viewport.

![A GM focusing the party's characters across an Owlbear Rodeo scene](https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/screenshots/wai-party-focus.jpg?v=1.0.1)

## For players

![A player focusing their character with a private highlight](https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/screenshots/wai-player-focus.jpg?v=1.0.1)

- Automatically focus your character when joining or changing scenes.
- Focus all of your characters together whenever you choose.
- Pick one named character from your personal list when you own several.
- Set and save your preferred maximum zoom, which also caps how close
  multi-character focus can zoom.
- Choose the shared GM highlight color or a persistent personal custom color.
- Collapse Settings and retain its state for the next time the panel opens.

## For GMs

![The GM panel with player, character, party, and scene-token controls](https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/screenshots/wai-gm-panel-all-expanded.jpg?v=1.0.1)

- Enable or disable player-facing behavior for the room.
- Focus or highlight a player or character for the GM, controlling player, or
  the whole non-GM party.
- Focus or highlight the whole party locally or for every player.
- Expand all scene character tokens to focus, highlight, show, or hide them;
  optionally enable the default-hidden Move here action in GM settings.
- Focus or highlight any context-menu selection for the whole party.
- Queue Party actions for hidden items until every selected item is visible;
  orange controls identify pending groups and provide cancellation.
- Keep personal zoom and highlight preferences.
- Set the room's shared highlight color, which defaults to orange.

![Pending party highlights on hidden tokens, with cancellation controls](https://raw.githubusercontent.com/exAsperis/Where-Am-I-/main/screenshots/wai-pending-highlight.jpg?v=1.0.1)

Only visible items on the Character layer are included. Ownership is determined
by the player who created the token. When a player owns multiple characters,
Where am I? frames all of them together unless a specific named token is chosen.
GMs can assign existing tokens by enabling Owner Only for Characters in Player
Permissions and using each token's Owner menu. Disabled actions include concise
setup guidance when a scene, player, assignment, or visible token is missing.

## Privacy

Where am I? has no backend, accounts, analytics, or external data storage.
Preferences use namespaced Owlbear Rodeo player metadata, the global enablement
setting uses room metadata, and remote GM requests use Owlbear Rodeo broadcasts.
Highlights are temporary client-local scene items, so each recipient sees only
their own highlight animation. Players also receive a concise toast identifying
the GM action and its target.
Explicit Highlight keeps the scene point at the center of the recipient's
viewport stationary and zooms out only when necessary to bring every
highlighted item into view. It never zooms in or pans toward the target, and the
rings begin after any required zoom completes.

## Support

For help, bug reports, or feature requests, open an issue on the
[Where am I? GitHub repository](https://github.com/exAsperis/Where-Am-I-/issues).
