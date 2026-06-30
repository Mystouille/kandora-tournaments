import { describe, expect, it } from "vitest";
import {
  from34To136,
  from34ToStr,
  fromStrToTile34,
  fromStrToTile9997,
  fromTile9997ToStr,
} from "./handConverter";
import { Tile997 } from "./handTypes";

describe("handConverter", () => {
  it("fromStrToTile997", () => {
    let handStr = "123456789m12344p";
    expect(fromStrToTile9997(handStr)).toStrictEqual([
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
    handStr = "123456789s12344z";
    expect(fromStrToTile9997(handStr)).toStrictEqual([
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 2, 0, 0, 0],
    ]);
  });
  it("fromTile9997ToStr", () => {
    let hand = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ] as Tile997;
    expect(fromTile9997ToStr(hand)).toBe("1m2m3m4m5m6m7m8m9m1p2p3p4p4p");
    hand = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 2, 0, 0, 0],
    ] as Tile997;
    expect(fromTile9997ToStr(hand)).toBe("1s2s3s4s5s6s7s8s9s1z2z3z4z4z");
  });
  it("fromStrToTile34", () => {
    let handStr = "123456789m12344p";
    expect(fromStrToTile34(handStr)).toStrictEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    handStr = "123456789s12344z";
    expect(fromStrToTile34(handStr)).toStrictEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 2, 0, 0, 0,
    ]);
  });
  it("from34To136", () => {
    const hand34 = [
      3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(from34To136(hand34)).toStrictEqual([1, 2, 3, 11]);
  });
  it("from34ToStr", () => {
    const hand34 = [
      3, 0, 1, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(from34ToStr(hand34)).toStrictEqual("1m1m1m3m0m5m");
  });
});
