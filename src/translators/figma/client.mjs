/**
 * Talks to the Figma REST API: downloading/caching the file document itself.
 * Per-image asset downloading lives in ./assets.mjs.
 */
import axios from 'axios';
import {dirname, join, resolve} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import {ensurePathExist} from '../../shared/fs.mjs';

function formatRetryAfter(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return value;
    const totalSeconds = Math.floor(seconds);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    parts.push(`${remainingSeconds}s`);
    return parts.join(' ');
}

export function getFigmaCachePath(figFile, cachePath) {
    if (cachePath) return resolve(cachePath);
    const safeFileKey = `${figFile ?? 'figma-file'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(join('.fastui', 'figma', `${safeFileKey}.json`));
}

/**
 * Downloads (or reads back from the local cache) the Figma file document.
 * @param token {string}
 * @param figFile {string}
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
