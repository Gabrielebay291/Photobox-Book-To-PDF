import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

/**
 * Given a Photobox "voir-livre-en-ligne" URL (or a direct widgetviewer URL),
 * load the online book viewer in a headless browser, let it preload every page,
 * and return the ordered list of page image descriptors with signed source URLs.
 *
 * The viewer renders each book page from a single flat JPEG served from S3
 * (HPage_front, HPage_001 ... HPage_NNN, HPage_back). Those flat images ARE the
 * page artwork; grabbing them directly is lossless and pixel-perfect, far better
 * than screenshotting the viewport (which upscales the same 1024px source).
 */

// Map a Photobox TLD to the viewer locale it normally uses. The locale only
// affects the viewer's own chrome text (not the page images), so any value works;
// this just keeps things tidy. Unknown TLDs fall back to en-GB.
const LOCALE_BY_TLD = {
  fr: 'fr-FR', com: 'en-GB', 'co.uk': 'en-GB', ie: 'en-IE', de: 'de-DE',
  at: 'de-AT', es: 'es-ES', it: 'it-IT', nl: 'nl-NL', be: 'fr-BE',
  dk: 'da-DK', se: 'sv-SE', no: 'nb-NO', pt: 'pt-PT',
};

function localeForHost(hostname) {
  const m = hostname.match(/photobox\.(co\.uk|com|[a-z]{2,3})$/i);
  return (m && LOCALE_BY_TLD[m[1].toLowerCase()]) || 'en-GB';
}

/**
 * Accepts any Photobox "view book online" link (photobox.fr, .com, .co.uk, .de,
 * .es, .it, .nl, .be, … — the TLD and page path don't matter) or a direct
 * widgetviewer.photoconnector.net URL, and returns the direct viewer URL.
 */
function buildWidgetUrl(inputUrl) {
  const u = new URL(inputUrl);
  // Already the direct viewer?
  if (u.hostname.includes('photoconnector.net')) return inputUrl;
  const widgetId = u.searchParams.get('widgetId');
  const securityId = u.searchParams.get('securityId');
  if (!widgetId || !securityId) {
    throw new Error(
      'That does not look like a Photobox book link. The URL must contain ' +
      'widgetId and securityId parameters (e.g. photobox.fr/…?widgetId=…&securityId=…).'
    );
  }
  const locale = u.searchParams.get('locale') || localeForHost(u.hostname);
  return `https://widgetviewer.photoconnector.net/?widgetId=${widgetId}&securityId=${securityId}&locale=${locale}`;
}

/** Sort key so front < 001 < 002 ... < back. */
function orderKey(name) {
  if (/front/i.test(name)) return -1;
  if (/back/i.test(name)) return Number.MAX_SAFE_INTEGER;
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export async function extractPages(inputUrl, { log = () => {} } = {}) {
  const viewerUrl = buildWidgetUrl(inputUrl);
  log(`Opening viewer: ${viewerUrl}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

    // Track the highest-resolution signed URL seen for each page file.
    const seen = new Map(); // fileName -> { url, w, h }
    const noteUrl = (url) => {
      const m = url.match(/\/widgets\/[^/]+\/([A-Za-z0-9_]+\.jpe?g)/i);
      if (!m) return;
      const file = m[1];
      if (!seen.has(file)) seen.set(file, { url });
      else seen.get(file).url = url; // keep freshest signed URL
    };

    page.on('request', (r) => noteUrl(r.url()));

    await page.goto(viewerUrl, { waitUntil: 'networkidle', timeout: 90000 });

    // Give the viewer time to enumerate and preload every page image.
    await page.waitForFunction(
      () => document.querySelectorAll('img.img, img[src*="HPage"]').length > 1,
      { timeout: 60000 }
    ).catch(() => {});
    await page.waitForTimeout(4000);

    // Pull the actual <img> elements too (authoritative source + natural size).
    const domImgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img')]
        .map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }))
        .filter((i) => /HPage_/i.test(i.src));
    });
    for (const i of domImgs) {
      const m = i.src.match(/\/widgets\/[^/]+\/([A-Za-z0-9_]+\.jpe?g)/i);
      if (!m) continue;
      const rec = seen.get(m[1]) || {};
      rec.url = i.src;
      if (i.w) rec.w = i.w;
      if (i.h) rec.h = i.h;
      seen.set(m[1], rec);
    }

    const pages = [...seen.entries()]
      .map(([file, rec]) => ({ file, ...rec }))
      .sort((a, b) => orderKey(a.file) - orderKey(b.file));

    log(`Found ${pages.length} page images.`);
    return pages;
  } finally {
    await browser.close();
  }
}

// CLI smoke test
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  const pages = await extractPages(url, { log: (m) => console.log('[extract]', m) });
  for (const p of pages) console.log(p.file, p.w + 'x' + p.h, p.url.slice(0, 90));
}
