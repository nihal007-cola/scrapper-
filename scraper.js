const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  console.log("Opening site...");
  await page.goto("https://echospaces.in", {
    waitUntil: "networkidle2",
    timeout: 0
  });

  // wait for UI to load
  await new Promise(r => setTimeout(r, 5000));

  console.log("Extracting data...");

  const data = await page.evaluate(() => {
    const results = [];

    // grab ALL visible text blocks
    document.querySelectorAll("body *").forEach(el => {
      const text = el.innerText?.trim();

      if (
        text &&
        text.length > 20 &&
        text.length < 300
      ) {
        results.push(text);
      }
    });

    return [...new Set(results)];
  });

  console.log("Saving...");
  fs.writeFileSync("db.json", JSON.stringify(data, null, 2));

  await browser.close();
})();
