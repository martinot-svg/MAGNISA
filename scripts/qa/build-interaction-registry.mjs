#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const outputPath = path.join(root, "test-results", "interaction-registry.json");
const extensions = new Set([".tsx", ".ts", ".jsx", ".js"]);
const eventNames = new Set(["onClick", "onSubmit", "onChange", "onKeyDown", "onKeyUp", "onMouseDown", "onPointerDown", "onPress"]);
const interactiveTags = new Set(["button", "a", "input", "select", "textarea", "form", "summary", "link"]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : extensions.has(path.extname(entry.name)) ? [full] : [];
  });
}
function valueOf(attr, source) {
  if (!attr.initializer) return "true";
  const init = attr.initializer;
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) return init.expression.getText(source);
  return init.getText(source);
}
function attributesOf(opening, source) {
  const attrs = new Map();
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(source), valueOf(prop, source));
  }
  return attrs;
}
function labelOf(node, source, attrs) {
  for (const key of ["aria-label", "title", "placeholder", "value", "name"]) {
    const value = attrs.get(key);
    if (value && value !== "true") return value.replace(/^["']|["']$/g, "").slice(0, 180);
  }
  if (ts.isJsxElement(node.parent)) {
    const text = node.parent.children.map((child) => {
      if (ts.isJsxText(child)) return child.text;
      if (ts.isJsxExpression(child) && child.expression) return "{" + child.expression.getText(source) + "}";
      return "";
    }).join(" ").replace(/\s+/g, " ").trim();
    return text.slice(0, 180);
  }
  return "";
}
function moduleOf(file) {
  const parts = file.split(path.sep);
  const app = parts.indexOf("(app)");
  if (app >= 0 && parts[app + 1]) return parts[app + 1];
  if (parts.includes("api")) return "api";
  if (parts.includes("components")) return "shared-components";
  if (parts.includes("lib") || parts.includes("server")) return "services";
  return "application";
}
function operationOf(tag, attrs) {
  const lower = tag.toLowerCase();
  if (lower === "form" || attrs.has("action")) return "FORM_SUBMISSION";
  if (attrs.has("onClick") || attrs.has("onPress")) return "CLICK_ACTION";
  if (attrs.has("href")) return "NAVIGATION";
  if (attrs.has("onChange")) return "INPUT_CHANGE";
  if ([...attrs.keys()].some((key) => eventNames.has(key))) return "KEYBOARD_OR_POINTER_ACTION";
  if (["input", "select", "textarea"].includes(lower)) return "FORM_CONTROL";
  return "INTERACTIVE_ELEMENT";
}

const files = walk(sourceRoot);
const interactions = [];
for (const absolutePath of files) {
  const relativePath = path.relative(root, absolutePath);
  const ext = path.extname(absolutePath);
  const kind = ext === ".tsx" || ext === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const sourceText = fs.readFileSync(absolutePath, "utf8");
  const source = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, kind);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = attributesOf(node, source);
      const lower = tag.toLowerCase();
      const type = (attrs.get("type") || "").replace(/^["']|["']$/g, "").toLowerCase();
      const hasEvent = [...attrs.keys()].some((key) => eventNames.has(key));
      const isInteractive = interactiveTags.has(lower) || hasEvent || (attrs.has("href") && /link/i.test(tag));
      if (isInteractive && !(lower === "input" && type === "hidden")) {
        const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
        const handlers = {};
        for (const key of ["onClick", "onSubmit", "onChange", "onKeyDown", "onPress", "action", "href"]) {
          if (attrs.has(key)) handlers[key] = attrs.get(key).slice(0, 320);
        }
        interactions.push({
          id: relativePath + ":" + (pos.line + 1) + ":" + (pos.character + 1) + ":" + tag,
          module: moduleOf(relativePath), sourceFile: relativePath,
          line: pos.line + 1, column: pos.character + 1, element: tag,
          label: labelOf(node, source, attrs), operation: operationOf(tag, attrs),
          inputType: type || null, name: attrs.get("name") || null, handlers,
          disabledByDefault: attrs.has("disabled"),
          permission: "REQUIRES_SERVER_HANDLER_REVIEW",
          affectedTables: "REQUIRES_SERVICE_TRACE",
          scenario: "Valid/invalid input, unauthorized user, network failure, duplicate submission and persisted result",
          expectedResult: "The configured action completes once, enforces authorization and persists the expected business result",
          observedResult: "NOT_EXECUTED_BY_STATIC_INVENTORY",
          status: "NOT_TESTED",
          scope: "One source location; conditional and repeated rendering may create multiple runtime instances",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
interactions.sort((a,b)=>a.sourceFile.localeCompare(b.sourceFile)||a.line-b.line||a.column-b.column);
const modules=[...new Set(interactions.map((x)=>x.module))].sort();
const byModule=Object.fromEntries(modules.map((name)=>[name,interactions.filter((x)=>x.module===name).length]));
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify({
  generatedAt:new Date().toISOString(),
  repositoryScope:"src/**/*.ts, src/**/*.tsx, src/**/*.js, src/**/*.jsx",
  sourceFilesScanned:files.length,
  interactionSourceLocations:interactions.length,
  statusCounts:{NOT_TESTED:interactions.length},
  byModule,
  limitations:[
    "Static discovery is not functional validation.",
    "Repeated JSX in loops is recorded once per source location, not once per runtime instance.",
    "Permissions, endpoints, database tables and persistence require separate handler tracing and runtime tests.",
    "Controls dynamically generated outside the scanned source tree may not be represented."
  ],
  interactions
},null,2)+"\n");
console.log("Scanned "+files.length+" source files; registered "+interactions.length+" interactive source locations.");
for(const [name,count] of Object.entries(byModule)) console.log(name+": "+count);
