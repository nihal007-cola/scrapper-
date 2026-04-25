const { chromium } = require('playwright');
const fs = require('fs');

const BASE = "https://echospaces.in";

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let visited = new Set();
  let queue = [BASE];

  let DB = [];

  console.log("🚀 Scraper started...");

  while (queue.length > 0) {
    const url = queue.shift();

    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log("\n🌐 Visiting:", url);

      // 🔥 FIXED LOAD STRATEGY
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      // 🔥 EXTRA WAIT FOR JS RENDER
      await page.waitForTimeout(5000);

      // 🔥 SCROLL (loads lazy content)
      await autoScroll(page);

      // 🔥 CLICK ALL BUTTONS (simulate real user)
      const buttons = await page.$$("button");
      for (const btn of buttons) {
        try {
          await btn.click({ timeout: 1000 });
          await page.waitForTimeout(800);
        } catch {}
      }

      // 🔥 DEBUG PAGE SIZE
      const html = await page.content();
      console.log("📄 Page size:", html.length);

      // 🔥 EXTRACT EVERYTHING
      const data = await page.evaluate(() => {
        const clean = (t) => t?.trim().replace(/\s+/g, " ") || "";

        const links = Array.from(document.querySelectorAll("a"))
          .map(a => ({
            text: clean(a.innerText),
            href: a.href
          }))
          .filter(l => l.href);

        const buttons = Array.from(document.querySelectorAll("button"))
          .map(b => clean(b.innerText))
          .filter(Boolean);

        const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
          .map(i => ({
            tag: i.tagName,
            name: i.name,
            type: i.type,
            placeholder: i.placeholder
          }));

        const forms = Array.from(document.querySelectorAll("form"))
          .map(f => ({
            action: f.action,
            method: f.method
          }));

        const textBlocks = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,span,div"))
          .map(el => clean(el.innerText))
          .filter(t => t.length > 40 && t.length < 1000);

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

      console.log("🔗 Links found:", data.links.length);

      DB.push(data);

      // 🔥 ADD NEW LINKS TO QUEUE
      data.links.forEach(l => {
        if (
          l.href.startsWith(BASE) &&
          !visited.has(l.href) &&
          !queue.includes(l.href)
        ) {
          queue.push(l.href);
        }
      });

    } catch (err) {
      console.log("❌ Failed:", url, err.message);
    }
  }

  // 🔥 SAVE FINAL DB
  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  console.log("\n✅ DONE — Full site scraped");

  await browser.close();
})();

// 🔥 AUTO SCROLL FUNCTION
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}
