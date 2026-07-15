import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';

const CM_TO_PT = 28.3464567; // 1 cm in PostScript points (72 dpi)

/** Download every page image to <outDir>/jpg as high-resolution JPGs. */
export async function downloadPages(pages, outDir, { log = () => {}, concurrency = 6 } = {}) {
  const jpgDir = path.join(outDir, 'jpg');
  await fs.mkdir(jpgDir, { recursive: true });

  const results = new Array(pages.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= pages.length) return;
      const p = pages[i];
      const idx = String(i + 1).padStart(3, '0');
      const outName = `page_${idx}_${p.file.replace(/\.jpe?g$/i, '')}.jpg`;
      const outPath = path.join(jpgDir, outName);
      const res = await fetch(p.url);
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${p.file}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(outPath, buf);
      results[i] = { ...p, path: outPath, bytes: buf.length };
      log(`Saved ${outName} (${(buf.length / 1024).toFixed(0)} KB)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
  return results;
}

/**
 * Assemble downloaded page JPGs into a single PDF.
 * Each PDF page matches its image aspect ratio exactly (no cropping / distortion).
 * All pages share the same physical width (default a 28 cm landscape photobook),
 * so the PDF reproduces the original book's proportions at print size.
 */
export async function buildPdf(downloaded, outPath, { log = () => {}, widthCm = 28, matchSpreads = true } = {}) {
  const pdf = await PDFDocument.create();
  const pageWidthPt = widthCm * CM_TO_PT;
  let coverHeightPt = null;

  for (const d of downloaded) {
    const bytes = await fs.readFile(d.path);
    const img = await pdf.embedJpg(bytes); // embeds original JPEG losslessly
    const aspect = img.height / img.width;
    const pageHeightPt = pageWidthPt * aspect;
    const pg = pdf.addPage([pageWidthPt, pageHeightPt]);
    pg.drawImage(img, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
    if (coverHeightPt === null) coverHeightPt = pageHeightPt;
    log(`Placed ${path.basename(d.path)} -> PDF page ${pdf.getPageCount()}`);
  }

  if (matchSpreads && pdf.getPageCount() > 1) {
    // The online viewer opens the cover alone, then pairs leaves as spreads
    // ([inside-cover blank, page 1], [2,3], ...). Insert the blank inside-cover
    // page after the cover and open the PDF two-up so spreads match the screen.
    pdf.insertPage(1, [pageWidthPt, coverHeightPt]); // blank white inside-front-cover
    pdf.catalog.set(PDFName.of('PageLayout'), PDFName.of('TwoPageRight'));
    log('Set two-page (spread) layout matching the online viewer.');
  }

  const out = await pdf.save();
  await fs.writeFile(outPath, out);
  log(`Wrote PDF: ${outPath} (${(out.length / 1024 / 1024).toFixed(2)} MB, ${downloaded.length} pages)`);
  return outPath;
}
