import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResistanceOhms, parseCapacitanceFarads } from "../value-normalizer.ts";

// Farad values are tiny (1e-6 to 1e-12) so float multiplication rounding
// means strict equality is flaky — compare with a relative tolerance instead.
function assertCloseTo(actual: number | null, expected: number) {
  assert.ok(actual !== null, `expected a value, got null`);
  assert.ok(
    Math.abs(actual - expected) / expected < 1e-9,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("parseResistanceOhms: standard notation", () => {
  assert.equal(parseResistanceOhms("100k"), 100_000);
  assert.equal(parseResistanceOhms("4.7k"), 4_700);
  assert.equal(parseResistanceOhms("1M"), 1_000_000);
  assert.equal(parseResistanceOhms("220"), 220);
});

test("parseResistanceOhms: European notation", () => {
  assert.equal(parseResistanceOhms("4k7"), 4_700);
  assert.equal(parseResistanceOhms("0R1"), 0.1);
  assert.equal(parseResistanceOhms("1M2"), 1_200_000);
});

test("parseCapacitanceFarads: standard notation", () => {
  assertCloseTo(parseCapacitanceFarads("47uF"), 47e-6);
  assertCloseTo(parseCapacitanceFarads("0.047uF"), 0.047e-6);
  assertCloseTo(parseCapacitanceFarads(".1uF"), 0.1e-6);
  assertCloseTo(parseCapacitanceFarads("470pF"), 470e-12);
});

test("parseCapacitanceFarads: EIA 3-digit code", () => {
  // 104 = 10 * 10^4 pF = 100,000pF = 0.1uF
  assertCloseTo(parseCapacitanceFarads("104"), 0.1e-6);
  // 471 = 47 * 10^1 pF = 470pF
  assertCloseTo(parseCapacitanceFarads("471"), 470e-12);
});

test("parseCapacitanceFarads: European notation", () => {
  assertCloseTo(parseCapacitanceFarads("2n7"), 2.7e-9);
  assertCloseTo(parseCapacitanceFarads("6u8"), 6.8e-6);
});

test("parseCapacitanceFarads: bare number with no unit letter defaults to uF", () => {
  // A code-review pass caught that SI_PREFIX[""] is already 1 (for
  // parseResistanceOhms's bare-ohms case), so the documented "?? 1e-6"
  // fallback for bare capacitor values never actually fired — "22" parsed
  // as 22 literal Farads instead of 22uF. Only reachable for a genuinely
  // bare integer that isn't also a valid 3-digit EIA code (2-3 digits) or
  // European-notation value, so this uses a 1-digit value to isolate it.
  assertCloseTo(parseCapacitanceFarads("5"), 5e-6);
});

test("parses values with a trailing parenthetical note", () => {
  assertCloseTo(parseCapacitanceFarads("470n (0.47uF Electro or Tant)"), 470e-9);
  assert.equal(parseResistanceOhms("100k (or nearest)"), 100_000);
});
