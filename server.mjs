import express from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPages } from './src/extract.mjs';
import { downloadPages, buildPdf } from './src/build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = path.join(__dirname, 'output');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use('/output', express.static(OUTPUT_ROOT));
app.use(express.static(path.join(__dirname, 'public')));

/** SSE endpoint: streams progress while converting a book. */
app.get('/convert', async (req, res) => {
  const url = req.query.url;
  const widthCm = Math.max(5, Math.min(200, parseFloat(req.query.widthCm) || 28));
  const matchSpreads = req.query.spreads !== 'false';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const log = (msg) => send('log', { msg });

  if (!url || !/^https?:\/\//i.test(url)) {
    send('error', { msg: 'Please enter a valid Photobox book URL.' });
    return res.end();
  }

  const jobId = `job_${Date.now()}`;
  const outDir = path.join(OUTPUT_ROOT, jobId);

  try {
    await fs.mkdir(outDir, { recursive: true });

    log('Opening the book in a headless browser…');
    const pages = await extractPages(url, { log });
    if (!pages.length) throw new Error('No book pages found. Check the URL is a public Photobox book.');
    send('progress', { stage: 'extracted', total: pages.length });

    log(`Downloading ${pages.length} high-resolution pages…`);
    const downloaded = await downloadPages(pages, outDir, { log });

    log('Assembling the PDF book…');
    const pdfPath = path.join(outDir, 'book.pdf');
    await buildPdf(downloaded, pdfPath, { log, widthCm, matchSpreads });

    const rel = (p) => '/output/' + path.relative(OUTPUT_ROOT, p).split(path.sep).join('/');
    send('done', {
      pdf: rel(pdfPath),
      pages: downloaded.length,
      jpgs: downloaded.map((d) => rel(d.path)),
    });
  } catch (err) {
    send('error', { msg: err.message || String(err) });
  } finally {
    res.end();
  }
});

const server = app.listen(PORT, () => {
  console.log(`Photobox Book → PDF running at http://localhost:${PORT}`);
});

// Exit promptly and cleanly on Ctrl+C or when the console window is closed,
// so no server (or its browser children) is left orphaned.
let closing = false;
const shutdown = () => {
  if (closing) process.exit(0);
  closing = true;
  console.log('\nStopping server…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
