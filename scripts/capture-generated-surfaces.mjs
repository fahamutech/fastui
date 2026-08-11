#!/usr/bin/env node

import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {routeFromSurfaceName} from '../src/services/navigation.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [platform, baseUrl, cacheArgument, outputArgument] = process.argv.slice(2);

if (!['reactjs', 'flutter'].includes(platform)) {
    throw new Error('Usage: capture-generated-surfaces.mjs <reactjs|flutter> <base-url> <figma-cache> <output>');
}

const cachePath = resolve(cacheArgument);
const outputPath = resolve(outputArgument);
const data = JSON.parse(await readFile(cachePath, 'utf8'));
const requestedRoutes = new Set(`${process.env.FASTUI_ROUTES ?? ''}`.split(',').map(value => value.trim()).filter(Boolean));
const waitMs = Number(process.env.FASTUI_WAIT_MS);
const surfaces = (data.document?.children ?? [])
    .filter(node => node?.type === 'CANVAS')
    .flatMap(canvas => canvas.children ?? [])
    .filter(node => node?.type === 'FRAME' && (node.visible ?? true))
    .map(node => ({
        nodeId: node.id,
        designName: node.name,
        width: Math.round(node.absoluteBoundingBox?.width ?? node.size?.x ?? 1440),
        height: Math.round(node.absoluteBoundingBox?.height ?? node.size?.y ?? 960),
        ...routeFromSurfaceName(`${node.name}`.replace(/\s*\[.*?]\s*$/g, '').trim()),
    }))
    .filter(surface => requestedRoutes.size === 0 || requestedRoutes.has(surface.name));

await mkdir(outputPath, {recursive: true});
const browser = await chromium.launch({headless: true});
const errors = [];

const captured = [];
for (const surface of surfaces) {
    const page = await browser.newPage({
        viewport: {width: surface.width, height: surface.height},
        deviceScaleFactor: 1,
    });
    page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning') {
            errors.push(`${surface.name}: ${message.type()}: ${message.text()}`);
        }
    });
    page.on('pageerror', error => errors.push(`${surface.name}: pageerror: ${error.message}`));
    if (platform === 'reactjs') {
        await page.goto(`${baseUrl}/${surface.name}`, {waitUntil: 'domcontentloaded'});
    } else {
        await page.goto(`${baseUrl}/#/${surface.name}`, {waitUntil: 'domcontentloaded'});
    }
    await page.waitForTimeout(Number.isFinite(waitMs) ? waitMs : platform === 'flutter' ? 2500 : 1000);
    const filename = `${surface.name}_${surface.type}.png`;
    await page.screenshot({path: resolve(outputPath, filename), animations: 'disabled'});
    const layout = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    }));
    const runtime = platform === 'reactjs'
        ? await page.evaluate(async () => ({
            route: (await import('/src/routing.mjs')).getCurrentRouteValue(),
            dialogs: document.querySelectorAll('[role="dialog"]').length,
        }))
        : undefined;
    captured.push({
        ...surface,
        image: filename,
        layout: {...layout, horizontalOverflow: layout.scrollWidth > layout.viewportWidth + 1},
        runtime,
    });
    await page.close();
}

await browser.close();
await writeFile(resolve(outputPath, 'manifest.json'), JSON.stringify({platform, baseUrl, captured, errors}, null, 2));
console.log(`Captured ${captured.length}/${surfaces.length} ${platform} surfaces with ${errors.length} browser errors.`);
