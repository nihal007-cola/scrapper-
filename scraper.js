const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  const visited = new Set();
  const queue = ["https://echospaces.in"];
  const results = [];

  console.log("🚀 Starting full site crawl...");

  async function scrape(url) {
    if (visited.has(url)) return;
    visited.add(url);

    try {
      console.log("➡️ Visiting:", url);

      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 120000
      });

      // wait for actual content (VERY IMPORTANT)
      await page.waitForFunction(() => {
        return document.body && document.body.innerText.length > 500;
      }, { timeout: 60000 });

      await page.waitForTimeout(3000);

      // scroll to load lazy content
      await autoScroll(page);

      const data = await page.evaluate(() => {
        const getText = el => el.innerText?.trim();

        return {
          title: document.title,
          url: location.href,

          links: [...document.querySelectorAll("a")]
            .map(a => a.href)
            .filter(Boolean),

          buttons: [...document.querySelectorAll("button")]
            .map(b => b.innerText.trim())
            .filter(Boolean),

          inputs: [...document.querySelectorAll("input, textarea, select")]
            .map(i => ({
              name: i.name || "",
              type: i.type || i.tagName,
              placeholder: i.placeholder || ""
            })),

          forms: [...document.querySelectorAll("form")]
            .map(f => ({
              action: f.action,
              method: f.method
            })),

          textBlocks: [...document.querySelectorAll("p, h1, h2, h3, span")]
            .map(el => getText(el))
            .filter(t => t && t.length > 30),

          emails: Array.from(document.body.innerText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))
            .map(e => e[0]),

          phones: Array.from(document.body.innerText.matchAll(/(\+91[\s-]?\d{10}|\d{10})/g))
            .map(p => p[0]),

          meta: {
            description: document.querySelector('meta[name="description"]')?.content || "",
            keywords: document.querySelector('meta[name="keywords"]')?.content || ""
          }
        };
      });

      results.push(data);

      // add new internal links
      data.links.forEach(link => {
        if (
          link.startsWith("https://echospaces.in") &&
          !visited.has(link)
        ) {
          queue.push(link);
        }
      });

    } catch (err) {
      console.log("❌ Failed:", url);
      console.log(err.message);
    }
  }

  // FULL SITE CRAWL
  while (queue.length > 0 && visited.size < 100) {
    const next = queue.shift();
    await scrape(next);
  }

  const DB = {
    totalPages: results.length,
    pages: results
  };

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  console.log("✅ DONE. Pages scraped:", results.length);

  await browser.close();
})();


// 🔥 SCROLL FUNCTION
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;

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
