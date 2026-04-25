const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const BASE = "https://echospaces.in";

  let visited = new Set();
  let results = [];

  async function autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let totalHeight = 0;
        let distance = 300;
        let timer = setInterval(() => {
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

  async function scrape(url) {
    if (visited.has(url)) return;
    visited.add(url);

    console.log("🚀 Scraping:", url);

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 90000
      });
    } catch {
      console.log("❌ Failed:", url);
      return;
    }

    // 🔥 CRITICAL FIXES
    await page.waitForTimeout(6000);
    await autoScroll(page);
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      return {
        title: document.title,
        url: location.href,

        links: Array.from(document.querySelectorAll("a"))
          .map(a => a.href)
          .filter(h => h && h.startsWith("http")),

        buttons: Array.from(document.querySelectorAll("button"))
          .map(b => b.innerText.trim())
          .filter(Boolean),

        inputs: Array.from(document.querySelectorAll("input, textarea, select"))
          .map(i => ({
            name: i.name || "",
            type: i.type || "",
            placeholder: i.placeholder || ""
          })),

        forms: Array.from(document.querySelectorAll("form"))
          .map(f => ({
            action: f.action,
            method: f.method
          })),

        textBlocks: text.split("\n")
          .map(t => t.trim())
          .filter(t => t.length > 40)
          .slice(0, 80),

        emails: [...new Set(
          text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || []
        )],

        phones: [...new Set(
          text.match(/\+?\d[\d\s-]{8,}/g) || []
        )],

        meta: {
          description: document.querySelector("meta[name='description']")?.content || "",
          keywords: document.querySelector("meta[name='keywords']")?.content || ""
        }
      };
    });

    results.push(data);

    const internalLinks = data.links.filter(l => l.includes(BASE));

    for (let link of internalLinks.slice(0, 10)) {
      await scrape(link);
    }
  }

  await scrape(BASE);

  fs.writeFileSync("db.json", JSON.stringify({
    totalPages: results.length,
    pages: results
  }, null, 2));

  console.log("✅ DONE:", results.length, "pages");

  await browser.close();
})();
