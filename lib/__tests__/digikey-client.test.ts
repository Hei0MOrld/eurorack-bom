import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHobbyistVariation, type DigiKeyProductVariation } from "../digikey-client.ts";

// Fixture shape captured live from a real DigiKey search for "100k ohm
// resistor 1/4w axial" (org "SmartBOM-Hei0MOrld", 2026-09-21) — a bare
// ProductVariations[0] pick silently chose the 5,000-piece reel over the
// buy-1 cut-tape option, which is the actual bug this function fixes.
const REAL_VARIATIONS: DigiKeyProductVariation[] = [
  {
    DigiKeyProductNumber: "CF14JT100KTR-ND",
    MinimumOrderQuantity: 5000,
    QuantityAvailableforPackageType: 245000,
    StandardPricing: [{ BreakQuantity: 5000, UnitPrice: 1.491 }],
  },
  {
    DigiKeyProductNumber: "CF14JT100KCT-ND",
    MinimumOrderQuantity: 1,
    QuantityAvailableforPackageType: 246456,
    StandardPricing: [{ BreakQuantity: 1, UnitPrice: 17 }],
  },
];

test("picks the lowest-minimum-order-quantity variation, not the first one returned", () => {
  const picked = pickHobbyistVariation(REAL_VARIATIONS);
  assert.equal(picked?.DigiKeyProductNumber, "CF14JT100KCT-ND");
  assert.equal(picked?.MinimumOrderQuantity, 1);
});

test("is order-independent — same result regardless of input order", () => {
  const reversed = [...REAL_VARIATIONS].reverse();
  const picked = pickHobbyistVariation(reversed);
  assert.equal(picked?.DigiKeyProductNumber, "CF14JT100KCT-ND");
});

test("treats a missing MinimumOrderQuantity as worse than any real value", () => {
  const withMissing: DigiKeyProductVariation[] = [
    { DigiKeyProductNumber: "NO-MOQ-FIELD" },
    { DigiKeyProductNumber: "HAS-MOQ", MinimumOrderQuantity: 10 },
  ];
  const picked = pickHobbyistVariation(withMissing);
  assert.equal(picked?.DigiKeyProductNumber, "HAS-MOQ");
});

test("returns undefined for an empty or missing variations list", () => {
  assert.equal(pickHobbyistVariation([]), undefined);
  assert.equal(pickHobbyistVariation(undefined), undefined);
});
