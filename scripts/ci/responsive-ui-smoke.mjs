import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!email || !password) throw new Error("Le test responsive nécessite le compte de recette local et isolé.");

const screens = [
  [360,800],[375,812],[390,844],[412,915],[430,932],
  [768,1024],[800,1280],[1024,768],
  [1280,720],[1366,768],[1440,900],[1920,1080],[2560,1080],
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
mkdirSync("test-results/responsive", { recursive: true });
const browser = await chromium.launch({ headless:true, args:["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto(baseUrl+"/login",{waitUntil:"domcontentloaded"});
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button",{name:"Se connecter"}).click();
  await page.waitForURL(url=>url.pathname==="/dashboard",{timeout:30000});
  for (const [width,height] of screens) {
    await page.setViewportSize({width,height});
    await page.goto(baseUrl+"/dashboard",{waitUntil:"domcontentloaded"});
    await page.locator(".mg-app").waitFor({state:"visible"});
    await page.waitForTimeout(350);
    const state = await page.evaluate(() => {
      const shell = document.querySelector(".mg-app");
      const sidebar = document.querySelector(".mg-sidebar");
      const nav = document.querySelector(".mg-sidebar nav");
      const chart = document.querySelector(".magnisa-dashboard-charts");
      const kpis = [...document.querySelectorAll(".magnisa-kpi-value")];
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        shellWidth: shell?.getBoundingClientRect().width ?? 0,
        navCount: nav?.querySelectorAll("a[href]").length ?? 0,
        navVisible: !!sidebar && sidebar.getBoundingClientRect().right > 0,
        navInert: sidebar?.inert,
        buttonVisible: !!document.querySelector(".mg-menu-trigger") && getComputedStyle(document.querySelector(".mg-menu-trigger")).display !== "none",
        kpiWrapped: kpis.some(el => getComputedStyle(el).whiteSpace !== "nowrap"),
        chartWidth: chart?.getBoundingClientRect().width ?? 0,
      };
    });
    assert(state.documentWidth <= state.viewportWidth + 3,
      `Débordement horizontal document à ${width}x${height} : ${state.documentWidth} > ${state.viewportWidth}`);
    assert(state.navCount > 0,"La navigation fonctionnelle est absente.");
    assert(!state.kpiWrapped,"Un montant KPI peut être coupé ou éclaté en plusieurs lignes.");
    if(width < 1024) {
      assert(state.buttonVisible,`Bouton de menu invisible à ${width}px`);
      assert(state.navInert,"La sidebar masquée doit être inaccessible au clavier.");
      await page.getByRole("button",{name:"Ouvrir le menu des modules"}).click();
      await page.getByRole("link",{name:"MAGNISA",exact:true}).first().waitFor({state:"visible"});
      const openState = await page.locator(".mg-sidebar").evaluate(el=>({
        left:el.getBoundingClientRect().left,
        visible:el.getBoundingClientRect().right>0,
        inert:el.inert,
      }));
      assert(openState.visible && !openState.inert,`Menu mobile ne s'ouvre pas à ${width}px`);
      await page.keyboard.press("Escape");
      await page.waitForFunction(()=>document.querySelector(".mg-sidebar")?.inert === true);
    } else {
      assert(state.navVisible && !state.navInert,`Sidebar desktop absente à ${width}px`);
      const toggle = page.getByRole("button",{name:"Réduire la navigation"});
      await toggle.click();
      assert(await page.locator(".mg-app.mg-collapsed").count()===1,"La sidebar ne se réduit pas.");
      await page.getByRole("button",{name:"Développer la navigation"}).click();
    }
    await page.screenshot({path:resolve(`test-results/responsive/magnisa-${width}x${height}.png`),fullPage:false});
    process.stdout.write(`OK responsive ${width}x${height}, navigation et KPI\n`);
  }
  assert(errors.length===0,"Erreurs JavaScript navigateur : "+errors.join(" | "));
} finally {
  await browser.close();
}
