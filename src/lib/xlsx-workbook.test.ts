import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsxWorkbook } from "./xlsx-workbook";

describe("buildXlsxWorkbook", () => {
  it("creates an OpenXML ZIP workbook with named worksheets and typed cells", () => {
    const bytes = buildXlsxWorkbook([
      { name: "Bilan", rows: [["Actif & passif", 1250.5], ["Entreprise <A>", "MGA"]] },
      { name: "Compte résultat", rows: [["Résultat", -250]] },
    ]);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain("[Content_Types].xml");
    expect(Object.keys(files)).toContain("xl/workbook.xml");
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect(workbook).toContain('name="Bilan"');
    expect(workbook).toContain('name="Compte résultat"');

    const firstSheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(firstSheet).toContain("<v>1250.5</v>");
    expect(firstSheet).toContain("Actif &amp; passif");
    expect(firstSheet).toContain("Entreprise &lt;A&gt;");
    expect(firstSheet).toContain('t="inlineStr"');
  });

  it("removes XML 1.0 control characters from exported text cells", () => {
    const bytes = buildXlsxWorkbook([{ name: "Bilan", rows: [["Avant\u0001Après"]] }]);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("AvantAprès");
    expect(sheet).not.toContain("\u0001");
  });

  it("rejects an empty workbook and duplicate worksheet names", () => {
    expect(() => buildXlsxWorkbook([])).toThrow(/at least one worksheet/i);
    expect(() => buildXlsxWorkbook([
      { name: "Bilan", rows: [] },
      { name: "bilan", rows: [] },
    ])).toThrow(/unique/i);
  });

  it("normalizes invalid and overlong worksheet names", () => {
    const bytes = buildXlsxWorkbook([{ name: "A very long/name that exceeds 31 chars", rows: [["ok"]] }]);
    const files = unzipSync(bytes);
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect(workbook).toContain('name="A very long name that exceeds 3"');
  });
});
