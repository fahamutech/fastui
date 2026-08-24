/**
 * Talks to the Figma REST API: downloading/caching the file document itself.
 * Per-image asset downloading lives in ./assets.mjs.
 */
import axios from 'axios';
import {dirname, join, resolve} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import {ensurePathExist} from '../../shared/fs.mjs';
import {formatRetryAfter} from "./utils.mjs";

export function getFigmaCachePath(figFile, cachePath) {
    if (cachePath) return resolve(cachePath);
    const safeFileKey = `${figFile ?? 'figma-file'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(join('.fastui', 'figma', `${safeFileKey}.json`));
}

function nodeReferenceValues(nodeIds) {
    return Array.isArray(nodeIds) ? nodeIds : `${nodeIds ?? ''}`.split(',');
}

export function normalizeFigmaNodeIds(nodeIds) {
    const values = nodeReferenceValues(nodeIds);
    return [...new Set(values.map(value => {
        const raw = `${value}`.trim();
        const match = raw.match(/[?&]node-id=([^&#]+)/i);
        const nodeId = match ? decodeURIComponent(match[1]) : raw;
        // Figma links use a hyphen, while the REST API expects a colon.
        return nodeId.replace(/^(\d+)-(\d+)$/, '$1:$2');
    }).filter(Boolean))];
}

/** Returns file keys embedded in Figma design/file URLs, ignoring raw IDs. */
export function getFigmaFileKeysFromNodeReferences(nodeIds) {
    return [...new Set(nodeReferenceValues(nodeIds).map(value => {
        const raw = `${value}`.trim();
        try {
            const url = new URL(raw);
            const match = url.pathname.match(/^\/(?:design|file)\/([^/?#]+)/i);
            return match?.[1];
        } catch (_) {
            return undefined;
        }
    }).filter(Boolean))];
}

export function getFigmaNodesCachePath(figFile, nodeIds, cachePath) {
    if (cachePath) return resolve(cachePath);
    const safeFileKey = `${figFile ?? 'figma-file'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeNodes = normalizeFigmaNodeIds(nodeIds).join('_').replace(/[^a-zA-Z0-9_-]/g, '_') || 'nodes';
    return resolve(join('.fastui', 'figma', `${safeFileKey}--${safeNodes}.json`));
}

/**
 * Downloads (or reads back from the local cache) the Figma file document.
 * @param token {string}
 * @param figFile {string}
 * @param fresh
 * @param cachePath
 * @param fetcher
 * @return {Promise<any>}
 */
export async function fetchFigmaFile({token, figFile, fresh = false, cachePath, fetcher = axios.get}) {
    const localPath = getFigmaCachePath(figFile, cachePath);
    if (!fresh) {
        try {
            return JSON.parse(await readFile(localPath, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw new Error(`Unable to read cached Figma file at ${localPath}: ${error?.message ?? error}`);
            }
        }
    }
    if (!figFile || !token) {
        throw new Error(`No cached Figma file exists at ${localPath}. FIGMA_FILE and FIGMA_TOKEN are required for the first download.`);
    }
    let data;
    try {
        ({data} = await fetcher(`https://api.figma.com/v1/files/${figFile}`, {
            headers: {'X-Figma-Token': token}
        }));
    } catch (error) {
        const status = error?.response?.status;
        const retryAfter = error?.response?.headers?.['retry-after'];
        const formattedRetryAfter = retryAfter ? formatRetryAfter(retryAfter) : undefined;
        throw new Error(`Unable to download Figma file${status ? ` (HTTP ${status})` : ''}${status === 429 && formattedRetryAfter ? `; retry after ${formattedRetryAfter}` : ''}: ${error?.response?.data?.message ?? error?.message ?? 'request failed'}`);
    }
    await ensurePathExist(dirname(localPath));
    await writeFile(localPath, JSON.stringify(data, null, 2));
    return data;
}

/**
 * Downloads only the requested Figma nodes. The API response includes each
 * node's complete descendant tree, which lets a grouped frame become a page
 * without downloading the entire design file.
 */
export async function fetchFigmaNodes({token, figFile, nodeIds, fresh = false, cachePath, fetcher = axios.get}) {
    const ids = normalizeFigmaNodeIds(nodeIds);
    if (!ids.length) throw new Error('At least one Figma node ID is required.');
    const localPath = getFigmaNodesCachePath(figFile, ids, cachePath);
    if (!fresh) {
        try {
            return JSON.parse(await readFile(localPath, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw new Error(`Unable to read cached Figma nodes at ${localPath}: ${error?.message ?? error}`);
            }
        }
    }
    if (!figFile || !token) {
        throw new Error(`No cached Figma nodes exist at ${localPath}. FIGMA_FILE and FIGMA_TOKEN are required for the first download.`);
    }
    let data;
    try {
        ({data} = await fetcher(`https://api.figma.com/v1/files/${figFile}/nodes`, {
            headers: {'X-Figma-Token': token},
            params: {ids: ids.join(',')}
        }));
    } catch (error) {
        const status = error?.response?.status;
        const retryAfter = error?.response?.headers?.['retry-after'];
        const formattedRetryAfter = retryAfter ? formatRetryAfter(retryAfter) : undefined;
        throw new Error(`Unable to download Figma nodes${status ? ` (HTTP ${status})` : ''}${status === 429 && formattedRetryAfter ? `; retry after ${formattedRetryAfter}` : ''}: ${error?.response?.data?.message ?? error?.message ?? 'request failed'}`);
    }
    await ensurePathExist(dirname(localPath));
    await writeFile(localPath, JSON.stringify(data, null, 2));
    return data;
}

/**
 * Figma documents may spread pages across multiple canvases; FastUI treats
 * every canvas's children as one flat page list so shared components can
 * live on their own canvas.
 * @param data {*}
 * @return {*}
 */
export function getDesignDocument(data) {
    const document = data?.document;
    if (!document) return undefined;
    const canvases = (document?.children ?? []).filter(child => child?.type === 'CANVAS');
    if (!canvases.length) return document?.children?.[0] ?? document;
    return {
        ...document,
        children: canvases.flatMap(canvas => canvas?.children ?? []),
        flowStartingPoints: canvases.flatMap(canvas => canvas?.flowStartingPoints ?? [])
    };
}

/** Turns a /nodes response into independently generated FastUI surfaces. */
export function getNodeDesignDocument(data, nodeIds) {
    const ids = normalizeFigmaNodeIds(nodeIds);
    const nodes = data?.nodes ?? {};
    const missing = ids.filter(id => !nodes[id]?.document);
    if (missing.length) throw new Error(`Figma did not return requested node${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
    const children = ids.map(id => nodes[id].document).map(node => ({
        // A wrapper makes every selectable Figma shape (including GROUP/TEXT)
        // a surface while retaining the requested node and all of its children.
        id: `fastui-selected-${node.id}`,
        name: node.name,
        type: 'FRAME',
        visible: node.visible ?? true,
        layoutMode: 'VERTICAL',
        absoluteBoundingBox: node.absoluteBoundingBox,
        absoluteRenderBounds: node.absoluteRenderBounds ?? node.absoluteBoundingBox,
        sourceNodeId: node.id,
        // The selected node is the content root of this synthetic viewport.
        // Keep that intent through translation so its design-canvas dimensions
        // do not become a fixed-size nested page.
        children: [{...node, selectedSurfaceRoot: true}],
    }));
    return {type: 'DOCUMENT', children, flowStartingPoints: []};
}
