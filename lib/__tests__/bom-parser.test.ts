import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBomText } from "../bom-parser.ts";

// Real fixture: github.com/TOILmodular/TuringMachine/blob/main/BOM/BOM.md
// (a fork of Music Thing Modular's Turing Machine, a well-known open-source
// Eurorack module), fetched live 2026-09-21. Kept verbatim including its
// ragged whitespace ("|1 | " for the 3.3K row) since real-world messiness is
// exactly what the parser needs to survive.
const REAL_TURING_MACHINE_BOM = `# BOM

| Description | Value | Quantity | |
| --- | --- | --- | --- |
| Resistor 1/4W | 1K | 3 | |
| Resistor 1/4W | 1.6K | 2 | |
| Resistor 1/4W | 3.3K |1 | |
| Resistor 1/4W | 5.1K | 1 | |
| Resistor 1/4W | 10K | 10 | |
| Resistor 1/4W | 15K | 2 | |
| Resistor 1/4W | 47K | 1 | |
| Resistor 1/4W | 51K | 1 | |
| Resistor 1/4W | 68K | 1 | |
| Resistor 1/4W | 100K | 15 | |
| Resistor 1/4W | 470K | 2 | |
| Trimmer | 1M | 1 | Multi-Turn |
| Capacitor Electrolytic | 10uF | 2 | |
| Capacitor Ceramic | 0.47uF | 3 | |
| Capacitor Ceramic | 0.1uF | 14 | SMD - Package 1608 |
| Ceramic | 0.01uF | 1 | |
| Capacitor Ceramic | 1000pF | 6 | |
| Capacitor Ceramic | 330pF | 1 | |
| Diode | 1N4148 | 1 | |
| LED | 3mm | 10 | |
| Transistor | 2N3904 | 1 | |
| Op Amp | TL074 or UPC824 | 1 | SMD |
| Op Amp | TL072 or NJM4580 | 1 | SMD |
| Shift Register | CD4015 | 2 | |
| Bilateral Switch IC | CD4016 | 1 | |
| Hex Buffer/Converter | TC4050 | 2 | |
| Quad AND Gate | TC4081 | 2 | |
| DAC | DAC08EPZ | 1 | |
| Shunt Voltage Regulator | TL431 | 1 | |
| Voltage Regulator +9V | LM78L09 | 1 | |
| Toggle Switch | (ON)-OFF-(ON) | 1 | SPDT, Momentary Spring Return Switch |
| Rotary Switch | 1 Pole - 8 Positions | 1 | see Footnote *) |
| Potentiometer | B50K | 2 | |
| Mono Jack | 3.5mm | 5 | |
| Header | 2.54mm Male 1x5 | 2 | Connector Main Board |
| Header | 2.54mm Male 1x9 | 1 | Connector Main Board |
| Header | 2.54mm Female 1x5 | 2 | Connector Control Board |
| Header | 2.54mm Female 1x9 | 1 | Connector Control Board |
| Header | 2.54mm Female 2x5 | 1 | Power Connector |
| Header | 2.54mm Male 2x5 | 2 | Expander Connector |

*) Rotary Switch:

For "original" version: Cosland RS-2688-0112-38N

For "Thonk" version: ALPHA SR1712F-0108-20F0A-N9 (available at thonk.co.jp)
`;

test("parses every real data row from the Turing Machine BOM, skipping header/separator/footnote", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  // 40 real component rows in the fixture above (11 resistors + trimmer +
  // 6 capacitor-family rows + diode + LED + transistor + 8 IC-family rows +
  // 2 switches + potentiometer + jack + 6 header rows = 40).
  assert.equal(lines.length, 40);
});

test("classifies resistors, including one with ragged whitespace around its quantity cell", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const r33k = lines.find((l) => l.value === "3.3K");
  assert.equal(r33k?.kind, "resistor");
  assert.equal(r33k?.quantity, 1);
});

test("classifies a bare 'Ceramic' description (no 'Capacitor' prefix) as a capacitor", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const bareCeramic = lines.find((l) => l.description === "Ceramic");
  assert.equal(bareCeramic?.kind, "capacitor");
  assert.equal(bareCeramic?.value, "0.01uF");
});

test("classifies a Trimmer as a potentiometer, preserving its Multi-Turn note", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const trimmer = lines.find((l) => l.description === "Trimmer");
  assert.equal(trimmer?.kind, "potentiometer");
  assert.equal(trimmer?.note, "Multi-Turn");
});

test("classifies LED as diode, not a separate/unknown kind", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const led = lines.find((l) => l.description === "LED");
  assert.equal(led?.kind, "diode");
});

test("classifies every named IC-family part as 'ic', including ones containing the word 'switch'", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const icDescriptions = [
    "Op Amp",
    "Shift Register",
    "Bilateral Switch IC", // must NOT fall through to the generic "switch" kind
    "Hex Buffer/Converter",
    "Quad AND Gate",
    "DAC",
    "Shunt Voltage Regulator",
    "Voltage Regulator +9V",
  ];
  for (const desc of icDescriptions) {
    const line = lines.find((l) => l.description === desc);
    assert.equal(line?.kind, "ic", `expected "${desc}" to classify as ic`);
  }
});

test("classifies Toggle Switch and Rotary Switch as 'switch', separate from IC switches", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const toggle = lines.find((l) => l.description === "Toggle Switch");
  const rotary = lines.find((l) => l.description === "Rotary Switch");
  assert.equal(toggle?.kind, "switch");
  assert.equal(toggle?.note, "SPDT, Momentary Spring Return Switch");
  assert.equal(rotary?.kind, "switch");
});

test("classifies Mono Jack as 'jack' and Header rows as 'header'", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const jack = lines.find((l) => l.description === "Mono Jack");
  assert.equal(jack?.kind, "jack");
  assert.equal(jack?.value, "3.5mm");

  const headers = lines.filter((l) => l.description === "Header");
  assert.equal(headers.length, 6); // 6 distinct header rows, none merged/dropped despite identical descriptions
  assert.ok(headers.every((h) => h.kind === "header"));
});

test("does not parse the footnote prose below the table as a BOM line", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  const bogus = lines.find((l) => l.description.includes("Cosland") || l.description.includes("Thonk"));
  assert.equal(bogus, undefined);
});

test("skips the header row and the '---' separator row", () => {
  const lines = parseBomText(REAL_TURING_MACHINE_BOM);
  assert.equal(lines.some((l) => l.description === "Description"), false);
  assert.equal(lines.some((l) => l.description.includes("---")), false);
});
