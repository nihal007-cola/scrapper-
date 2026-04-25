const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://echospaces.in';
const MAX_PAGES = 100;
const NAV_TIMEOUT = 60000;
const DELAY_AFTER_LOAD = 2000;

const visited = new Set();
const queue = [BASE_URL];
const pagesData = [];
const graph = [];
let pageCount = 0;

// ---- Helpers ----

function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch { return url; }
}

function isInternal(url) {
  try { return new URL(url).hostname === new URL(BASE_URL).hostname; }
  catch { return false; }
}

function extractEmails(text) {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const m = text.match(re);
  return m ? [...new Set(m.map(e => e.toLowerCase()))] : [];
}

function extractPhones(text) {
  const re = /(?:\+91[-\s]?|0)?[6789]\d{9}|\+?\d{1,3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4}/g;
  const m = text.match(re);
  return m ? [...new Set(m.map(p => p.replace(/\s+/g, '')))] : [];
}

const SOCIAL_HOSTS = [
  'facebook.com','twitter.com','x.com','instagram.com','linkedin.com',
  'youtube.com','pinterest.com','snapchat.com','reddit.com',
  'whatsapp.com','wa.me','telegram.org','t.me','discord.gg','discord.com'
];
function isSocial(link) {
  try {
    const host = new URL(link.href).hostname.toLowerCase();
    return SOCIAL_HOSTS.some(h => host.includes(h));
  } catch { return false; }
}

// ---- Page interactions ----

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const dist = 250;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function clickSelectors(page, selectors) {
  for (const sel of selectors) {
    try {
      const elems = page.locator(sel);
      const count = await elems.count();
      for (let i = 0; i < count && i < 4; i++) {
        const el = elems.nth(i);
        if (await el.isVisible({ timeout: 800 })) {
          await el.click({ timeout: 1500 });
          await page.waitForTimeout(600);
        }
      }
    } catch { /* skip */ }
  }
}

async function handleInteractions(page) {
  // Click dynamic loaders
  await clickSelectors(page, [
    'button:has-text("View More")',
    'button:has-text("Load More")',
    'button:has-text("Show More")',
    'a:has-text("View More")',
    'a:has-text("Load More")',
    '.load-more', '.show-more',
    '[data-action="load-more"]',
  ]);

  // Try to open any hidden popups then close
  try {
    const quoteBtn = page.locator('button:has-text("Get Quote"), a:has-text("Get Quote")').first();
    if (await quoteBtn.isVisible({ timeout: 1000 })) {
      await quoteBtn.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
    }
  } catch {}
}

// ---- Data extraction ----

async function extractPageData(page) {
  const raw = await page.evaluate(() => {
    const clean = t => t?.trim().replace(/\s+/g, ' ') || '';

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ text: clean(a.textContent).slice(0,200), href: a.href }))
      .filter(l => l.href && l.href.startsWith('http'));

    const buttons = Array.from(document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"]'
    )).map(b => clean(b.textContent || b.value)).filter(Boolean);

    const inputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]), textarea, select'
    )).map(el => ({
      name: el.name || '',
      type: el.type || el.tagName.toLowerCase(),
      placeholder: el.placeholder || ''
    }));

    const forms = Array.from(document.querySelectorAll('form'))
      .map(f => ({
        action: f.action || '',
        method: (f.method || 'get').toLowerCase()
      }));

    // Visible text blocks
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .map(el => clean(el.textContent)).filter(t => t.length > 5);
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map(el => clean(el.textContent)).filter(t => t.length > 30);
    const listItems = Array.from(document.querySelectorAll('li'))
      .map(el => clean(el.textContent)).filter(t => t.length > 20);
    const divTexts = Array.from(document.querySelectorAll(
      'div, section, article, main, aside, span'
    )).filter(el => el.children.length === 0)
      .map(el => clean(el.textContent)).filter(t => t.length > 40);

    const allText = [...new Set([...headings, ...paragraphs, ...listItems, ...divTexts])]
      .filter(t => t.length > 30 && !t.startsWith('©') && !t.includes('function('));

    const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
    const metaKeys = document.querySelector('meta[name="keywords"]')?.content || '';

    return {
      title: document.title,
      url: window.location.href,
      links,
      buttons: [...new Set(buttons)],
      inputs,
      forms,
      textBlocks: allText,
      scripts,
      meta: { description: clean(metaDesc), keywords: clean(metaKeys) }
    };
  });

  // Add extracted emails/phones/social
  const allText = [
    raw.title,
    ...raw.textBlocks,
    ...raw.buttons,
    ...raw.inputs.map(i => `${i.name} ${i.placeholder}`),
    raw.meta.description,
    raw.meta.keywords
  ].join(' ');

  raw.emails = extractEmails(allText);
  raw.phoneNumbers = extractPhones(allText);
  raw.socialLinks = raw.links.filter(isSocial).map(l => ({ text: l.text, href: l.href }));

  return raw;
}

// ---- Page crawling ----

async function crawlPage(browser, url, fromUrl) {
  const norm = normalize(url);
  if (visited.has(norm)) return;
  if (!isInternal(url)) return;
  if (pageCount >= MAX_PAGES) return;

  visited.add(norm);
  pageCount++;

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  try {
    console.log(`[${pageCount}/${MAX_PAGES}] ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForTimeout(DELAY_AFTER_LOAD);

    await autoScroll(page);
    await handleInteractions(page);
    await page.waitForTimeout(1000);
    await autoScroll(page); // second scroll after lazy content

    const data = await extractPageData(page);
    pagesData.push(data);

    if (fromUrl) graph.push({ from: fromUrl, to: url });

    // Enqueue new internal links
    for (const link of data.links) {
      if (isInternal(link.href)) {
        const n = normalize(link.href);
        if (!visited.has(n) && queue.length < MAX_PAGES * 3) {
          queue.push(link.href);
        }
      }
    }
  } catch (err) {
    console.error(`✕ Failed: ${url} - ${err.message}`);
  } finally {
    await context.close();
  }
}

// ---- Main ----

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });

  try {
    // Start with homepage
    await crawlPage(browser, BASE_URL, null);

    while (queue.length > 0 && pageCount < MAX_PAGES) {
      const next = queue.shift();
      const n = normalize(next);
      if (!visited.has(n) && isInternal(next)) {
        await crawlPage(browser, next, null);
      }
    }
  } catch (e) {
    console.error('Global error:', e);
  } finally {
    // Save results
    const allEmails = [...new Set(pagesData.flatMap(p => p.emails))];
    const allPhones = [...new Set(pagesData.flatMap(p => p.phoneNumbers))];
    const allSocial = [...new Set(pagesData.flatMap(p => p.socialLinks.map(s => s.href)))];

    const output = {
      baseUrl: BASE_URL,
      crawledAt: new Date().toISOString(),
      totalPages: pagesData.length,
      pages: pagesData,
      graph: graph,
      summary: {
        totalEmails: allEmails,
        totalPhones: allPhones,
        totalSocialLinks: allSocial,
        allPages: pagesData.map(p => p.url)
      }
    };

    fs.writeFileSync('db.json', JSON.stringify(output, null, 2));
    console.log(`\n✅ Done. ${pagesData.length} pages saved to db.json`);
    await browser.close();
  }
})();
