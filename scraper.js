const { chromium } = require('playwright');
const fs = require('fs');

const BASE = "https://echospaces.in";
const MAX_PAGES = 80;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    viewport: { width: 1366, height: 768 }
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

  console.log("🚀 STARTING FULL SITE SCRAPER");

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift();

    if (visited.has(url)) continue;
    visited.add(url);

    try {
      console.log("\n🌐 Visiting:", url);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(3000);

      await autoScroll(page);

      await handleInteractions(page);

      const html = await page.content();
      console.log("📄 Page length:", html.length);

      const data = await page.evaluate(() => {
        const clean = (t) => t?.trim().replace(/\s+/g, " ") || "";

        const getEmails = (text) =>
          [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [])];

        const getPhones = (text) =>
          [...new Set(text.match(/\+?\d[\d\s-]{8,}/g) || [])];

        const textContent = document.body.innerText;

        const links = Array.from(document.querySelectorAll("a"))
          .map(a => ({
            text: clean(a.innerText),
            href: a.href
          }))
          .filter(l => l.href);

        const buttons = Array.from(document.querySelectorAll("button, a.btn"))
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
          .filter(t => t.length > 40 && t.length < 800);

        const metaDescription =
          document.querySelector('meta[name="description"]')?.content || "";

        const metaKeywords =
          document.querySelector('meta[name="keywords"]')?.content || "";

        return {
          title: document.title,
          url: window.location.href,
          links,
          buttons,
          inputs,
          forms,
          textBlocks,
          emails: getEmails(textContent),
          phones: getPhones(textContent),
          meta: {
            description: metaDescription,
            keywords: metaKeywords
          }
        };
      });

      DB.push(data);

      // enqueue internal links
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

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  console.log("\n✅ DONE — Total pages scraped:", DB.length);

  await browser.close();
})();


// 🔥 scroll full page
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


// 🔥 simulate basic user actions
async function handleInteractions(page) {
  try {
    const buttons = await page.$$("button");

    for (const btn of buttons.slice(0, 5)) {
      try {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(800);
      } catch {}
    }

    const selects = await page.$$("select");

    for (const select of selects) {
      try {
        const options = await select.$$("option");
        if (options.length > 1) {
          const value = await options[1].getAttribute("value");
          if (value) {
            await select.selectOption(value);
            await page.waitForTimeout(1000);
          }
        }
      } catch {}
    }

  } catch {}
}
