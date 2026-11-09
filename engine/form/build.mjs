// Builds dist/laytime-check.html: the page with the engine and the form bundled inline (no server, no network).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = await build({ entryPoints: ['form/app.js'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('dist', { recursive: true });
const page = readFileSync('form/page.html', 'utf8');
const i = page.indexOf('/*BUNDLE*/');
writeFileSync('dist/laytime-check.html', page.slice(0, i) + js + page.slice(i + '/*BUNDLE*/'.length));
console.log(`dist/laytime-check.html ${(readFileSync('dist/laytime-check.html').length / 1024).toFixed(0)} KB`);
