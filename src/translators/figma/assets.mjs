/**
 * Resolves and, when explicitly enabled, downloads the raster/vector assets
 * referenced by a Figma node's fills. Looks in the local `.fastui` asset
 * cache and the project's own image folders before ever hitting the network.
 */
import axios from 'axios';
import {readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {ensureFileExist, ensurePathExist} from '../../shared/fs.mjs';
import {formatRetryAfter} from './utils.mjs';

// Download state for the current translation run. Reset via
// configureAssetDownloads() at the start of every getPagesAndTraverseChildren
// call so a rate limit hit on one run never suppresses downloads on the next.
const downloadState = {
    enabled: false,
    disabledForRun: false,
    warningWritten: false,
    projectPath: process.cwd(),
};

/**
 * @param enabled {boolean} whether this translation run is allowed to hit the
 * network for missing assets (the `--fresh` / downloadAssets flag).
 */
export function configureAssetDownloads(enabled, projectPath = process.cwd()) {
    downloadState.enabled = enabled;
    downloadState.disabledForRun = false;
    downloadState.warningWritten = false;
    downloadState.projectPath = projectPath;
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
// export async function getFigmaImagePath({token, figFile, srcPath, imageRef, child, format}) {
//     if (!imageRef) {
//         return undefined;
//     }
//     const nodeId = child?.id;
//     const folderPath = resolve(join(downloadState.projectPath, '.fastui', 'assets', 'figma'));
//     await ensurePathExist(folderPath);
//     try {
//         const candidateFolders = [
//             resolve(join(folderPath, 'images')),
//             resolve(join(folderPath, 'vectors')),
//             folderPath,
//             resolve(join(downloadState.projectPath, 'assets', 'images', 'figma')),
//             resolve(join(downloadState.projectPath, 'public', 'images', 'figma')),
//         ];
//         let imagePath;
//         let file;
//         for (const candidate of candidateFolders) {
//             try {
//                 const files = await readdir(candidate);
//                 const expected = `${imageRef}`.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resource';
//                 file = files.find(value => value.slice(0, -(extname(value).length || 0)) === expected);
//                 if (file) {
//                     imagePath = join(candidate, file);
//                     break;
//                 }
//             } catch (_) {
//             }
//         }
//         await stat(imagePath);
//         return `asset://figma/${file}`;
//     } catch (e) {
//         const expected = `${imageRef}`.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'resource';
//         const fallback = `asset://figma/${expected}.${format ?? 'png'}`;
//         if (!downloadState.enabled || !token) return fallback;
//         if (downloadState.disabledForRun) return fallback;
//         try {
//             const url = await fetchFigmaImagesUrl({token, format, figFile, nodeId, imageRef});
//             if (url) {
//                 const {contentExtension} = await downloadImage(url, imageRef, folderPath);
//                 const imageName = `${imageRef}.${contentExtension ?? 'png'}`;
//                 return `asset://figma/${imageName}`;
//             }
//         } catch (error) {
//             if (error?.response?.status === 429) downloadState.disabledForRun = true;
//             if (!downloadState.warningWritten) {
//                 const status = error?.response?.status;
//                 const retryAfter = error?.response?.headers?.['retry-after'];
//                 const formattedRetryAfter = retryAfter ? formatRetryAfter(retryAfter) : undefined;
//                 console.warn(`WARN : Figma asset download unavailable${status ? ` (HTTP ${status})` : ''}${status === 429 && formattedRetryAfter ? `; retry after ${formattedRetryAfter}` : ''}; continuing with cached assets and specs.`);
//                 downloadState.warningWritten = true;
//             }
//         }
//         return fallback;
//     }
// }

export async function getFigmaImagePath({
                                            token,
                                            figFile,
                                            srcPath,
                                            imageRef,
                                            child,
                                            format
                                        }) {
    if (!imageRef) {
        return undefined;
    }

    const nodeId = child?.id;

    const folderPath = resolve(
        join(
            downloadState.projectPath,
            '.fastui',
            'assets',
            'figma'
        )
    );

    await ensurePathExist(folderPath);

    const expected = `${imageRef}`
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'resource';

    const expectedExtension = format ?? 'png';

    /*
     * IMPORTANT:
     * Cache is only used when this is NOT a fresh asset run.
     */
    if (!downloadState.enabled) {
        const candidateFolders = [
            resolve(join(folderPath, 'images')),
            resolve(join(folderPath, 'vectors')),
            folderPath,
            resolve(
                join(
                    downloadState.projectPath,
                    'assets',
                    'images',
                    'figma'
                )
            ),
            resolve(
                join(
                    downloadState.projectPath,
                    'public',
                    'images',
                    'figma'
                )
            ),
        ];

        for (const candidate of candidateFolders) {
            try {
                const files = await readdir(candidate);

                const matchingFiles = files.filter(value => {
                    const basename = value.slice(
                        0,
                        -(extname(value).length || 0)
                    );
                    return basename === expected;
                });
                // Figma may return JPEG/WebP data for a raster image even
                // when its export request defaulted to PNG. Use the extension
                // of the cached, verified download so generated specs point to
                // a file that actually exists. Prefer the requested format if
                // both variants happen to be present.
                const file = matchingFiles.find(value =>
                    extname(value).slice(1).toLowerCase() === expectedExtension
                ) ?? matchingFiles[0];

                if (file) {
                    return `asset://figma/${file}`;
                }
            } catch (_) {
                // directory does not exist
                // console.warn(_);
            }
        }

        return `asset://figma/${expected}.${expectedExtension}`;
    }

    /*
     * Fresh mode.
     */
    if (!token || downloadState.disabledForRun) {
        return `asset://figma/${expected}.${expectedExtension}`;
    }

    try {
        const url = await fetchFigmaImagesUrl({
            token,
            format,
            figFile,
            nodeId,
            imageRef
        });

        if (!url) {
            return `asset://figma/${expected}.${expectedExtension}`;
        }

        const {contentExtension} = await downloadImage(
            url,
            expected,
            folderPath
        );

        return `asset://figma/${expected}.${contentExtension}`;
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

    return `asset://figma/${expected}.${expectedExtension}`;
}
