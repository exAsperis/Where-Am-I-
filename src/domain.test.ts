import { describe, expect, it } from "vitest";

import {
  calculatePadding,
  filterVisibleOwnedCharacters,
  formatPlayerLabel,
  groupPlayerConnections,
  padBounds,
  resolveEnablement,
  type CharacterItem,
  type PartyPlayer,
} from "./domain";

const characters: CharacterItem[] = [
  {
    id: "owned-visible",
    layer: "CHARACTER",
    visible: true,
    createdUserId: "player-1",
    name: "Mira",
  },
  {
    id: "owned-hidden",
    layer: "CHARACTER",
    visible: false,
    createdUserId: "player-1",
    name: "Hidden Mira",
  },
  {
    id: "owned-prop",
    layer: "PROP",
    visible: true,
    createdUserId: "player-1",
    name: "Mira's pack",
  },
  {
    id: "other-visible",
    layer: "CHARACTER",
    visible: true,
    createdUserId: "player-2",
    name: "Bram",
  },
];

describe("character ownership", () => {
  it("filters visible Character-layer items by createdUserId", () => {
    expect(
      filterVisibleOwnedCharacters(characters, "player-1").map(
        (item) => item.id,
      ),
    ).toEqual(["owned-visible"]);
  });

  it("excludes hidden items and non-Character layers", () => {
    const result = filterVisibleOwnedCharacters(characters, "player-1");
    expect(result).not.toContainEqual(
      expect.objectContaining({ id: "owned-hidden" }),
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({ id: "owned-prop" }),
    );
  });
});

describe("party presentation", () => {
  it("groups duplicate connections by stable player ID and excludes GMs", () => {
    const players: PartyPlayer[] = [
      {
        id: "player-1",
        connectionId: "connection-a",
        role: "PLAYER",
        color: "#f00",
      },
      {
        id: "player-1",
        connectionId: "connection-b",
        role: "PLAYER",
        color: "#f00",
      },
      {
        id: "gm-1",
        connectionId: "connection-gm",
        role: "GM",
        color: "#00f",
      },
    ];

    expect(groupPlayerConnections(players)).toEqual([players[0]]);
  });

  it("uses compact unique character names as the primary label", () => {
    expect(formatPlayerLabel("player-abcdef", [" Mira ", "Bram", "Mira"])).toBe(
      "Mira, Bram",
    );
  });

  it("uses a short player-ID suffix when no named characters exist", () => {
    expect(formatPlayerLabel("player-abcdef", ["", "   "])).toBe(
      "Player • abcdef",
    );
  });
});

describe("viewport framing", () => {
  it("uses approximately two grid cells with a minimum fallback", () => {
    expect(calculatePadding(70)).toBe(140);
    expect(calculatePadding(25)).toBe(100);
    expect(calculatePadding(Number.NaN)).toBe(100);
  });

  it("pads bounds equally on every side and recalculates dimensions", () => {
    expect(
      padBounds(
        {
          min: { x: 10, y: 20 },
          max: { x: 110, y: 220 },
          width: 100,
          height: 200,
          center: { x: 60, y: 120 },
        },
        50,
      ),
    ).toEqual({
      min: { x: -90, y: -80 },
      max: { x: 210, y: 320 },
      width: 300,
      height: 400,
      center: { x: 60, y: 120 },
    });
  });
});

describe("effective enablement", () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    "resolves global=%s and player=%s to %s",
    (globalEnabled, playerEnabled, expected) => {
      expect(resolveEnablement(globalEnabled, playerEnabled)).toBe(expected);
    },
  );
});
