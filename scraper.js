const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://echospaces.in';
const MAX_PAGES = 100;
const NAVIGATION_TIMEOUT = 60000;
const PAGE_GOTO_OPTIONS = { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT };

const visited = new Set();
const queue = [BASE_URL];
const pagesData = [];
const graph = [];
let pageCount = 0;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function isInternal(url) {
  try {
    return new URL(url).hostname === new URL(BASE_URL).hostname;
  } catch {
    return false;
  }
}

function extractEmails(text) {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(regex);
  return matches ? [...new Set(matches.map(e => e.toLowerCase()))] : [];
}

function extractPhones(text) {
  const regex = /(?:\+91[-\s]?|0)?[6789]\d{9}|\+?\d{1,3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4}/g;
  const matches = text.match(regex);
  return matches ? [...new Set(matches.map(p => p.replace(/\s+/g, '')))] : [];
}

const SOCIAL_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'pinterest.com', 'tiktok.com', 'snapchat.com', 'reddit.com',
  'whatsapp.com', 'wa.me', 'telegram.org', 't.me', 'discord.gg', 'discord.com'
];

function isSocialLink(link) {
  try {
    const host = new URL(link.href).hostname.toLowerCase();
    return SOCIAL_DOMAINS.some(d => host.includes(d));
  } catch {
    return false;
  }
}

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
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
}

async function clickElements(page, selectors) {
  for (const sel of selectors) {
    try {
      const elems = page.locator(sel);
      const count = await elems.count();
      for (let i = 0; i < count && i < 3; i++) {
        const el = elems.nth(i);
        if (await el.isVisible({ timeout: 1000 })) {
          await el.click({ timeout: 2000 });
          await page.waitForTimeout(800);
        }
      }
    } catch {}
  }
}

async function handleInteractions(page) {
  const loadMoreSelectors = [
    'button:has-text("View More")',
    'button:has-text("Load More")',
    'button:has-text("Show More")',
    'a:has-text("View More")',
    'a:has-text("Load More")',
    '[role="button"]:has-text("More")',
    '.load-more', '.show-more', '.view-more'
  ];
  await clickElements(page, loadMoreSelectors);

  const formTriggers = [
    'button:has-text("Get Quote")',
    'button:has-text("Contact")',
    'a:has-text("Get Quote")',
    'a:has-text("Enquire Now")'
  ];
  for (const sel of formTriggers) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
      }
    } catch {}
  }
}

async function extractPageData(page) {
  const data = await page.evaluate(() => {
    const clean = t => t?.trim().replace(/\s+/g, ' ') || '';

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ text: clean(a.textContent).substring(0, 200), href: a.href }))
      .filter(l => l.href && l.href.startsWith('http'));

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
      .map(b => clean(b.textContent || b.value))
      .filter(Boolean);

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      .map(el => ({
        name: el.name || '',
        type: el.type || el.tagName.toLowerCase(),
        placeholder: el.placeholder || ''
      }));

    const forms = Array.from(document.querySelectorAll('form'))
      .map(f => ({
        action: f.action || '',
        method: (f.method || 'get').toLowerCase()
      }));

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .map(el => clean(el.textContent))
      .filter(t => t.length > 5);

    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map(el => clean(el.textContent))
      .filter(t => t.length > 30);

    const listItems = Array.from(document.querySelectorAll('li'))
      .map(el => clean(el.textContent))
      .filter(t => t.length > 20);

    const divTexts = Array.from(document.querySelectorAll('div, section, article, main, aside, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.textContent))
      .filter(t => t.length > 40);

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

  const pageText = [data.title, ...data.textBlocks, ...data.buttons,
    ...data.inputs.map(i => `${i.name} ${i.placeholder}`),
    data.meta.description, data.meta.keywords].join(' ');

  data.emails = extractEmails(pageText);
  data.phoneNumbers = extractPhones(pageText);
  data.socialLinks = data.links.filter(isSocialLink).map(l => ({ text: l.text, href: l.href }));

  data.textBlocks = data.textBlocks.filter(t => t.length > 30);
  return data;
}

async function crawlPage(browser, url, fromUrl) {
  const normalized = normalizeUrl(url);
  if (visited.has(normalized)) return;
  if (!isInternal(url)) return;
  if (pageCount >= MAX_PAGES) return;

  visited.add(normalized);
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
    await page.goto(url, PAGE_GOTO_OPTIONS);
    await page.waitForTimeout(2000);
    await autoScroll(page);
    await handleInteractions(page);
    await page.waitForTimeout(500);
    await autoScroll(page);

    const data = await extractPageData(page);
    pagesData.push(data);

    if (fromUrl) {
      graph.push({ from: fromUrl, to: url });
    }

    for (const link of data.links) {
      if (isInternal(link.href)) {
        const norm = normalizeUrl(link.href);
        if (!visited.has(norm) && queue.length < MAX_PAGES * 3) {
          queue.push(link.href);
        }
      }
    }
  } catch (err) {
    console.error(`Error on ${url}: ${err.message}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    await crawlPage(browser, BASE_URL, null);

    while (queue.length > 0 && pageCount < MAX_PAGES) {
      const nextUrl = queue.shift();
      const norm = normalizeUrl(nextUrl);
      if (!visited.has(norm) && isInternal(nextUrl)) {
        await crawlPage(browser, nextUrl, null);
      }
    }
  } finally {
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
    console.log(`\nDone. ${pagesData.length} pages saved to db.json`);
    await browser.close();
  }
})();
