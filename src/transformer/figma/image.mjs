import axios from "axios";
import {join, resolve} from "node:path";
import {ensureFileExist, ensurePathExist} from "../../helpers/general.mjs";
import {createWriteStream} from "node:fs";
import {readdir, stat} from "node:fs/promises";

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

export async function getFigmaImagePath({token, figFile, srcPath, imageRef, child, format}) {
    if (!imageRef) {
        return undefined;
    }
    const nodeId = child?.id;
    const folderPath = resolve(join(srcPath, '..', '..', 'public', 'images', 'figma'));
    await ensurePathExist(folderPath);
    try {
        const files = await readdir(folderPath);
        const file = files.filter(x => x.trim().startsWith(imageRef))[0];
        const imagePath = join(folderPath, file);
        await stat(imagePath);
        return `/images/figma/${file}`;
    } catch (e) {
        const url = await fetchFigmaImagesUrl(
            {token, format, figFile, nodeId, imageRef});
        if (url) {
            const {contentExtension} = await downloadImage(url, imageRef, folderPath);
            const imageName = `${imageRef}.${contentExtension ?? 'png'}`;
            return `/images/figma/${imageName}`;
        }
        return undefined;
    }
}
