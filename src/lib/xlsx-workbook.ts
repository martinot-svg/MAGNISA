import { strToU8, zipSync } from "fflate";

export type XlsxCell = string | number;
export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
};

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/?*:[\]]/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet ${index + 1}`;
}

function worksheetXml(rows: XlsxCell[][]): string {
  const body = rows.map((cells, rowIndex) => {
    const values = cells.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number") {
        const numeric = Number.isFinite(value) ? value : 0;
        return `<c r="${reference}"><v>${numeric}</v></c>`;
      }
      const text = escapeXml(String(value ?? ""));
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join("");
  return XML_HEADER + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Builds a standards-compliant XLSX package using inline strings (no shared-string table). */
export function buildXlsxWorkbook(sheets: XlsxSheet[]): Uint8Array {
  if (!sheets.length) throw new Error("An XLSX workbook must contain at least one worksheet.");
  const names = sheets.map((sheet, index) => safeSheetName(sheet.name, index));
  if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) {
    throw new Error("Worksheet names must be unique, ignoring case.");
  }

  const worksheetOverrides = sheets.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  const workbookSheets = names.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  const worksheetRelationships = sheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(XML_HEADER + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${worksheetOverrides}</Types>`),
    "_rels/.rels": strToU8(XML_HEADER + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8(XML_HEADER + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(XML_HEADER + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}</Relationships>`),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows));
  });
  return zipSync(files, { level: 6 });
}
