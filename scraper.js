const { chromium } = require('playwright');
const fs = require('fs');

const BASE = "https://echospaces.in";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });
  });

  let visited = new Set();
  let queue = [BASE];
  let DB = [];

  while (queue.length > 0) {
    const url = queue.shift();

    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log("Visiting:", url);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(2000);
      await autoScroll(page);

      const data = await page.evaluate(() => {
        const clean = (t) => t?.trim().replace(/\s+/g, " ") || "";

        const links = Array.from(document.querySelectorAll("a"))
          .map(a => ({
            text: clean(a.innerText),
            href: a.href
          }))
          .filter(l => l.href.startsWith("http"));

        const buttons = Array.from(document.querySelectorAll("button"))
          .map(b => clean(b.innerText));

        const inputs = Array.from(document.querySelectorAll("input"))
          .map(i => ({
            name: i.name,
            type: i.type,
            placeholder: i.placeholder
          }));

        const forms = Array.from(document.querySelectorAll("form"))
          .map(f => ({
            action: f.action,
            method: f.method
          }));

        const textBlocks = Array.from(document.querySelectorAll("h1,h2,h3,p"))
          .map(el => clean(el.innerText))
          .filter(t => t.length > 30);

        return {
          title: document.title,
          url: window.location.href,
          links,
          buttons,
          inputs,
          forms,
          textBlocks
        };
      });

      DB.push(data);

      // 🔥 ADD NEW LINKS TO QUEUE (INTERNAL ONLY)
      data.links.forEach(l => {
        if (
          l.href.startsWith(BASE) &&
          !visited.has(l.href)
        ) {
          queue.push(l.href);
        }
      });

    } catch (err) {
      console.log("FAILED:", url, err.message);
    }
  }

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("DONE — FULL SITE MAPPED");
})();

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 200;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}
