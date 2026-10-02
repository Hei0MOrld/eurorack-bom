import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, defaultCandidateIndex } from "../match-ranker.ts";
import type { SupplierPart } from "../supplier-types.ts";
import type { ParsedBomLine } from "../bom-parser.ts";

function part(overrides: Partial<SupplierPart>): SupplierPart {
  return {
    supplier: "mouser",
    supplierPartNumber: "TEST",
    manufacturer: "Test Mfg",
    manufacturerPartNumber: "TEST-PN",
    description: "",
    price: "$0.10",
    availability: "In Stock",
    productUrl: "#",
    ...overrides,
  };
}

function line(overrides: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    raw: "",
    description: "",
    kind: "switch",
    value: "",
    quantity: 1,
    note: "",
    packageRequirement: [],
    ...overrides,
  };
}

test("switch/jack/header candidates are always 'unknown' confidence — no verifiable target value exists", () => {
  const candidates = [
    part({ description: "SPDT Toggle Switch ON-OFF-ON", price: "$1.20" }),
    part({ description: "Some other switch", price: "$0.50" }),
  ];
  const ranked = rankCandidates(line({ kind: "switch" }), candidates);
  assert.ok(ranked.every((r) => r.confidence === "unknown"));
});

test("switch/jack/header candidates still sort cheapest-first within their single confidence tier", () => {
  const candidates = [part({ price: "$1.20" }), part({ price: "$0.50" }), part({ price: "$0.80" })];
  const ranked = rankCandidates(line({ kind: "jack" }), candidates);
  assert.deepEqual(
    ranked.map((r) => r.part.price),
    ["$0.50", "$0.80", "$1.20"],
  );
});

test("a mocked $0.00 placeholder never outranks a real result, even in the always-unknown switch/jack/header path", () => {
  const real = part({ price: "$1.20" });
  const placeholder = part({ supplier: "digikey", supplierPartNumber: "MOCK-DK-0000", price: "$0.00" });
  const ranked = rankCandidates(line({ kind: "header" }), [placeholder, real]);
  assert.equal(ranked[0].part.supplierPartNumber, "TEST");
});

test("ic substring matching resolves an 'A or B' alternate value before scoring", () => {
  const candidates = [part({ manufacturerPartNumber: "TL074", description: "OP AMP QUAD JFET" })];
  const ranked = rankCandidates(
    line({ kind: "ic", value: "TL074 or UPC824" }),
    candidates,
  );
  assert.equal(ranked[0].confidence, "exact");
});

test("a real (non-mock) $0 price never wins a tiebreak either — treated as unpriced, sorted last", () => {
  const zeroPrice = part({ supplierPartNumber: "REAL-BUT-ZERO", price: "¥0" });
  const realPrice = part({ supplierPartNumber: "REAL-PRICED", price: "¥140" });
  const ranked = rankCandidates(line({ kind: "jack" }), [zeroPrice, realPrice]);
  assert.equal(ranked[0].part.supplierPartNumber, "REAL-PRICED");
});

test("capacitor: 'Capacitor Electrolytic' description demotes a matching-value ceramic part to 'possible'", () => {
  // Regression test for a real bug found via live testing: a "10uF
  // Electrolytic" line matched a real ceramic 0402 capacitor at "exact"
  // confidence purely because the farad value matched — wrong physical type.
  const ceramic = part({ description: "CAP CER 10UF 6.3V X5R 0402", price: "¥17" });
  const electrolytic = part({ description: "CAP ALUM 10UF 20% 16V RADIAL", price: "¥25" });
  const ranked = rankCandidates(
    line({ kind: "capacitor", description: "Capacitor Electrolytic", value: "10uF" }),
    [ceramic, electrolytic],
  );
  assert.equal(ranked[0].part.description, electrolytic.description);
  assert.equal(ranked[0].confidence, "exact");
  const ceramicResult = ranked.find((r) => r.part.description === ceramic.description);
  assert.equal(ceramicResult?.confidence, "possible");
});

test("capacitor: a bare 'Ceramic' description (no 'Capacitor' prefix) still applies the ceramic type hint", () => {
  const ceramic = part({ description: "CAP CER 0.01UF 50V X7R 0603" });
  const electrolytic = part({ description: "CAP ALUM 0.01UF 20% 50V RADIAL" });
  const ranked = rankCandidates(
    line({ kind: "capacitor", description: "Ceramic", value: "0.01uF" }),
    [electrolytic, ceramic],
  );
  assert.equal(ranked[0].part.description, ceramic.description);
});

// Package ranking. The reported bug: a DIP-14 line got a SOIC-14 part,
// because every TL074 variant was "exact" and the SOIC was cheapest.
const dipLine = () =>
  line({ kind: "ic", value: "TL074", packageRequirement: [{ family: "DIP", pins: 14 }] });

test("a cheaper wrong-package part no longer beats the right package", () => {
  const soic = part({ supplierPartNumber: "SOIC", price: "$0.40", description: "IC OPAMP JFET 4 CIRCUIT 14SOIC", manufacturerPartNumber: "TL074CDR" });
  const dip = part({ supplierPartNumber: "DIP", price: "$0.90", description: "IC OPAMP JFET 4 CIRCUIT 14DIP", manufacturerPartNumber: "TL074CN" });
  const ranked = rankCandidates(dipLine(), [soic, dip]);
  assert.equal(ranked[0].part.supplierPartNumber, "DIP");
  assert.equal(ranked[0].pkg.status, "match");
  assert.equal(ranked[1].pkg.status, "mismatch");
  assert.equal(defaultCandidateIndex(ranked), 0);
});

test("an unconfirmed package ranks between a match and a mismatch", () => {
  const soic = part({ supplierPartNumber: "SOIC", price: "$0.10", description: "TL074 14SOIC", manufacturerPartNumber: "TL074CDR" });
  const unknown = part({ supplierPartNumber: "UNK", price: "$0.50", description: "Op Amps Quad JFET", manufacturerPartNumber: "TL074CN" });
  const ranked = rankCandidates(dipLine(), [soic, unknown]);
  assert.deepEqual(ranked.map((c) => c.pkg.status), ["unknown", "mismatch"]);
});

test("when every candidate is the wrong package, nothing is picked by default", () => {
  const soic = part({ supplierPartNumber: "SOIC", description: "TL074 14SOIC", manufacturerPartNumber: "TL074CDR" });
  const tssop = part({ supplierPartNumber: "TSSOP", description: "TL074 14TSSOP", manufacturerPartNumber: "TL074CPWR" });
  const ranked = rankCandidates(dipLine(), [soic, tssop]);
  assert.equal(defaultCandidateIndex(ranked), null);
});

test("the right value still outranks the right package on a different part", () => {
  const rightChipWrongPkg = part({ supplierPartNumber: "TL074-SOIC", description: "TL074 14SOIC", manufacturerPartNumber: "TL074CDR" });
  const otherChipDip = part({ supplierPartNumber: "LM324-DIP", description: "LM324 14DIP", manufacturerPartNumber: "LM324N" });
  const ranked = rankCandidates(dipLine(), [otherChipDip, rightChipWrongPkg]);
  assert.equal(ranked[0].part.supplierPartNumber, "TL074-SOIC");
  assert.equal(ranked[0].confidence, "exact");
  assert.equal(defaultCandidateIndex(ranked), null, "and it is still not picked silently");
});

test("with no package in the BOM, ranking is unchanged and nothing is flagged as a mismatch", () => {
  const soic = part({ supplierPartNumber: "SOIC", price: "$0.40", description: "TL074 14SOIC", manufacturerPartNumber: "TL074CDR" });
  const dip = part({ supplierPartNumber: "DIP", price: "$0.90", description: "TL074 14DIP", manufacturerPartNumber: "TL074CN" });
  const ranked = rankCandidates(line({ kind: "ic", value: "TL074" }), [dip, soic]);
  assert.equal(ranked[0].part.supplierPartNumber, "SOIC");
  assert.deepEqual(ranked.map((c) => c.pkg.status), ["unspecified", "unspecified"]);
  assert.equal(ranked[0].pkg.found, "SOIC-14");
});
