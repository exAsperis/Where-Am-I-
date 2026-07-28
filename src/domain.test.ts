import type { Item } from "@owlbear-rodeo/sdk";
import { describe, expect, it } from "vitest";

import {
  calculatePadding,
  createBoundsForZoom,
  filterCharacterTokens,
  filterVisibleOwnedCharacters,
  formatCharacterName,
  formatPlayerName,
  getCharacterDisplay,
  groupVisibleCharactersByPlayer,
  groupPlayerConnections,
  normalizeZoomScale,
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

  it("lists all Character-layer tokens regardless of visibility or ownership", () => {
    expect(filterCharacterTokens(characters).map((item) => item.id)).toEqual([
      "owned-visible",
      "owned-hidden",
      "other-visible",
    ]);
  });
});

describe("party presentation", () => {
  it("groups visible characters under their owning player", () => {
    const grouped = groupVisibleCharactersByPlayer(characters);
    expect(grouped.get("player-1")?.map((item) => item.id)).toEqual([
      "owned-visible",
    ]);
    expect(grouped.get("player-2")?.map((item) => item.id)).toEqual([
      "other-visible",
    ]);
  });

  it("uses token names with an unnamed fallback", () => {
    expect(formatCharacterName(" Mira ")).toBe("Mira");
    expect(formatCharacterName("  ")).toBe("Unnamed character");
  });

  it("extracts image, associated token text, and character name", () => {
    const image = {
      ...characters[0],
      type: "IMAGE",
      image: {
        url: "https://example.com/mira.png",
        width: 100,
        height: 100,
        mime: "image/png",
      },
      text: { plainText: "  Mira the Bold  " },
    } as unknown as Item;
    expect(getCharacterDisplay(image)).toEqual({
      imageUrl: "https://example.com/mira.png",
      tokenText: "Mira the Bold",
      characterName: "Mira",
    });
  });

  it("omits blank associated text and unavailable artwork", () => {
    expect(getCharacterDisplay(characters[0] as Item)).toEqual({
      characterName: "Mira",
    });
  });

  it("groups duplicate connections by stable player ID and excludes GMs", () => {
    const players: PartyPlayer[] = [
      {
        id: "player-1",
        connectionId: "connection-a",
        role: "PLAYER",
        color: "#f00",
        name: "Alex",
      },
      {
        id: "player-1",
        connectionId: "connection-b",
        role: "PLAYER",
        color: "#f00",
        name: "Alex",
      },
      {
        id: "gm-1",
        connectionId: "connection-gm",
        role: "GM",
        color: "#00f",
        name: "Game Master",
      },
    ];

    expect(groupPlayerConnections(players)).toEqual([players[0]]);
  });

  it("uses the Owlbear player name as the primary label", () => {
    expect(formatPlayerName("player-abcdef", " Alex ")).toBe("Alex");
  });

  it("uses a short player-ID suffix when no player name exists", () => {
    expect(formatPlayerName("player-abcdef", "   ")).toBe("Player • abcdef");
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

  it("creates centered bounds that produce the requested viewport scale", () => {
    expect(createBoundsForZoom({ x: 100, y: 200 }, 0.5, 800, 600)).toEqual({
      min: { x: -700, y: -400 },
      max: { x: 900, y: 800 },
      width: 1600,
      height: 1200,
      center: { x: 100, y: 200 },
    });
  });

  it("normalizes malformed and out-of-range zoom preferences", () => {
    expect(normalizeZoomScale(undefined)).toBe(0.5);
    expect(normalizeZoomScale(0.01)).toBe(0.1);
    expect(normalizeZoomScale(3)).toBe(2);
    expect(normalizeZoomScale(0.75)).toBe(0.75);
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
