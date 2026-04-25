const { chromium } = require('playwright');
const fs = require('fs');

const BASE = "https://echospaces.in";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
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
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a"))
          .map(a => ({
            text: a.innerText.trim(),
            href: a.href
          }))
          .filter(l => l.href.startsWith("http"));

        const buttons = Array.from(document.querySelectorAll("button"))
          .map(b => b.innerText.trim())
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

        const ctas = Array.from(document.querySelectorAll("a, button"))
          .map(el => el.innerText.trim())
          .filter(t =>
            t.toLowerCase().includes("buy") ||
            t.toLowerCase().includes("get") ||
            t.toLowerCase().includes("quote") ||
            t.toLowerCase().includes("start") ||
            t.toLowerCase().includes("pay")
          );

        return {
          title: document.title,
          url: window.location.href,
          links,
          buttons,
          inputs,
          forms,
          ctas
        };
      });

      DB.push(data);

      // enqueue internal links
      data.links.forEach(l => {
        if (l.href.startsWith(BASE) && !visited.has(l.href)) {
          queue.push(l.href);
        }
      });

    } catch (err) {
      console.log("Failed:", url);
    }
  }

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("FULL STRUCTURE CAPTURED");
})();
