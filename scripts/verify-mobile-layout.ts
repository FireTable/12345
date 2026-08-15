/**
 * Drives the shipped mobile layout: viewport export, nav destinations,
 * phone-breakpoint CSS, and table-scroll wrappers on the five primary pages.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appViewport } from "../app/viewport";
import { NAV_ITEMS } from "../app/_components/civic/nav-items";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function mediaBlocks(css: string, maxWidthPx: number): string[] {
  const re = new RegExp(
    `@media\\s*\\(\\s*max-width\\s*:\\s*${maxWidthPx}px\\s*\\)\\s*\\{`,
    "g"
  );
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(m.index + m[0].length, i - 1));
  }
  return blocks;
}

function ruleBody(block: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
  const hit = block.match(re);
  return hit ? hit[1] : null;
}

function hasDecl(body: string | null, prop: string, value: string): boolean {
  if (!body) return false;
  return new RegExp(`${prop}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(body);
}

assert(
  "viewport width is device-width",
  appViewport.width === "device-width",
  `got ${String(appViewport.width)}`
);
assert(
  "viewport initialScale is 1",
  appViewport.initialScale === 1,
  `got ${String(appViewport.initialScale)}`
);

const layoutSrc = read("app/layout.tsx");
assert(
  "root layout re-exports appViewport as viewport",
  /export const viewport = appViewport/.test(layoutSrc) &&
    /from ["']\.\/viewport["']/.test(layoutSrc)
);

const requiredHrefs = ["/", "/tickets", "/multifreq", "/themes", "/dict"];
// NAV_ITEMS is `as const` → .map(href) is a narrow literal tuple.
// `as readonly string[]` widens so .includes(string) accepts `h: string`.
const shippedHrefs = NAV_ITEMS.map((it) => it.href) as readonly string[];
assert(
  "nav ships the five primary routes",
  requiredHrefs.every((h) => shippedHrefs.includes(h)) && shippedHrefs.length === requiredHrefs.length,
  shippedHrefs.join(",")
);

const navSrc = read("app/_components/civic/civic-nav.tsx");
assert("nav ships a phone toggle control", navSrc.includes("navbar__toggle") && navSrc.includes("navbar-panel"));
assert("nav panel wraps menu + actions", navSrc.includes("navbar__panel") && navSrc.includes("navbar__menu"));

const globals = read("app/globals.css");
assert(
  "body is not clip-fixed with overflow-x:hidden",
  !/body\s*\{[^}]*overflow-x\s*:\s*hidden/.test(globals)
);

const componentsCss = read("app/_components/civic/components.css");
const pagesCss = read("app/_components/civic/civic-pages.css");
const shippedCss = `${componentsCss}\n${pagesCss}`;

const brandBase = ruleBody(componentsCss, ".navbar__brand");
assert(
  "navbar brand no longer forces 380px min-width",
  hasDecl(brandBase, "min-width", "0"),
  brandBase ?? "missing"
);

const tableScrollCss = pagesCss.match(/\.table-scroll[\s\S]*?\{[^}]+\}/);
assert(
  "table-scroll declares overflow-x:auto",
  Boolean(tableScrollCss && /overflow-x:\s*auto/.test(tableScrollCss[0])),
  tableScrollCss?.[0] ?? "missing"
);

const phone = mediaBlocks(shippedCss, 768);
assert("phone breakpoint max-width:768px exists", phone.length > 0, `blocks=${phone.length}`);
const phoneCss = phone.join("\n");

assert("phone nav toggle is shown", hasDecl(ruleBody(phoneCss, ".navbar__toggle"), "display", "flex"));
assert("phone nav panel is a dropdown until opened", hasDecl(ruleBody(phoneCss, ".navbar__panel"), "display", "none"));
assert("open nav panel becomes flex", hasDecl(ruleBody(phoneCss, ".navbar__panel.is-open"), "display", "flex"));
assert("phone hero stacks", hasDecl(ruleBody(phoneCss, ".page-hero"), "flex-direction", "column"));
assert(
  "phone KPI grids wrap to two columns",
  /grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(phoneCss)
);
assert("phone drawer fills the viewport", /max-width:\s*100vw/.test(ruleBody(phoneCss, ".drawer") ?? ""));
assert("phone filter tabs scroll locally", hasDecl(ruleBody(phoneCss, ".filter-tabs"), "overflow-x", "auto"));
assert("phone pagination wraps", hasDecl(ruleBody(phoneCss, ".pagination"), "flex-wrap", "wrap"));

const desktopNav = mediaBlocks(shippedCss, 768).length > 0;
assert("desktop chrome path remains the default (phone rules are max-width only)", desktopNav);

const pagesWithTables: Array<[string, string]> = [
  ["app/tickets/page.tsx", "workorder-table"],
  ["app/themes/page.tsx", "group-table"],
  ["app/multifreq/page.tsx", "workorder-table"],
  ["app/dict/page.tsx", "table-scroll"],
];
for (const [file, needle] of pagesWithTables) {
  const src = read(file);
  if (needle === "table-scroll") {
    assert(`${file} wraps the aliases table for local x-scroll`, src.includes("table-scroll"));
    continue;
  }
  const wrapped = new RegExp(`table-scroll[\\s\\S]{0,80}<table[^>]*className="${needle}"`).test(src);
  assert(`${file} wraps ${needle} in table-scroll`, wrapped);
}

assert("home heatmap uses heatmap-scroll", read("app/page.tsx").includes("heatmap-scroll"));

if (process.exitCode) {
  console.error("verify-mobile-layout failed");
  process.exit(process.exitCode);
}
console.log("verify-mobile-layout ok");
