const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox"]
  });

  const page = await browser.newPage();

  let DB = {
    locations: []
  };

  console.log("Opening site...");
  await page.goto("https://echospaces.in", { timeout: 60000 });

  await page.waitForTimeout(4000);

  // 🔥 STEP 1: GO TO LOCATION PAGE
  console.log("Navigating to location page...");

  const links = await page.$$eval('a', as =>
    as.map(a => ({ href: a.href, text: a.innerText }))
  );

  const locationLink = links.find(l =>
    l.text.toLowerCase().includes("location")
  );

  if (locationLink) {
    await page.goto(locationLink.href);
  }

  await page.waitForTimeout(5000);

  // 🔥 STEP 2: SCROLL FULL PAGE
  await autoScroll(page);

  // 🔥 STEP 3: EXTRACT LOCATION CARDS
  console.log("Extracting location data...");

  const data = await page.evaluate(() => {
    let results = [];

    document.querySelectorAll("div").forEach(el => {
      const text = el.innerText;

      if (
        text &&
        text.includes("Prices") &&
        text.length < 500
      ) {
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

        results.push({
          raw: text,
          lines: lines
        });
      }
    });

    return results;
  });

  DB.locations.push(...data);

  // 🔥 STEP 4: PAGINATION (TRY CLICK NEXT)
  let hasNext = true;

  while (hasNext) {
    try {
      const nextBtn = await page.$("a:has-text('Next'), button:has-text('Next')");

      if (nextBtn) {
        console.log("Going to next page...");
        await nextBtn.click();
        await page.waitForTimeout(4000);
        await autoScroll(page);

        const nextData = await page.evaluate(() => {
          let results = [];

          document.querySelectorAll("div").forEach(el => {
            const text = el.innerText;

            if (
              text &&
              text.includes("Prices") &&
              text.length < 500
            ) {
              results.push(text);
            }
          });

          return results;
        });

        DB.locations.push(...nextData);

      } else {
        hasNext = false;
      }
    } catch {
      hasNext = false;
    }
  }

  // 🔥 SAVE DATA
  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  await browser.close();

  console.log("DONE — locations extracted.");
})();

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
