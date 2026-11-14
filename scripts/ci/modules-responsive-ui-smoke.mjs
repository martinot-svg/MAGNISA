import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Read-only authenticated audit. Uses the same temporary local Supabase tenant as the replay workflow.
const base = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!email || !password) throw new Error("Ce test nécessite les identifiants de recette isolés.");

const viewportSet = [[390,844],[800,1280],[1366,768]];
const errors = [];
const failures = [];
const checked = [];
const browser = await chromium.launch({ headless:true, args:["--no-sandbox"] });
mkdirSync("test-results/modules-responsive",{recursive:true});

try {
  const page = await browser.newPage({ viewport:{width:1366,height:768}, deviceScaleFactor:1 });
  page.setDefaultTimeout(25000);
  page.on("pageerror", error => errors.push({url:page.url(),message:error.message}));
  await page.goto(base+"/login",{waitUntil:"domcontentloaded"});
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(url=>url.pathname==="/dashboard",{timeout:30000});
  await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:20000});

  // Discover the real menu: do not assume a role can access optional or disabled modules.
  const modules = await page.locator(".mg-sidebar nav a.mg-nav-link").evaluateAll(anchors =>
    anchors.map(a=>({label:a.textContent.trim().replace(/\s+/g," "),path:new URL(a.href).pathname}))
  );
  const unique = [...new Map(modules.map(m=>[m.path,m])).values()];
  if(unique.length < 20) throw new Error("Le menu de recette ne couvre pas assez de modules : "+unique.length);

  for (const [width,height] of viewportSet) {
    await page.setViewportSize({width,height});
    for (const module of unique) {
      const response = await page.goto(base+module.path,{waitUntil:"domcontentloaded",timeout:45000});
      await page.locator('.mg-app[data-mg-hydrated="true"]').waitFor({timeout:20000});
      const state = await page.evaluate(()=>{
        const root = document.documentElement;
        const shell = document.querySelector(".mg-app");
        const tables = [...document.querySelectorAll(".tableWrap")];
        const nav = document.querySelector(".mg-sidebar");
        const controls = [...document.querySelectorAll("button, a.button")].filter(el=>{
          const r=el.getBoundingClientRect();
          return r.width>0 && r.height>0 && !el.hasAttribute("disabled");
        });
        return {
          url:location.pathname,httpWidth:root.clientWidth,pageWidth:root.scrollWidth,
          shellWidth:Math.round(shell?.getBoundingClientRect().width||0),
          tableCount:tables.length,
          tablesScrollSafely:tables.every(el=>getComputedStyle(el).overflowX!=="visible"),
          menuState:nav?.inert===true,
          actions:controls.length,
          mainExists:!!document.querySelector("main#contenu-principal"),
        };
      });
      const issues = [];
      if (!response?.ok()) issues.push("HTTP "+response?.status());
      if (state.url!==module.path) issues.push("Redirection inattendue vers "+state.url);
      if (!state.mainExists) issues.push("Zone principale absente");
      if (state.pageWidth>state.httpWidth+3) issues.push("Débordement horizontal "+state.pageWidth+">"+state.httpWidth);
      if (!state.tablesScrollSafely) issues.push("Tableau sans défilement de secours");
      if (width<1024 && !state.menuState) issues.push("Menu fermé non inerte");
      checked.push({module:module.label,path:module.path,width,height,issues,tableCount:state.tableCount,actions:state.actions});
      if (issues.length) {
        const safePath=module.path.replace(/[^a-z0-9-]/gi,"-").slice(0,70);
        const screenshot=`test-results/modules-responsive/${width}-${safePath}.png`;
        await page.screenshot({path:resolve(screenshot),fullPage:false});
        failures.push({module:module.label,path:module.path,width,height,issues,screenshot});
      } else process.stdout.write(`OK module ${width}px ${module.path}\n`);
    }
  }
  writeFileSync("test-results/modules-responsive/report.json",JSON.stringify({screens:viewportSet,modules:unique.length,checks:checked.length,checked,failures,errors},null,2));
  process.stdout.write(`Audit ${unique.length} modules, ${checked.length} tailles/écrans : ${failures.length} échecs, ${errors.length} erreurs JavaScript\n`);
  if (failures.length || errors.length) {
    throw new Error("Conformité multi-modules non validée. Voir report.json et captures : "+
      JSON.stringify({failures:failures.slice(0,12),errors:errors.slice(0,5)}));
  }
} finally {
  await browser.close();
}
