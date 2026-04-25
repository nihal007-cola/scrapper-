const { chromium } = require('playwright');
const fs = require('fs');

const BASE = "https://echospaces.in";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();

  // 🔥 Hide automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });
  });

  let DB = [];

  try {
    console.log("Opening site...");

    await page.goto(BASE, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // 🔥 simulate human behavior
    await page.mouse.move(100, 100);
    await page.waitForTimeout(2000);
    await page.mouse.move(300, 300);
    await page.waitForTimeout(2000);

    await autoScroll(page);

    // 🔥 DEBUG
    const html = await page.content();
    console.log("PAGE LENGTH:", html.length);

    const data = await page.evaluate(() => {
      const clean = (t) => t?.trim().replace(/\s+/g, " ") || "";

      const links = Array.from(document.querySelectorAll("a"))
        .map(a => ({
          text: clean(a.innerText),
          href: a.href
        }));

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

      const textBlocks = Array.from(document.querySelectorAll("h1,h2,h3,p,span"))
        .map(el => clean(el.innerText))
        .filter(t => t.length > 20);

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

  } catch (err) {
    console.log("ERROR:", err.message);
  }

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("DONE");
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
