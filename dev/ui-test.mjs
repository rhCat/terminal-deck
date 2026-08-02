// terminal-deck headless UI verification (Playwright) — covers the deck layout
// plus the three added features: rename, theme switching, and the foldable
// properties panel. Screenshots -> dev/screenshots.
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787';
const OUT = new URL('./screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(1800);

// --- 1) base layout ---
assert.equal(await page.locator('#toolbar').count(), 1, 'toolbar present');
assert.equal(await page.locator('#sorter').count(), 1, 'sorter present');
assert.equal(await page.locator('#stage').count(), 1, 'stage present');
assert.equal(await page.locator('#notes').count(), 1, 'notes present');
assert.ok(await page.locator('.card').count() >= 1, 'at least one card');
console.log('[1] layout + cards OK');

// --- 2) focus first card, main term mounts ---
await page.locator('.card').first().click();
await page.waitForTimeout(1200);
assert.ok(await page.locator('#term .xterm').count() >= 1, 'main xterm mounted');
console.log('[2] main terminal mounted on focus');

// --- 3) properties panel toggle ---
await page.locator('#btn-props').click();
await page.waitForTimeout(700);
assert.ok(await page.locator('#props').isVisible(), 'props panel visible after toggle');
assert.ok(await page.locator('body.show-props').count() === 1, 'body has show-props class');
// fields populate from /api/info
await page.waitForTimeout(1000);
const pwd = (await page.locator('#p-pwd').textContent()) || '';
const ip = (await page.locator('#p-ip').textContent()) || '';
assert.ok(pwd.length > 0, 'pwd populated');
assert.ok(ip.length > 0, 'ip populated');
await page.screenshot({ path: OUT + '/05-props-panel.png' });
console.log('[3] props panel visible + populated (pwd=' + pwd + ' ip=' + ip + ')');

// --- 4) theme switching ---
await page.locator('#theme-select').selectOption('dracula');
await page.waitForTimeout(400);
const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log('[4] theme switch -> body bg = ' + bodyBg);
assert.ok(bodyBg !== 'rgb(15, 17, 23)', 'theme changed background from default');

// --- 5) rename via modal ---
const firstCardName = await page.locator('.card-name').first().textContent();
await page.locator('#btn-rename').click();
await page.waitForTimeout(300);
await page.locator('#rename-input').fill('renamed-demo');
await page.locator('#rename-ok').click();
await page.waitForTimeout(1500);
const stageTitle = (await page.locator('#stage-title').textContent()) || '';
console.log('[5] renamed "' + firstCardName + '" -> stage title: ' + stageTitle);
// show renamed card
await page.screenshot({ path: OUT + '/06-after-rename.png' });

// --- 6) demo (colorful command into focused pane) ---
await page.locator('#btn-demo').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/07-demo.png' });

console.log('UI errors:', errors.length ? errors : 'none');
if (errors.length) { await browser.close(); process.exit(1); }
await browser.close();
console.log('UI TEST PASS — screenshots in ' + OUT);
