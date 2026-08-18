/**
 * Resolves and, when explicitly enabled, downloads the raster/vector assets
 * referenced by a Figma node's fills. Looks in the local `.fastui` asset
 * cache and the project's own image folders before ever hitting the network.
 */
import axios from 'axios';
import {copyFile, readdir, stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {ensureFileExist, ensurePathExist} from '../../shared/fs.mjs';

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

// Download state for the current translation run. Reset via
// configureAssetDownloads() at the start of every getPagesAndTraverseChildren
// call so a rate limit hit on one run never suppresses downloads on the next.
const downloadState = {
    enabled: false,
    disabledForRun: false,
    warningWritten: false,
};

/**
 * @param enabled {boolean} whether this translation run is allowed to hit the
 * network for missing assets (the `--fresh` / downloadAssets flag).
 */
export function configureAssetDownloads(enabled) {
    downloadState.enabled = enabled;
    downloadState.disabledForRun = false;
    downloadState.warningWritten = false;
}

async function downloadImage(imageUrl, imageRef, filePath) {
    const response = await axios({
        url: imageUrl,
        method: 'GET',
        responseType: 'stream',
    });
    const contentType = response?.headers?.['content-type'];
    let contentExtension = `${contentType}`.split('/')[1] ?? 'png';
    contentExtension = contentExtension.split('+')[0];
    const imagePath = resolve(join(filePath, `${imageRef}.${contentExtension}`));
    await ensureFileExist(imagePath);
    const writer = createWriteStream(imagePath);

    response.data.pipe(writer);

    return new Promise((then, reject) => {
        writer.on('finish', () => then({imagePath, contentExtension}));
        writer.on('error', reject);
    });
}

async function fetchFigmaImagesUrl({token, figFile, nodeId, format, imageRef}) {
    if (nodeId) {
        const axiosConfig = {headers: {'X-Figma-Token': token}};
        const url = `https://api.figma.com/v1/images/${figFile}?format=${format ?? 'png'}&ids=${nodeId}`;
        const {data} = await axios.get(url, axiosConfig);
        return data?.images?.[nodeId];
    }
    const axiosConfig = {headers: {'X-Figma-Token': token}};
    const allImagesUrl = `https://api.figma.com/v1/files/${figFile}/images`;
    const allImagesResponse = await axios.get(allImagesUrl, axiosConfig);
    return allImagesResponse?.data?.meta?.images?.[imageRef];
}

/**
 * Resolves a Figma `imageRef` to an `asset://figma/<file>` spec reference,
 * preferring assets already cached on disk over a network round-trip.
 * @return {Promise<string|undefined>}
 */
export async function getFigmaImagePath({token, figFile, srcPath, imageRef, child, format}) {
    if (!imageRef) {
        return undefined;
    }
    const nodeId = child?.id;
    const folderPath = resolve(join(process.cwd(), '.fastui', 'assets', 'figma'));
    await ensurePathExist(folderPath);
    try {
        const candidateFolders = [
            folderPath,
            resolve(join(process.cwd(), 'assets', 'images', 'figma')),
            resolve(join(process.cwd(), 'public', 'images', 'figma')),
        ];
        let imagePath;
        let file;
        for (const candidate of candidateFolders) {
            try {
                const files = await readdir(candidate);
                file = files.find(value => value.trim().startsWith(imageRef));
                if (file) {
                    imagePath = join(candidate, file);
                    break;
                }
            } catch (_) {
            }
        }
        await stat(imagePath);
        if (dirname(imagePath) !== folderPath) await copyFile(imagePath, join(folderPath, file));
        return `asset://figma/${file}`;
    } catch (e) {
        if (!downloadState.enabled || !token) return undefined;
        if (downloadState.disabledForRun) return undefined;
        try {
            const url = await fetchFigmaImagesUrl({token, format, figFile, nodeId, imageRef});
            if (url) {
                const {contentExtension} = await downloadImage(url, imageRef, folderPath);
                const imageName = `${imageRef}.${contentExtension ?? 'png'}`;
                return `asset://figma/${imageName}`;
            }
        } catch (error) {
            if (error?.response?.status === 429) downloadState.disabledForRun = true;
            if (!downloadState.warningWritten) {
                const status = error?.response?.status;
                const retryAfter = error?.response?.headers?.['retry-after'];
                const formattedRetryAfter = retryAfter ? formatRetryAfter(retryAfter) : undefined;
                console.warn(`WARN : Figma asset download unavailable${status ? ` (HTTP ${status})` : ''}${status === 429 && formattedRetryAfter ? `; retry after ${formattedRetryAfter}` : ''}; continuing with cached assets and specs.`);
                downloadState.warningWritten = true;
            }
        }
        return undefined;
    }
}
