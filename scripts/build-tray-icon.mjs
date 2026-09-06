// Render the committed, font-independent SVG to the transparent PNG embedded by Rust.
// Uses the existing Playwright development dependency; no runtime image decoder is added.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const source = new URL('../src-tauri/icons/tray-template.svg', import.meta.url);
const output = fileURLToPath(new URL('../src-tauri/icons/tray-template.png', import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 44, height: 44 }, deviceScaleFactor: 1 });
  await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block}</style>' + await readFile(source, 'utf8'));
  await page.screenshot({ path: output, omitBackground: true });
  console.log('Rendered transparent 44×44 menu-bar template: ' + output);
} finally {
  await browser.close();
}
