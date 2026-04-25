const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox"]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  });

  const page = await context.newPage();

  let DB = {
    locations: []
  };

  console.log("Opening site...");

  await page.goto("https://echospaces.in", {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });

  await page.waitForTimeout(5000);

  // 🔥 STEP 1: FIND LOCATION PAGE
  console.log("Finding location page...");

  const links = await page.$$eval('a', as =>
    as.map(a => ({
      href: a.href,
      text: a.innerText.toLowerCase()
    }))
  );

  const locationLink = links.find(l =>
    l.text.includes("location")
  );

  if (locationLink) {
    console.log("Opening location page:", locationLink.href);
    await page.goto(locationLink.href, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });
  } else {
    console.log("Location link not found — continuing homepage scrape");
  }

  await page.waitForTimeout(5000);

  // 🔥 SCROLL
  await autoScroll(page);

  // 🔥 EXTRACT DATA
  console.log("Extracting data...");

  const data = await page.evaluate(() => {
    let results = [];

    document.querySelectorAll("div").forEach(el => {
      const text = el.innerText;

      if (
        text &&
        text.toLowerCase().includes("price")
      ) {
        results.push({
          text: text.trim()
        });
      }
    });

    return results;
  });

  DB.locations.push(...data);

  // 🔥 SAVE
  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("DONE");
})();

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      let distance = 400;

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
