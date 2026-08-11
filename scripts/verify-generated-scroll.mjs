#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [platform, baseUrl, route, outputArgument] = process.argv.slice(2);
if (!['reactjs', 'flutter'].includes(platform) || !baseUrl || !route || !outputArgument) {
    throw new Error('Usage: verify-generated-scroll.mjs <reactjs|flutter> <base-url> <route> <output>');
}

const output = resolve(outputArgument);
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 600}, deviceScaleFactor: 1});
const errors = [];
page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', error => errors.push(error.message));
const url = platform === 'flutter' ? `${baseUrl}/#/${route}` : `${baseUrl}/${route}`;
await page.goto(url, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(platform === 'flutter' ? 8000 : 2000);
const before = await page.screenshot({path: resolve(output, `${route}.before.png`), animations: 'disabled'});
await page.mouse.move(720, 300);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(1000);
const after = await page.screenshot({path: resolve(output, `${route}.after.png`), animations: 'disabled'});
const digest = value => createHash('sha256').update(value).digest('hex');
const result = {
    platform,
    route,
    viewport: {width: 1440, height: 600},
    before: digest(before),
    after: digest(after),
    changedAfterWheel: !before.equals(after),
    errors,
};
await writeFile(resolve(output, `${route}.json`), JSON.stringify(result, null, 2));
await browser.close();
console.log(JSON.stringify(result));
