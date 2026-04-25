const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let DB = [];

  console.log("🚀 Starting API capture...");

  // 🔥 CAPTURE ALL NETWORK RESPONSES
  page.on('response', async (response) => {
    try {
      const url = response.url();

      // filter useful APIs only
      if (
        url.includes("api") ||
        url.includes("location") ||
        url.includes("search") ||
        url.includes("data")
      ) {
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("application/json")) {
          const json = await response.json();

          console.log("📡 API HIT:", url);

          DB.push({
            url,
            data: json
          });
        }
      }

    } catch (e) {}
  });

  await page.goto("https://echospaces.in", {
    waitUntil: "networkidle",
    timeout: 60000
  });

  // wait for all lazy loads
  await page.waitForTimeout(8000);

  // simulate interaction
  try {
    const buttons = await page.$$("button");
    for (const btn of buttons.slice(0, 5)) {
      try {
        await btn.click();
        await page.waitForTimeout(2000);
      } catch {}
    }
  } catch {}

  // scroll
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

  await page.waitForTimeout(5000);

  fs.writeFileSync("db.json", JSON.stringify(DB, null, 2));

  console.log("✅ DONE. APIs captured:", DB.length);

  await browser.close();
})();
