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
    if (width < 1024) {
      // DOM content can be present before the client-side media-query hook hydrates.
      await page.waitForFunction(
        () => document.querySelector(".mg-sidebar")?.inert === true,
        null, { timeout: 15000 }
      );
    }
    await page.waitForTimeout(120);
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
    if (state.documentWidth > state.viewportWidth + 3) {
      const offenders = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        return Array.from(document.body.querySelectorAll("*"))
          .map(el => {
            const r = el.getBoundingClientRect();
            return { tag:el.tagName, cls:String(el.className).slice(0,90), width:Math.round(r.width),
              left:Math.round(r.left), right:Math.round(r.right), scroll:el.scrollWidth,
              position:getComputedStyle(el).position };
          })
          .filter(item => item.right > limit + 2 && item.left < limit && item.width > 0)
          .sort((a,b) => b.right - a.right).slice(0,24);
      });
      await page.screenshot({path:resolve(`test-results/responsive/overflow-${width}x${height}.png`),fullPage:false});
      const diagnostics = await page.evaluate(() => {
        const elem = document.documentElement, body = document.body;
        const overview = { innerWidth:window.innerWidth, clientWidth:elem.clientWidth,
          htmlScrollWidth:elem.scrollWidth, bodyScrollWidth:body.scrollWidth,
          bodyWidth:Math.round(body.getBoundingClientRect().width),
          shellWidth:Math.round(document.querySelector(".mg-app")?.getBoundingClientRect().width||0) };
        const large = Array.from(document.body.querySelectorAll("*"))
          .map(e => ({name:e.tagName+"."+String(e.className).slice(0,70),w:e.clientWidth,s:e.scrollWidth,
            ownOverflow:getComputedStyle(e).overflowX, x:Math.round(e.getBoundingClientRect().left)}))
          .filter(e => e.s > e.w + 4 && e.w > 0)
          .sort((a,b) => b.s-b.w-(a.s-a.w)).slice(0,35);
        const hidden = {};
        for (const selector of [".mg-sidebar",".mg-topbar",".mg-content",
          ".magnisa-dashboard",".magnisa-dashboard-toolbar",".magnisa-dashboard-kpis",
          ".magnisa-dashboard-charts",".magnisa-chart-card","svg"]) {
          const nodes = Array.from(document.querySelectorAll(selector));
          const prior = nodes.map(e => e.getAttribute("style"));
          nodes.forEach(e => e.style.setProperty("display","none","important"));
          hidden[selector] = elem.scrollWidth;
          nodes.forEach((e,i) => {
            if (prior[i]===null) e.removeAttribute("style");
            else e.setAttribute("style",prior[i]);
          });
        }
        return {overview,large,hidden};
      });
      throw new Error(`Débordement horizontal document à ${width}x${height}: ${state.documentWidth} > ${state.viewportWidth}; rects=${JSON.stringify(offenders)}, diagnostics=${JSON.stringify(diagnostics)}`);
    }
    assert(state.navCount > 0,"La navigation fonctionnelle est absente.");
    assert(!state.kpiWrapped,"Un montant KPI peut être coupé ou éclaté en plusieurs lignes.");
    if(width < 1024) {
      assert(state.buttonVisible,`Bouton de menu invisible à ${width}px`);
      assert(state.navInert,"La sidebar masquée doit être inaccessible au clavier.");
      await page.getByRole("button",{name:"Ouvrir le menu des modules"}).click();
      await page.waitForFunction(() => {
        const sidebar = document.querySelector(".mg-sidebar");
        return sidebar && sidebar.getBoundingClientRect().left >= -1 && !sidebar.inert;
      }, null, { timeout: 5000 });
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
