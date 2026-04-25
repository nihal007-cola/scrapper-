const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://echospaces.in';
const MAX_PAGES = 100;
const NAVIGATION_TIMEOUT = 60000;
const DELAY_BETWEEN_PAGES = 1500;
const SCROLL_STEP = 300;
const SCROLL_DELAY = 150;

const PHONE_REGEX = /(?:\+91[-\s]?|0)?[6789]\d{9}|\+?\d{1,3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SOCIAL_DOMAINS = [
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'pinterest.com', 'tiktok.com', 'snapchat.com', 'reddit.com',
  'whatsapp.com', 'wa.me', 'telegram.org', 't.me', 'discord.gg', 'discord.com'
];

const visited = new Set();
const queue = [BASE_URL];
const results = [];
const graph = [];
let pageCount = 0;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.sort();
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function isInternal(url) {
  try {
    const u = new URL(url);
    return u.hostname === new URL(BASE_URL).hostname;
  } catch {
    return false;
  }
}

function extractEmails(text) {
  const matches = text.match(EMAIL_REGEX);
  return matches ? [...new Set(matches.map(e => e.toLowerCase()))] : [];
}

function extractPhones(text) {
  const matches = text.match(PHONE_REGEX);
  return matches ? [...new Set(matches.map(p => p.replace(/\s+/g, '')))] : [];
}

function extractSocialLinks(links) {
  return links.filter(link => {
    try {
      const hostname = new URL(link.href).hostname.toLowerCase();
      return SOCIAL_DOMAINS.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }).map(l => ({ text: l.text, href: l.href }));
}

function cleanText(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

function isMeaningfulText(text) {
  const cleaned = cleanText(text);
  if (cleaned.length < 25) return false;
  const garbagePatterns = [
    /^[\s\W]+$/, /^cookie/i, /^accept/i, /^subscribe/i,
    /^loading/i, /^please wait/i, /^all rights reserved/i,
    /^\d{4}\s*©/i, /^privacy policy$/i, /^terms of service$/i
  ];
  return !garbagePatterns.some(p => p.test(cleaned));
}

async function autoScroll(page) {
  await page.evaluate(async (step, delay) => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = step;
      const timer = setInterval(() => {
        let scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  }, SCROLL_STEP, SCROLL_DELAY);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function handleInteractions(page) {
  const clickableSelectors = [
    'button:has-text("View More")',
    'button:has-text("Load More")',
    'button:has-text("Show More")',
    'button:has-text("Expand")',
    'a:has-text("View More")',
    'a:has-text("Load More")',
    'a:has-text("Next")',
    '[role="button"]:has-text("More")',
    '.load-more', '.show-more', '.view-more',
    '[data-action="load-more"]', '[data-action="expand"]'
  ];

  for (const selector of clickableSelectors) {
    try {
      const elements = page.locator(selector);
      const count = await elements.count();
      for (let i = 0; i < count && i < 3; i++) {
        try {
          const el = elements.nth(i);
          if (await el.isVisible({ timeout: 1000 })) {
            await el.click({ timeout: 2000 });
            await page.waitForTimeout(1000);
          }
        } catch {}
      }
    } catch {}
  }

  const formTriggers = [
    'button:has-text("Get Quote")',
    'button:has-text("Contact")',
    'button:has-text("Enquire")',
    'a:has-text("Get Quote")',
    'a:has-text("Enquire Now")'
  ];

  for (const selector of formTriggers) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
      }
    } catch {}
  }
}

async function extractData(page) {
  await page.waitForTimeout(500);

  const data = await page.evaluate((socialDomains) => {
    const clean = (t) => t?.trim().replace(/\s+/g, ' ') || '';

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({
        text: clean(a.textContent).substring(0, 200),
        href: a.href
      }))
      .filter(l => l.href && l.href.startsWith('http'));

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'))
      .map(b => clean(b.textContent || b.value))
      .filter(t => t.length > 0 && t.length < 200);

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      .map(i => ({
        name: i.name || '',
        type: i.type || i.tagName.toLowerCase(),
        placeholder: i.placeholder || '',
        label: ''
      }));

    const forms = Array.from(document.querySelectorAll('form'))
      .map(f => ({
        action: f.action || '',
        method: (f.method || 'get').toLowerCase(),
        id: f.id || '',
        className: f.className || ''
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

    const divText = Array.from(document.querySelectorAll('div, section, article, main, aside, span'))
      .map(el => {
        if (el.children.length === 0) {
          return clean(el.textContent);
        }
        return '';
      })
      .filter(t => t.length > 40);

    const allVisibleText = [...new Set([...headings, ...paragraphs, ...listItems, ...divText])]
      .filter(t => t.length > 30)
      .filter(t => !t.startsWith('©') && !t.includes('function('));

    const scripts = Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.src);

    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
    const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';

    return {
      title: document.title,
      url: window.location.href,
      links,
      buttons: [...new Set(buttons)],
      inputs,
      forms,
      textBlocks: allVisibleText,
      scripts,
      meta: {
        description: clean(metaDescription),
        keywords: clean(metaKeywords)
      }
    };
  }, SOCIAL_DOMAINS);

  const pageText = [
    data.title,
    ...data.textBlocks,
    ...data.buttons,
    ...data.inputs.map(i => `${i.name} ${i.placeholder}`),
    data.meta.description,
    data.meta.keywords
  ].join(' ');

  data.emails = extractEmails(pageText);
  data.phoneNumbers = extractPhones(pageText);
  data.socialLinks = extractSocialLinks(data.links);

  data.textBlocks = data.textBlocks.filter(isMeaningfulText);

  return data;
}

async function crawlPage(browser, currentUrl, fromUrl) {
  if (visited.has(normalizeUrl(currentUrl))) return;
  if (pageCount >= MAX_PAGES) return;
  if (!isInternal(currentUrl)) return;

  visited.add(normalizeUrl(currentUrl));
  pageCount++;

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  try {
    console.log(`[${pageCount}/${MAX_PAGES}] Visiting: ${currentUrl}`);

    await page.goto(currentUrl, {
      waitUntil: 'networkidle',
      timeout: NAVIGATION_TIMEOUT
    });

    await page.waitForTimeout(DELAY_BETWEEN_PAGES);
    await autoScroll(page);
    await handleInteractions(page);
    await page.waitForTimeout(1000);
    await autoScroll(page);

    const data = await extractData(page);
    results.push(data);

    if (fromUrl) {
      graph.push({
        from: fromUrl,
        to: currentUrl
      });
    }

    for (const link of data.links) {
      if (isInternal(link.href)) {
        const normalized = normalizeUrl(link.href);
        if (!visited.has(normalized) && queue.length + visited.size < MAX_PAGES * 2) {
          queue.push(link.href);
        }
      }
    }

  } catch (error) {
    console.error(`Failed: ${currentUrl} - ${error.message}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    await crawlPage(browser, BASE_URL, null);

    while (queue.length > 0 && pageCount < MAX_PAGES) {
      const nextUrl = queue.shift();
      const normalized = normalizeUrl(nextUrl);

      if (!visited.has(normalized) && isInternal(nextUrl)) {
        await crawlPage(browser, nextUrl, null);
      }
    }
  } catch (error) {
    console.error('Crawler error:', error.message);
  } finally {
    const output = {
      baseUrl: BASE_URL,
      crawledAt: new Date().toISOString(),
      totalPages: results.length,
      pages: results,
      graph: graph,
      summary: {
        totalEmails: [...new Set(results.flatMap(r => r.emails))],
        totalPhones: [...new Set(results.flatMap(r => r.phoneNumbers))],
        totalSocialLinks: [...new Set(results.flatMap(r => r.socialLinks.map(s => s.href)))],
        allPages: results.map(r => r.url)
      }
    };

    fs.writeFileSync('db.json', JSON.stringify(output, null, 2));
    console.log(`\nDone. ${results.length} pages crawled. Output saved to db.json`);
    await browser.close();
  }
})();
