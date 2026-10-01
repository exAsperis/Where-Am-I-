import type { BoundingBox, Metadata } from "@owlbear-rodeo/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@owlbear-rodeo/sdk", () => ({ default: {} }));

import { PLAY_AREA_METADATA_KEY } from "./constants";
import {
  clampItemPosition,
  getBoundsOffsets,
  type AxisAlignedRect,
  type ItemBoundsOffsets,
} from "./domain";
import { readPlayAreaSettings } from "./play-area";

const area: AxisAlignedRect = {
  min: { x: 0, y: 0 },
  max: { x: 100, y: 80 },
};
const centered: ItemBoundsOffsets = {
  left: -10,
  right: 10,
  top: -10,
  bottom: 10,
};

describe("Player Play Area geometry", () => {
  it.each([
    ["inside", { x: 50, y: 40 }, { x: 50, y: 40 }],
    ["left", { x: 5, y: 40 }, { x: 10, y: 40 }],
    ["right", { x: 95, y: 40 }, { x: 90, y: 40 }],
    ["top", { x: 50, y: 5 }, { x: 50, y: 10 }],
    ["bottom", { x: 50, y: 75 }, { x: 50, y: 70 }],
    ["corner", { x: 105, y: -5 }, { x: 90, y: 10 }],
  ])("clamps a Character crossing %s", (_label, position, expected) => {
    expect(clampItemPosition(position, centered, area).position).toEqual(
      expected,
    );
  });

  it.each([
    { x: 10, y: 40 },
    { x: 90, y: 40 },
    { x: 50, y: 10 },
    { x: 50, y: 70 },
  ])("leaves exact boundary contact unchanged", (position) => {
    expect(clampItemPosition(position, centered, area)).toMatchObject({
      position,
      changed: false,
    });
  });

  it("supports different, rotated, and scaled extents supplied by Owlbear", () => {
    expect(
      clampItemPosition(
        { x: 95, y: 70 },
        { left: -25, right: 30, top: -5, bottom: 15 },
        area,
      ).position,
    ).toEqual({ x: 70, y: 65 });
    expect(
      getBoundsOffsets({ x: 40, y: 50 }, {
        min: { x: 12, y: 31 },
        max: { x: 77, y: 88 },
      } as BoundingBox),
    ).toEqual({ left: -28, right: 37, top: -19, bottom: 38 });
  });

  it("ignores tiny floating-point differences within epsilon", () => {
    expect(
      clampItemPosition({ x: 9.9999, y: 40 }, centered, area, 0.001),
    ).toMatchObject({ changed: false, position: { x: 10, y: 40 } });
  });

  it.each([
    [{ left: -60, right: 60, top: -10, bottom: 10 }, true, false],
    [{ left: -10, right: 10, top: -50, bottom: 50 }, false, true],
    [{ left: -60, right: 60, top: -50, bottom: 50 }, true, true],
  ] as const)("centers oversized axes deterministically", (offsets, x, y) => {
    const result = clampItemPosition({ x: -500, y: 500 }, offsets, area);
    expect(result).toMatchObject({ oversizedX: x, oversizedY: y });
    if (x) expect(result.position.x).toBe(50);
    if (y) expect(result.position.y).toBe(40);
  });

  it.each([
    [
      { x: -20, y: 52 },
      { x: 10, y: 52 },
    ],
    [
      { x: 120, y: 52 },
      { x: 90, y: 52 },
    ],
    [
      { x: 52, y: -20 },
      { x: 52, y: 10 },
    ],
    [
      { x: 52, y: 120 },
      { x: 52, y: 70 },
    ],
  ])(
    "returns the nearest legal position on each crossed boundary",
    (input, expected) => {
      expect(clampItemPosition(input, centered, area).position).toEqual(
        expected,
      );
    },
  );

  it("leaves a later legal position unchanged after an earlier correction", () => {
    expect(
      clampItemPosition({ x: 120, y: 52 }, centered, area).position,
    ).toEqual({
      x: 90,
      y: 52,
    });
    expect(clampItemPosition({ x: 75, y: 52 }, centered, area)).toMatchObject({
      position: { x: 75, y: 52 },
      changed: false,
    });
  });
});

describe("Player Play Area metadata", () => {
  const valid = {
    version: 1,
    enabled: true,
    min: { x: 0, y: 1 },
    max: { x: 100, y: 81 },
  };
  const read = (value: unknown) =>
    readPlayAreaSettings({ [PLAY_AREA_METADATA_KEY]: value } as Metadata);

  it("treats absent metadata as unconfigured", () => {
    expect(readPlayAreaSettings({})).toBeUndefined();
  });

  it("reads enabled and disabled valid metadata", () => {
    expect(read(valid)).toEqual(valid);
    expect(read({ ...valid, enabled: false })).toEqual({
      ...valid,
      enabled: false,
    });
  });

  it.each([
    null,
    "bad",
    { ...valid, version: 2 },
    { ...valid, min: { x: 100, y: 1 } },
    { ...valid, max: { x: 0, y: 81 } },
    { ...valid, max: { x: 100, y: 1 } },
    { ...valid, min: { x: Number.NaN, y: 1 } },
    { ...valid, max: { x: Number.POSITIVE_INFINITY, y: 81 } },
    { ...valid, enabled: "yes" },
  ])("rejects malformed metadata %#", (value) => {
    expect(read(value)).toBeUndefined();
  });
});
