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

  while (queue.length > 0) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log("Visiting:", url);

      await page.goto(url, {
        waitUntil: "networkidle",   // 🔥 CRITICAL FIX
        timeout: 60000
      });

      // 🔥 WAIT FOR REAL CONTENT
      await page.waitForTimeout(5000);

      // 🔥 SCROLL TO LOAD LAZY CONTENT
      await autoScroll(page);

      // 🔥 CLICK ALL BUTTONS (simulate user)
      const buttons = await page.$$("button");
      for (const btn of buttons) {
        try {
          await btn.click({ timeout: 1000 });
          await page.waitForTimeout(1000);
        } catch {}
      }

      const data = await page.evaluate(() => {
        const getText = (el) => el.innerText?.trim() || "";

        const links = Array.from(document.querySelectorAll("a"))
          .map(a => ({
            text: getText(a),
            href: a.href
          }))
          .filter(l => l.href);

        const buttons = Array.from(document.querySelectorAll("button"))
          .map(b => getText(b))
          .filter(Boolean);

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

        const textBlocks = Array.from(document.querySelectorAll("div, p, span"))
          .map(el => getText(el))
          .filter(t => t.length > 30 && t.length < 1000);

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

      // 🔥 QUEUE INTERNAL LINKS
      data.links.forEach(l => {
        if (l.href.startsWith(BASE) && !visited.has(l.href)) {
          queue.push(l.href);
        }
      });

    } catch (err) {
      console.log("Failed:", url, err.message);
    }
  }

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("FULL SITE + INTERACTIONS CAPTURED");
})();

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
