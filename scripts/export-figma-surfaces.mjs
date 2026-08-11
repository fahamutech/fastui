#!/usr/bin/env node

import axios from 'axios';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {routeFromSurfaceName} from '../src/services/navigation.mjs';

const [cacheArgument, outputArgument] = process.argv.slice(2);
const cachePath = resolve(cacheArgument ?? '.fastui/figma/figma-file.json');
const outputPath = resolve(outputArgument ?? '.fastui/visual/figma');
const token = process.env.FIGMA_TOKEN;
const fileKey = process.env.FIGMA_FILE;

if (!token || !fileKey) throw new Error('FIGMA_TOKEN and FIGMA_FILE are required.');

const data = JSON.parse(await readFile(cachePath, 'utf8'));
const surfaces = (data.document?.children ?? [])
    .filter(node => node?.type === 'CANVAS')
    .flatMap(canvas => (canvas.children ?? []).map(node => ({canvas: canvas.name, node})))
    .filter(({node}) => node?.type === 'FRAME' && (node.visible ?? true))
    .map(({canvas, node}) => ({
        canvas,
        nodeId: node.id,
        designName: node.name,
        ...routeFromSurfaceName(`${node.name}`.replace(/\s*\[.*?]\s*$/g, '').trim()),
        width: Math.round(node.absoluteBoundingBox?.width ?? 0),
        height: Math.round(node.absoluteBoundingBox?.height ?? 0),
    }));

await mkdir(outputPath, {recursive: true});
const ids = surfaces.map(surface => surface.nodeId).join(',');
let response;
try {
    response = await axios.get(`https://api.figma.com/v1/images/${fileKey}`, {
        headers: {'X-Figma-Token': token},
        params: {ids, format: 'png', scale: 1},
    });
} catch (error) {
    const status = error?.response?.status;
    const retryAfter = error?.response?.headers?.['retry-after'];
    throw new Error(`Unable to render Figma surfaces${status ? ` (HTTP ${status})` : ''}${retryAfter ? `; retry after ${retryAfter}s` : ''}.`);
}

for (const surface of surfaces) {
    const imageUrl = response.data?.images?.[surface.nodeId];
    if (!imageUrl) continue;
    const image = await axios.get(imageUrl, {responseType: 'arraybuffer'});
    const filename = `${surface.name}_${surface.type}.png`.replace(/[^a-zA-Z0-9._-]/g, '_');
    await writeFile(resolve(outputPath, filename), image.data);
    surface.image = filename;
}

await writeFile(resolve(outputPath, 'manifest.json'), JSON.stringify({
    fileKey,
    version: data.version,
    lastModified: data.lastModified,
    exportedAt: new Date().toISOString(),
    surfaces,
}, null, 2));

console.log(`Exported ${surfaces.filter(surface => surface.image).length}/${surfaces.length} Figma surfaces to ${outputPath}`);
