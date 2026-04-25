const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();

  // 🔥 Anti-timeout + stability
  page.setDefaultNavigationTimeout(0);
  page.setDefaultTimeout(0);

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  let DB = {
    locations: []
  };

  console.log("Opening site...");

  await page.goto("https://echospaces.in", {
    waitUntil: "domcontentloaded",
    timeout: 0
  });

  await page.waitForTimeout(5000);

  // 🔥 STEP 1: FIND LOCATION PAGE
  console.log("Finding location page...");

  const locationLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a"));
    const match = links.find(a =>
      a.innerText.toLowerCase().includes("location")
    );
    return match ? match.href : null;
  });

  if (locationLink) {
    console.log("Navigating to:", locationLink);

    await page.goto(locationLink, {
      waitUntil: "domcontentloaded",
      timeout: 0
    });

    await page.waitForTimeout(5000);
  } else {
    console.log("Location page not found, staying on homepage.");
  }

  // 🔥 STEP 2: SCROLL
  await autoScroll(page);

  // 🔥 STEP 3: EXTRACT DATA
  console.log("Extracting location data...");

  const extractData = async () => {
    return await page.evaluate(() => {
      let results = [];

      document.querySelectorAll("div").forEach(el => {
        const text = el.innerText?.trim();

        if (
          text &&
          text.toLowerCase().includes("price") &&
          text.length < 600
        ) {
          const lines = text
            .split("\n")
            .map(l => l.trim())
            .filter(Boolean);

          results.push({
            raw: text,
            lines
          });
        }
      });

      return results;
    });
  };

  DB.locations.push(...await extractData());

  // 🔥 STEP 4: PAGINATION LOOP
  console.log("Checking pagination...");

  let safety = 0;

  while (safety < 10) {
    try {
      const nextBtn = await page.locator("text=Next").first();

      if (await nextBtn.count()) {
        console.log("Going to next page...");

        await Promise.all([
          page.waitForLoadState("domcontentloaded"),
          nextBtn.click()
        ]);

        await page.waitForTimeout(4000);
        await autoScroll(page);

        const nextData = await extractData();
        DB.locations.push(...nextData);

        safety++;
      } else {
        break;
      }
    } catch (e) {
      console.log("Pagination ended.");
      break;
    }
  }

  // 🔥 CLEAN DUPLICATES
  DB.locations = Array.from(
    new Map(DB.locations.map(i => [i.raw, i])).values()
  );

  // 🔥 SAVE FILE
  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  console.log(`DONE — ${DB.locations.length} entries saved.`);

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
