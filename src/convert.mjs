import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractPages } from './extract.mjs';
import { downloadPages, buildPdf } from './build.mjs';

/**
 * Full pipeline: Photobox book URL -> high-res page JPGs + assembled PDF.
 * Returns { pdfPath, jpgDir, pages }.
 */
export async function convertBook(url, { outDir, log = () => {}, widthCm = 28 } = {}) {
  outDir = outDir || path.join(process.cwd(), 'output');
  await fs.mkdir(outDir, { recursive: true });

  log('Step 1/3 — Opening book in headless browser and extracting pages…');
  const pages = await extractPages(url, { log });
  if (!pages.length) throw new Error('No book pages found. Is the URL correct and public?');

  log(`Step 2/3 — Downloading ${pages.length} high-resolution page images…`);
  const downloaded = await downloadPages(pages, outDir, { log });

  log('Step 3/3 — Building PDF book…');
  const pdfPath = path.join(outDir, 'book.pdf');
  await buildPdf(downloaded, pdfPath, { log, widthCm });

  return { pdfPath, jpgDir: path.join(outDir, 'jpg'), pages: downloaded };
}

// CLI: node src/convert.mjs "<url>" [outDir]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  const outDir = process.argv[3];
  if (!url) {
    console.error('Usage: node src/convert.mjs "<photobox-url>" [outDir]');
    process.exit(1);
  }
  const r = await convertBook(url, { outDir, log: (m) => console.log('[convert]', m) });
  console.log('\nDone.\n  PDF:', r.pdfPath, '\n  JPGs:', r.jpgDir);
}
