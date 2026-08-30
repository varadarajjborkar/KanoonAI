#!/usr/bin/env node
/**
 * pdf.js needs its worker as a real URL. Copying it into public/ keeps this
 * independent of whether the app is bundled by Turbopack or webpack.
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.join('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const dest = path.join('public', 'pdf.worker.min.mjs');

if (!fs.existsSync(src)) {
  console.warn('! pdfjs-dist worker not found; run npm install first');
  process.exit(0);
}
fs.mkdirSync('public', { recursive: true });
fs.copyFileSync(src, dest);
console.log(`• pdf worker -> ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
