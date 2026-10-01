# 0008: Player Play Area corrective snap-back

Date: 2026-09-30

## Context

Where am I? needs to prevent player-modified Character tokens from remaining
outside a GM-defined Play Area while preserving Owlbear Rodeo's native drag
behavior.

Scene-item change notifications can reliably detect and correct illegal
positions, but cannot guarantee that a Character never visually crosses the
boundary during Owlbear's native interaction. Owlbear light and wall collision
and a custom extension movement tool were considered as alternatives.

## Decision

- Use corrective snap-back. When a PLAYER moves or adds a CHARACTER outside the
  Play Area, independently return that Character to its nearest legal position.
- Accept brief visual penetration during native dragging.
- Do not use light or wall collision. Those primitives may legitimately be used
  for lighting and fog and must not be overloaded for unrelated movement
  containment.
- Do not replace Owlbear's native movement with a custom move tool.
- Keep post-correction Focus and highlight as a recovery mechanism when a
  corrected Character would otherwise be lost offscreen.

## Consequences

Native drag remains untouched. The feature has no light, wall, or fog dependency
and introduces no custom movement tool. Brief visual boundary penetration is
accepted, and snap-back is intentional. Unrelated Characters are never
translated together merely because they changed in one scene update.

Future work must not reopen hard collision unless the product requirement
explicitly changes.
