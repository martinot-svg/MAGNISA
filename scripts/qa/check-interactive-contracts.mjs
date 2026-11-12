#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const extensions = new Set([".tsx", ".jsx"]);
const failures = [];
const modalRequiredFiles = new Map([
  ["src/app/(app)/mouvements-stock/page.tsx", 10],
  ["src/app/(app)/articles/page.tsx", 5],
  ["src/app/(app)/immobilisations/page.tsx", 15],
  ["src/app/(app)/factures/[id]/page.tsx", 7],
  ["src/app/(app)/paie/parametres/page.tsx", 7],
  ["src/app/(app)/commandes/page.tsx", 6],
  ["src/app/(app)/inventaires/page.tsx", 5],
  ["src/app/(app)/bibliotheque-documents/page.tsx", 1],
  ["src/app/(app)/clients/page.tsx", 2],
  ["src/app/(app)/commissions/page.tsx", 6],
  ["src/app/(app)/comptabilite/page.tsx", 1],
  ["src/app/(app)/etats-financiers/page.tsx", 1],
  ["src/app/(app)/fiscalite-social/page.tsx", 3],
  ["src/app/(app)/identite-documents/page.tsx", 1],
  ["src/app/(app)/modeles-documents/page.tsx", 1],
  ["src/app/(app)/parametres/page.tsx", 4],
  ["src/app/(app)/prestations-recurrentes/page.tsx", 3],
  ["src/app/(app)/prospects/page.tsx", 2],
  ["src/app/(app)/tresorerie/page.tsx", 1],
  ["src/app/(app)/prospects/[id]/page.tsx", 4],
  ["src/app/(app)/prospects/settings/page.tsx", 1],
  ["src/app/(app)/modeles-documents/historique/page.tsx", 2],
  ["src/app/(app)/fiscalite/calendrier/page.tsx", 3],
  ["src/app/(app)/fiscalite-social/calendrier/page.tsx", 3],
  ["src/app/(app)/emprunts/[id]/avenant/amendment-form.tsx", 1],
  ["src/app/(app)/devis/[id]/page.tsx", 5],
  ["src/app/(app)/clients/[id]/page.tsx", 2],
  ["src/app/(app)/clients/[id]/contributions/page.tsx", 4],
  ["src/components/app-shell.tsx", 1],
]);
const modalWriteFormCounts = new Map([...modalRequiredFiles.keys()].map((file) => [file, 0]));
const dialogActionComponentFiles = new Set([
  "src/components/internal-transfer-form.tsx",
  "src/components/invoice-builder.tsx",
  "src/components/payment-entry-form.tsx",
  "src/components/purchase-order-form.tsx",
  "src/components/quote-builder.tsx",
]);
let formCount = 0;
let buttonCount = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : extensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

function attributesOf(opening) {
  const attrs = new Map();
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop)) {
      const value = !prop.initializer
        ? "true"
        : ts.isStringLiteral(prop.initializer) ? prop.initializer.text
          : ts.isJsxExpression(prop.initializer) && prop.initializer.expression
            ? prop.initializer.expression.getText()
            : prop.initializer.getText();
      attrs.set(prop.name.getText(), value);
    }
  }
  return attrs;
}

function isInsideForm(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText() === "form") return true;
  }
  return false;
}

function isInsideFormDialog(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText() === "FormDialog") return true;
  }
  return false;
}


for (const file of walk(sourceRoot)) {
  const text = fs.readFileSync(file, "utf8");
  const kind = path.extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (dialogActionComponentFiles.has(relative) && !text.includes("useFormDialogAction")) {
    failures.push(`${relative} must connect its server action to the surrounding FormDialog lifecycle`);
  }

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source).toLowerCase();
      const attrs = attributesOf(node);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      if (tag === "form") {
        formCount += 1;
        const method = String(attrs.get("method") || "post").toLowerCase();
        if (!attrs.has("action") && !attrs.has("onSubmit") && method !== "get") {
          failures.push(`${relative}:${line} <form> has no action, onSubmit or explicit GET method`);
        }
        if (attrs.has("action") && (relative.startsWith("src/app/(app)/") || modalRequiredFiles.has(relative))) {
          if (modalRequiredFiles.has(relative)) modalWriteFormCounts.set(relative, modalWriteFormCounts.get(relative) + 1);
          if (!isInsideFormDialog(node)) failures.push(`${relative}:${line} write form is not wrapped in FormDialog`);
        }
      }

      if (tag === "button") {
        buttonCount += 1;
        const type = String(attrs.get("type") || "").toLowerCase();
        const disabled = attrs.has("disabled");
        const hasClick = attrs.has("onClick");
        if (!disabled && !hasClick && (type === "button" || (!type && !isInsideForm(node)))) {
          failures.push(`${relative}:${line} <button> has no click handler and is not a form submit control`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
}

console.log(`Checked ${formCount} forms and ${buttonCount} buttons in ${walk(sourceRoot).length} TSX/JSX files.`);
for (const [file, expected] of modalRequiredFiles) {
  const actual = modalWriteFormCounts.get(file) || 0;
  console.log(`${file}: ${actual}/${expected} write forms covered by FormDialog.`);
  if (actual !== expected) failures.push(`${file} expected ${expected} FormDialog-wrapped write forms, found ${actual}`);
}

if (failures.length) {
  console.error(`Found ${failures.length} interactive contract violation(s):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASS: all statically verifiable form and button contracts are satisfied.");
}
