#!/usr/bin/env node

import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {routeFromSurfaceName} from '../src/shared/routing.mjs';

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
const browser = await chromium.launch({
    headless: true,
    ...(process.env.FASTUI_PLAYWRIGHT_CHANNEL
        ? {channel: process.env.FASTUI_PLAYWRIGHT_CHANNEL}
        : {}),
});
const errors = [];

const captured = [];
for (const surface of surfaces) {
    const page = await browser.newPage({
        viewport: {width: surface.width, height: surface.height},
        deviceScaleFactor: 1,
    });
    page.on('console', message => {
        // Network failures are collected below with their URL and HTTP status.
        // Chromium otherwise emits a context-free console error for a missing
        // favicon, which makes a healthy generated surface look broken.
        if (
            (message.type() === 'error' || message.type() === 'warning') &&
            !message.text().startsWith('Failed to load resource:') &&
            // Flutter Web can emit this before an isolated cold page has
            // registered its lifecycle listener. It is a framework startup
            // diagnostic, not an application/rendering failure.
            !message.text().startsWith('A message on the flutter/lifecycle channel was discarded')
        ) {
            errors.push(`${surface.name}: ${message.type()}: ${message.text()}`);
        }
    });
    page.on('response', response => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
            errors.push(`${surface.name}: resource ${response.status()}: ${response.url()}`);
        }
    });
    page.on('pageerror', error => errors.push(`${surface.name}: pageerror: ${error.message}`));
    // Both generated targets use hash routing on the web.  A path URL leaves
    // React at its initial route and makes a visual audit silently invalid.
    await page.goto(`${baseUrl}/#/${surface.name}`, {waitUntil: 'domcontentloaded'});
    // A new Flutter web page has to initialize CanvasKit before it paints its
    // first frame.  The capture loop deliberately opens an isolated page for
    // every Figma surface, so the old 2.5s default could save an all-white
    // canvas and incorrectly mark the visual audit as successful. Keep an
    // explicit FASTUI_WAIT_MS override for fast local runs, but use a cold
    // start-safe default for evidence-producing Flutter captures.
    await page.waitForTimeout(Number.isFinite(waitMs) ? waitMs : platform === 'flutter' ? 10000 : 1000);
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
