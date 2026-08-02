// Ad-hoc UI verification for terminal-deck using headless Chromium (Playwright).
// Drives the real running server at localhost:8787 and screenshots the deck.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8787';
const OUT = new URL('./screenshots', import.meta.url).pathname;

import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1500);

// --- toolbar / layout present ---
const title = await page.title();
console.log('title:', title);
const hasToolbar = await page.locator('#toolbar').count();
const hasSorter = await page.locator('#sorter').count();
const hasStage = await page.locator('#stage').count();
const hasNotes = await page.locator('#notes').count();
console.log(`layout: toolbar=${hasToolbar} sorter=${hasSorter} stage=${hasStage} notes=${hasNotes}`);
if (!(hasToolbar && hasSorter && hasStage && hasNotes)) { console.log('LAYOUT MISSING'); await browser.close(); process.exit(1); }

// --- cards rendered? (build + logs seeded) ---
await page.waitForTimeout(1200); // snapshot polls
const cardCount = await page.locator('.card').count();
console.log('cards:', cardCount);
const cardNames = await page.locator('.card-name').allTextContents();
console.log('card names:', cardNames);

// --- click first card -> main stage activates ---
if (cardCount > 0) {
  await page.locator('.card').first().click();
  await page.waitForTimeout(1000);
  const stageTitle = (await page.locator('#stage-title').textContent()) || '';
  console.log('stage title after click:', JSON.stringify(stageTitle));
  // main xterm should now be present
  const xtermCount = await page.locator('#term .xterm').count();
  console.log('main xterm elements:', xtermCount);
  // screenshot: default deck view
  await page.screenshot({ path: OUT + '/01-deck-default.png' });
}

// --- grid view ---
await page.locator('#btn-grid').click();
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + '/02-grid-view.png' });

// --- zoom view ---
await page.locator('#btn-grid').click(); // un-grid
await page.locator('#btn-zoom').click();
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + '/03-zoom-view.png' });

// --- new work modal ---
await page.locator('#btn-zoom').click(); // unzoom
await page.locator('#btn-new').click();
await page.waitForTimeout(300);
await page.locator('#new-name').fill('demo-work');
await page.locator('#modal-ok').click();
await page.waitForTimeout(1500);
const stageTitle2 = (await page.locator('#stage-title').textContent()) || '';
console.log('stage title after create:', JSON.stringify(stageTitle2));
await page.screenshot({ path: OUT + '/04-after-create.png' });

const cardsAfter = await page.locator('.card').count();
console.log('cards after create:', cardsAfter);

console.log('JS errors captured:', errors.length ? errors : 'none');
await browser.close();
console.log('DONE. screenshots -> ' + OUT);
