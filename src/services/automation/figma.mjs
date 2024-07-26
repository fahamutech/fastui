import axios from "axios";
import {
    ensureFileExist,
    ensurePathExist,
    itOrEmptyList,
    justString,
    maybeRandomName,
    sanitizeFullColon
} from "../../utils/index.mjs";
import {join, resolve} from "node:path";
import {appendFile, readFile, stat, writeFile} from "node:fs/promises";
import * as yaml from "js-yaml"
import {createWriteStream} from "node:fs";

const id2nameMapCache = {};

/**
 *
 * @param token
 * @param figFile
 * @return {Promise<any>}
 */
export async function fetchFigmaFile({token, figFile}) {
    try {
        const {data} = await axios.get(`https://api.figma.com/v1/files/${figFile}`, {
            headers: {
                'X-Figma-Token': token
            }
        });
        return data;
    } catch (e) {
        console.log(e?.response?.data ?? e?.data ?? e?.message ?? e?.toString() ?? 'Fail to retrieve figma file');
    }
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
        writer.on('finish', () => then(imagePath));
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

async function getFigmaImagePath({token, figFile, srcPath, imageRef, child, format}) {
    if (!imageRef) {
        return undefined;
    }
    const nodeId = child?.id;
    const folderPath = resolve(join(srcPath, '..', '..', 'public', 'images', 'figma'));
    await ensurePathExist(folderPath);
    const imageName = `${imageRef}.${format ?? 'png'}`;
    const imageRelativePath = `/images/figma/${imageName}`;
    try {
        const imagePath = join(folderPath, imageName);
        await stat(imagePath);
        return imageRelativePath;
    } catch (e) {
        const url = await fetchFigmaImagesUrl(
            {token, format, figFile, nodeId, imageRef});
        if (url) {
            await downloadImage(url, imageRef, folderPath);
            return imageRelativePath;
        }
        return undefined;
    }
}

/**
 *
 * @param data
 * @return {*}
 */
export function getDesignDocument(data) {
    return data?.document?.children?.[0];
}

function transformLayoutAxisAlign(counterAxisAlignItems) {
    switch (counterAxisAlignItems) {
        case 'MIN':
            return 'flex-start';
        case 'MAX':
            return 'flex-end';
        case  'CENTER':
            return 'center';
        case 'SPACE_BETWEEN':
            return 'space-between';
        default:
            return 'normal';
    }
}

function transformLayoutWrap(layoutWrap) {
    return `${layoutWrap ?? 'NOWRAP'}`.replaceAll('_', '').toLowerCase();
}

function getSize(layoutSizing, size) {
    if (layoutSizing === 'FIXED') {
        return size;
    } else {
        return undefined;
    }
}

async function transformFrameChildren({frame, module, isLoopElement, token, figFile, srcPath}) {
    const children = [];
    const fChildren = frame?.children?.filter(x => x?.visible ?? true) ?? [];
    for (let i = 0; i < fChildren?.length; i++) {
        const child = fChildren[i] ?? {};
        const isLastChild = (fChildren?.length - 1) === i;
        if (child?.type === 'FRAME') {
            const backGroundImage = await getFigmaImagePath({
                token,
                figFile,
                srcPath,
                imageRef: getImageRef(child?.fills),
                child: undefined
            })
            const baseType = getBaseType(child);
            const isLoop = baseType === 'loop';
            if (isLoop && child?.children?.length > 1) {
                child.children = [child?.children?.[0]];
            }
            const extendFrame = `i${fChildren[i - 1]?.id}_${fChildren[i - 1]?.name}`
                .replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const name = `i${child?.id}_${child?.name}`
                .replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const mChild = {
                ...child,
                name,
                module,
                extendFrame: i > 0 ? `./${extendFrame}.yml` : undefined,
                isLoopElement,
                styles: isLoop ? {
                    display: 'flex',
                    flexDirection: child?.layoutMode === 'VERTICAL' ? 'column' : 'row',
                    flexWrap: transformLayoutWrap(child?.layoutWrap),
                    justifyContent: child?.layoutMode === 'VERTICAL'
                        ? transformLayoutAxisAlign(child?.counterAxisAlignItems)
                        : transformLayoutAxisAlign(child?.primaryAxisAlignItems),
                    alignItems: child?.layoutMode === 'VERTICAL'
                        ? transformLayoutAxisAlign(child?.primaryAxisAlignItems)
                        : transformLayoutAxisAlign(child?.counterAxisAlignItems),
                    flex: frame?.layoutMode === 'VERTICAL'
                        ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                        : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                } : {
                    ...child.styles ?? {},
                    flex: frame?.layoutMode === 'VERTICAL'
                        ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                        : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                },
                mainFrame: {
                    base: frame?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
                    id: sanitizeFullColon(`${name ?? ''}_frame`),
                    styles: {
                        spaceValue: (isLastChild && !isLoopElement) ? 0 : frame?.itemSpacing ?? 0,
                        paddingLeft: child?.paddingLeft,
                        paddingRight: child?.paddingRight,
                        paddingTop: child?.paddingTop,
                        paddingBottom: child?.paddingBottom,
                        flexWrap: transformLayoutWrap(child?.layoutWrap),
                        flex: frame?.layoutMode === 'VERTICAL'
                            ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                            : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                        justifyContent: frame?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.counterAxisAlignItems)
                            : transformLayoutAxisAlign(child?.primaryAxisAlignItems),
                        alignItems: frame?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.primaryAxisAlignItems)
                            : transformLayoutAxisAlign(child?.counterAxisAlignItems),
                        width: getSize(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width),
                        height: getSize(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height),
                        ...getContainerLikeStyles(child, backGroundImage),
                    }
                }
            };
            const f = await transformFrameChildren({
                frame: mChild,
                module,
                isLoopElement: isLoop ? true : isLoopElement,
                token,
                srcPath,
                figFile
            });
            children.push(f);
        } else {
            const extendFrame = `i${fChildren[i - 1]?.id}_${fChildren[i - 1]?.name}`
                .replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const name = `i${child?.id}_${child?.name}`
                .replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const sc = {
                ...child,
                name,
                module,
                isLoopElement,
                style: {
                    ...child?.style ?? {},
                    [frame?.layoutMode === 'HORIZONTAL' ? 'marginRight' : 'marginBottom']: frame?.itemSpacing ?? 0,
                    flex: frame?.layoutMode === 'VERTICAL'
                        ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                        : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                },
                extendFrame: i > 0 ? `./${extendFrame}.yml` : undefined,
                childFrame: {
                    base: frame?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
                    id: sanitizeFullColon(`${name ?? ''}_frame`),
                    styles: {
                        flexWrap: transformLayoutWrap(frame?.layoutWrap),
                        flex: frame?.layoutMode === 'VERTICAL'
                            ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                            : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                    }
                }
            }
            children.push(sc);
        }
    }
    return {...frame, children};
}

/**
 *
 * @param document
 * @param token
 * @param figFile
 * @param srcPath
 * @return  {Promise<*[]>}
 */
export async function getPagesAndTraverseChildren({document, token, figFile, srcPath}) {
    const replaceModule = v => justString(v).replaceAll(/(\[.*])/g, '').trim();
    const replaceName = t => justString(t).replaceAll(/(.*\[)|(].*)/g, '').trim();
    const pages = [];
    const sPages = document?.children?.filter(x => x?.visible ?? true);
    for (const page of sPages ?? []) {
        const nAry = replaceModule(page?.name)?.split('_')
        const type = nAry.pop();
        const name = nAry.join('');
        const module = /*replaceName(page?.name).includes('/') ? */replaceName(page?.name)/* : null;*/
        id2nameMapCache[page?.id] = {name, type, module}
        const a = {token, figFile, srcPath, imageRef: getImageRef(page?.fills)}
        const backGroundImage = await getFigmaImagePath(a)
        const b = {frame: page, module, isLoopElement: false, token, srcPath, figFile};
        const pageChildren = await transformFrameChildren(b);
        pages.push({
            ...page,
            name: replaceModule(page?.name),
            type: maybeRandomName(page?.type),
            module,
            children: pageChildren?.children ?? [],
            mainFrame: {
                base: page?.layoutMode === 'VERTICAL' ? 'column.start.stack' : 'row.start.stack',
                id: sanitizeFullColon(`${replaceModule(page?.name)}_frame`),
                styles: {
                    paddingLeft: page?.paddingLeft,
                    paddingRight: page?.paddingRight,
                    paddingTop: page?.paddingTop,
                    paddingBottom: page?.paddingBottom,
                    minHeight: '100vh',
                    // maxWidth: page?.absoluteRenderBounds?.width,
                    // margin: 'auto',
                    ...getContainerLikeStyles(page, backGroundImage),
                }
            }
        });
    }
    return pages;
}

function getColor(source) {
    return itOrEmptyList(source)
        .filter(x => x?.type === 'SOLID')
        .map(y => `rgba(${y?.color?.r * 255},${y?.color?.g * 255},${y?.color?.b * 255},${y?.color?.a * 255})`)
        .shift();
}

function getBorderStyles(child) {
    if (itOrEmptyList(child?.strokes).length === 0) {
        return {};
    }
    return {
        borderTopWidth: child?.individualStrokeWeights?.top ?? child?.strokeWeight,
        borderLeftWidth: child?.individualStrokeWeights?.left ?? child?.strokeWeight,
        borderRightWidth: child?.individualStrokeWeights?.right ?? child?.strokeWeight,
        borderBottomWidth: child?.individualStrokeWeights?.bottom ?? child?.strokeWeight,
        borderColor: getColor(child?.strokes),
        borderStyle: itOrEmptyList(child?.strokeDashes).length > 0 ? 'dashed' : 'solid'
    }
}

/**
 *
 * @param child
 * @param backGroundImage
 * @return {object}
 */
function getContainerLikeStyles(child, backGroundImage) {
    return {
        ...child?.style ?? {},
        borderRadius: child?.cornerRadius,
        borderTopLeftRadius: child?.rectangleCornerRadii?.[0],
        borderTopRightRadius: child?.rectangleCornerRadii?.[1],
        borderBottomRightRadius: child?.rectangleCornerRadii?.[2],
        borderBottomLeftRadius: child?.rectangleCornerRadii?.[3],
        backgroundColor: getColor(child?.fills),
        backgroundSize: backGroundImage ? 'cover' : undefined,
        backgroundPosition: backGroundImage ? 'center' : undefined,
        backgroundImage: backGroundImage ? `url("${backGroundImage}")` : undefined,
        ...getBorderStyles(child)
    }
}

function getSizeStyles(child) {
    return {
        width: getSize(child?.layoutSizingHorizontal, child?.absoluteBoundingBox?.width),
        height: getSize(child?.layoutSizingVertical, child?.absoluteBoundingBox?.height),
    }
}

function sanitizedNameForLoopElement(child) {
    const id = child?.id ?? '';
    const name = child?.name;
    return `${name}`.trim()
        .replaceAll('_text', '')
        .replaceAll('_image', '')
        .replaceAll(`i${id?.replaceAll(':', '_')}_`, '')
}

async function createTextComponent(filename, child) {
    const yamlData = yaml.dump({
        component: {
            base: 'text',
            modifier: {
                extend: child?.extendFrame,
                styles: {
                    ...child?.style ?? {},
                    ...getSizeStyles(child),
                    color: getColor(child?.fills),
                    fontStyle: child?.style?.italic ? 'italic' : undefined,
                    textAlign: child?.style?.textAlignHorizontal === 'LEFT'
                        ? 'start'
                        : child?.style?.textAlignHorizontal === 'CENTER'
                            ? 'center'
                            : child?.style?.textAlignHorizontal === 'RIGHT'
                                ? 'end'
                                : undefined,
                },
                props: {
                    children: child?.isLoopElement ? `inputs.loopElement.${sanitizedNameForLoopElement(child)}??value` : 'states.value',
                    id: sanitizeFullColon(`${child?.name}`)
                },
                states: {
                    value: child?.characters,
                },
                frame: child?.childFrame,
            }
        }
    })
    await writeFile(filename, yamlData);
}

async function createTextInputComponent(filename, child, type = 'text') {
    const yamlData = yaml.dump({
        component: {
            base: 'input',
            modifier: {
                extend: child?.extendFrame,
                styles: {
                    ...getContainerLikeStyles(child, null),
                    ...getSizeStyles(child),
                    borderColor: 'states.borderColor',
                    fontSize: 15,
                    padding: '0 8px'
                },
                props: {
                    type: 'states.inputType',
                    value: 'states.value',
                    onChange: 'logics.onTextChange',
                    placeholder: 'Type here',
                    id: sanitizeFullColon(`${child?.name}`)
                },
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
                states: {
                    value: '',
                    inputType: type,
                    borderColor: getColor(child?.strokes),
                },
                frame: child?.childFrame,
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

async function createContainerComponent(filename, child, backgroundImage) {
    const yamlData = yaml.dump({
        component: {
            base: 'rectangle',
            modifier: {
                props: {id: sanitizeFullColon(`${child?.name}`)},
                extend: child?.extendFrame,
                styles: {
                    ...getContainerLikeStyles(child, backgroundImage),
                    ...getSizeStyles(child)
                },
                frame: child?.childFrame,
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

async function handleNavigations({srcPath, child}) {
    const route = id2nameMapCache[child?.transitionNodeID];

    const logicPath = resolve(join(srcPath, 'modules', child?.module ?? '', 'logics', `${child?.name}.mjs`));

    await ensurePathExist(logicPath);
    await ensureFileExist(logicPath);
    // const logicFileBuffer = await readFile(logicPath);
    const logicImportFile = await import(logicPath);

    const importSetRouteRegex = /import\s*\{\s*setCurrentRoute\s*}\s*from\s*.*routing.mjs['"]\s*;*\s*/g;
    const importSetRouteMixerRegex = /setCurrentRoute\s*,|,\s*setCurrentRoute/g;
    const lNwS = (await readFile(logicPath)).toString()
        .replace(importSetRouteMixerRegex, '')
        .replace(importSetRouteRegex, '')
    const modulePaths = child?.module?.split('/')?.filter(x => x !== '')?.map(() => '../')?.join('') ?? '';

    await writeFile(logicPath, `import {setCurrentRoute} from '../${modulePaths}../../routing.mjs';\n${lNwS}`);

    const setRouteRegex = /setCurrentRoute\s*\(\s*.*\s*\)\s*;*\s*/g;
    const onClickSignatureRegex = /onClick\s*\(\s*data\s*\)\s*\{/g;

    const onClickFnString = logicImportFile?.onClick?.toString() ?? '';
    if (onClickFnString && onClickFnString !== '') {
        let newOnClickString;
        if (setRouteRegex.test(onClickFnString)) {
            newOnClickString = onClickFnString
                .replaceAll(setRouteRegex, `setCurrentRoute(${JSON.stringify(route)});\n   `);
        } else {
            newOnClickString = onClickFnString
                .replaceAll(onClickSignatureRegex, `onClick(data) {\n    setCurrentRoute(${JSON.stringify(route)});`);
        }
        // const newOnClickString = onClickFnString
        //     .replaceAll(setRouteRegex, `setCurrentRoute(${JSON.stringify(route)});\n   `);
        // .replaceAll(onClickSignatureRegex, `onClick(data) {\n    setCurrentRoute(${JSON.stringify(route)});`);
        const logicFileNwString = (await readFile(logicPath)).toString()
            .replace(onClickFnString, newOnClickString)
        await writeFile(logicPath, logicFileNwString);
    } else {
        await appendFile(logicPath, `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function onClick(data) {
    setCurrentRoute(${JSON.stringify(route)});
    // TODO: Implement the logic
}`);
    }
}

async function createConditionComponent({filename, child, srcPath}) {
    const baseType = (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
    if (baseType === 'button' && id2nameMapCache[child?.transitionNodeID]) {
        await handleNavigations({srcPath, child});
    }
    const last = child?.children?.[child?.children?.length - 1];
    const yamlData = yaml.dump({
        condition: {
            modifier: {
                extend: child?.extendFrame,
                styles: child.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: baseType === 'button' ? 'logics.onClick' : undefined
                },
                left: last ? `./${last?.name}.yml` : undefined,
                frame: {
                    base: child?.mainFrame?.base,
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}_frame'` : `${child?.name}_frame`),
                    styles: {
                        ...child?.mainFrame?.styles,
                        cursor: baseType === 'button' ? 'pointer' : undefined,
                        overflow: 'auto',
                    }
                },
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

function getBaseType(child) {
    return (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
}

async function createLoopComponent(filename, child) {
    const last = child?.children?.[0];
    const yamlData = yaml.dump({
        loop: {
            modifier: {
                extend: child?.extendFrame,
                styles: {
                    ...child.styles,
                    overflow: 'auto'
                },
                props: {
                    id: sanitizeFullColon(`${child?.name}`)
                },
                feed: last ? `./${last?.name}.yml` : undefined,
                frame: {
                    base: child?.mainFrame?.base,
                    id: child?.mainFrame?.id,
                    styles: {
                        ...child?.mainFrame?.styles,
                        overflow: 'auto',
                    }
                },
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

function getImageRef(source) {
    return itOrEmptyList(source)
        .filter(x => x?.type === 'IMAGE')
        .map(y => y?.imageRef)
        .shift();
}

async function createImageComponent({filename, child, token, srcPath, figFile}) {
    const srcUrl = await getFigmaImagePath({
        token,
        figFile,
        srcPath,
        imageRef: getImageRef(child?.fills),
        child,
    });
    const yamlData = dumpImageYaml({srcUrl, child});
    await writeFile(filename, yamlData);
}

async function handleRectangleComponent({child, filename, srcPath, token, figFile}) {
    const baseType = (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
    if (baseType === 'input') {
        const inputType = `${child?.name}`.toLowerCase()?.includes('password') ? 'password' : undefined;
        await createTextInputComponent(filename, child, inputType);
    }
        // else if (baseType === 'password') {
        //     await createTextInputComponent(filename, child, 'password');
    // }
    else if (baseType === 'image') {
        await createImageComponent({filename, child, srcPath, token, figFile});
    } else {
        const backGroundImage = await getFigmaImagePath({
            token,
            figFile,
            srcPath,
            imageRef: getImageRef(child?.fills),
            child,
        })
        await createContainerComponent(filename, child, backGroundImage)
    }
}

function dumpImageYaml({child, srcUrl}) {
    return yaml.dump({
        component: {
            base: 'image',
            modifier: {
                props: {
                    id: sanitizeFullColon(`${child?.name}`),
                    alt: child?.name,
                    src: child?.isLoopElement ? `inputs.loopElement.${sanitizedNameForLoopElement(child)}??'${srcUrl}'` : srcUrl,
                },
                extend: child?.extendFrame,
                styles: {
                    ...getContainerLikeStyles(child, null),
                    ...getSizeStyles(child),
                    objectFit: 'cover'
                },
                frame: child?.childFrame,
            }
        }
    }, undefined);
}

async function createVectorComponent({filename, child, srcPath, token, figFile}) {
    child = structuredClone({
        ...child,
        fills: undefined,
        strokes: undefined,
        strokeWeight: undefined
    })
    const srcUrl = await getFigmaImagePath({
        token,
        figFile,
        format: 'svg',
        srcPath,
        imageRef: sanitizeFullColon(`${child?.name}`),
        child,
    });
    const yamlData = dumpImageYaml({srcUrl, child})
    await writeFile(filename, yamlData);
}

export async function walkFrameChildren({children, srcPath, token, figFile}) {
    for (const element of children ?? []) {
        const child = structuredClone(element);
        const path = resolve(join(srcPath, 'modules', child?.module ?? ''));
        const filename = resolve(join(srcPath, 'modules', child?.module ?? '', `${child?.name}.yml`));
        await ensurePathExist(path);
        await ensureFileExist(filename);
        if (child?.type === 'TEXT') {
            await createTextComponent(filename, structuredClone(child));
        } else if (child?.type === 'RECTANGLE') {
            const data = {child, srcPath, figFile, token, filename};
            await handleRectangleComponent(structuredClone(data));
        } else if (child?.type === 'VECTOR') {
            await createVectorComponent(
                {filename, child, srcPath, token, figFile});
        } else if (child?.type === 'FRAME') {
            const baseType = (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
            if (baseType === 'loop') {
                await createLoopComponent(filename, structuredClone(child));
                await walkFrameChildren(structuredClone({children: child?.children, srcPath, token, figFile}));
            } else {
                await createConditionComponent({filename, child: structuredClone(child), srcPath});
                await walkFrameChildren(structuredClone({children: child?.children, srcPath, token, figFile}));
            }
        } else {
            const backGroundImage = await getFigmaImagePath({
                token,
                figFile,
                srcPath,
                imageRef: getImageRef(child?.fills),
                child,
            })
            await createContainerComponent(filename, structuredClone(child), backGroundImage);
        }
    }
}

