const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let allData = [];
  let visited = new Set();
  let queue = ["https://echospaces.in"];

  while (queue.length > 0) {
    const url = queue.shift();

    if (visited.has(url)) continue;
    visited.add(url);

    console.log("Visiting:", url);

    try {
      await page.goto(url, { timeout: 60000 });

      await autoScroll(page);

      const data = await page.evaluate(() => {
        let blocks = [];

        document.querySelectorAll("div").forEach(el => {
          let text = el.innerText;

          if (text && text.length > 50 && text.length < 800) {
            blocks.push(text);
          }
        });

        return blocks;
      });

      allData.push({ url, data });

      const links = await page.$$eval('a', as =>
        as.map(a => a.href).filter(h => h.includes("echospaces.in"))
      );

      links.forEach(link => {
        if (!visited.has(link)) queue.push(link);
      });

    } catch (err) {
      console.log("Error:", err.message);
    }
  }

  fs.writeFileSync("db.json", JSON.stringify(allData, null, 2));

  await browser.close();
})();

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      let distance = 300;

      let timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;

        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}
