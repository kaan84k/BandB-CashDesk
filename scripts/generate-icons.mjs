import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  for (const size of [180, 192, 512]) {
    const png = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    await writeFile(new URL(`../public/icon-${size}.png`, import.meta.url), Buffer.from(png, 'base64'));
  }
} finally { await browser.close(); }
console.log('Generated 180, 192, and 512 pixel application icons.');
