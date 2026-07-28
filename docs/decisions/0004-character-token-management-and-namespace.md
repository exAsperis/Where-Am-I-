# 0004: Character token management and metadata namespace

## Status

Accepted

## Context

Character rows need to distinguish Owlbear's token-associated text from the
character item name, and GMs need scene-wide token controls without changing
the existing visible-owned-character behavior for players. The original
metadata namespace also does not match the extension's assigned reverse-domain
identifier.

## Decision

- Use `com.ex-asperis.whereami` for all extension metadata and broadcast keys.
- Migrate valid legacy player and room settings when the new key is absent,
  writing `null` to the legacy key after a successful copy. Only a GM migrates
  room metadata; players can continue reading legacy room settings until then.
- Keep player and GM personal preferences in player metadata and global
  enablement in room metadata so settings remain room-persistent.
- Render Character-layer rows with token artwork, optional token-associated
  text, and the character item name.
- Give GMs a collapsed scene-wide Character-token list with local locate,
  shared visibility, and shared position controls. Scene-wide locating may
  target hidden tokens, while player and party locating remains visible-only.

## Consequences

Existing rooms retain valid preferences after upgrading. GM visibility and
movement actions intentionally mutate shared scene items, while locating
continues to affect only the initiating GM's viewport.
