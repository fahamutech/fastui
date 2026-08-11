import axios from "axios";
import {
    ensureFileExist,
    ensurePathExist, firstUpperCaseRestSmall,
    itOrEmptyList,
    justString,
    maybeRandomName,
    sanitizeFullColon
} from "../../utils/index.mjs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {copyFile, readdir, readFile, stat, writeFile} from "node:fs/promises";
import * as yaml from "js-yaml"
import {createWriteStream} from "node:fs";
import {randomUUID} from "node:crypto";
import {resolvePrototypeRoute, routeFromSurfaceName} from "../navigation.mjs";

const id2nameMapCache = {};
const sharedComponentMapCache = {};
let figmaAssetDownloadsDisabled = false;
let figmaAssetWarningWritten = false;
let figmaAssetDownloadsEnabled = false;

const clearObject = value => Object.keys(value).forEach(key => delete value[key]);

function generatedNodeName(node, id = node?.id) {
    return `i${id}_${firstUpperCaseRestSmall(node?.name)}`.replaceAll(/[^a-zA-Z0-9]/ig, '_');
}

function walkFigmaNodes(node, visit) {
    if (!node) return;
    visit(node);
    for (const child of node?.children ?? []) walkFigmaNodes(child, visit);
}

function collectSharedComponents(document, components = {}) {
    const definitions = new Map();
    const instances = new Map();
    walkFigmaNodes(document, node => {
        if (node?.type === 'COMPONENT' && node?.id) definitions.set(node.id, node);
        if (node?.type === 'INSTANCE' && node?.componentId && !instances.has(node.componentId)) {
            instances.set(node.componentId, node);
        }
    });
    for (const [componentId, instance] of instances) {
        if (!definitions.has(componentId)) {
            definitions.set(componentId, {
                ...structuredClone(instance),
                id: componentId,
                name: components?.[componentId]?.name ?? instance?.name,
                type: 'COMPONENT'
            });
        }
    }
    for (const [componentId, node] of definitions) {
        sharedComponentMapCache[componentId] = {name: generatedNodeName(node, componentId), node};
    }
    return [...definitions.entries()];
}

function sharedComponentRef({filename, child, srcPath}) {
    if (child?.type !== 'INSTANCE' || !child?.componentId) return undefined;
    const shared = sharedComponentMapCache[child.componentId];
    if (!shared) return undefined;
    let ref = relative(dirname(filename), resolve(join(srcPath, 'modules', 'shared', 'common', `${shared.name}.yml`))).split(sep).join('/');
    if (!ref.startsWith('.')) ref = `./${ref}`;
    return ref;
}

export function getFigmaCachePath(figFile, cachePath) {
    if (cachePath) return resolve(cachePath);
    const safeFileKey = `${figFile ?? 'figma-file'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    return resolve(join('.fastui', 'figma', `${safeFileKey}.json`));
}

/**
 *
 * @param token
 * @param figFile
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
        throw new Error(`Unable to download Figma file${status ? ` (HTTP ${status})` : ''}: ${error?.response?.data?.message ?? error?.message ?? 'request failed'}`);
    }
    await ensurePathExist(dirname(localPath));
    await writeFile(localPath, JSON.stringify(data, null, 2));
    return data;
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

async function getFigmaImagePath({token, figFile, srcPath, imageRef, child, format}) {
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
        if (!figmaAssetDownloadsEnabled || !token) return undefined;
        if (figmaAssetDownloadsDisabled) return undefined;
        try {
            const url = await fetchFigmaImagesUrl(
                {token, format, figFile, nodeId, imageRef});
            if (url) {
                const {contentExtension} = await downloadImage(url, imageRef, folderPath);
                const imageName = `${imageRef}.${contentExtension ?? 'png'}`;
                return `asset://figma/${imageName}`;
            }
        } catch (error) {
            if (error?.response?.status === 429) figmaAssetDownloadsDisabled = true;
            if (!figmaAssetWarningWritten) {
                const status = error?.response?.status;
                console.warn(`WARN : Figma asset download unavailable${status ? ` (HTTP ${status})` : ''}; continuing with cached assets and specs.`);
                figmaAssetWarningWritten = true;
            }
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

function transformLayoutAxisAlign(counterAxisAlignItems) {
    switch (counterAxisAlignItems) {
        case 'MIN':
            return 'flex-start';
        case 'MAX':
            return 'flex-end';
        case  'CENTER':
            return 'center';
        case 'STRETCH':
            return 'stretch';
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
    const parentBaseType = `${frame?.name?.split('_')?.pop()}`.trim().toLowerCase();
    const isCondition = parentBaseType === 'condition';
    let fChildren = frame?.children?.filter(x => (x?.visible ?? true) || isCondition) ?? [];
    if (isCondition) {
        fChildren = fChildren.map(x => ({...x, visible: true, absoluteRenderBounds: x?.absoluteBoundingBox}));
    }
    for (let i = 0; i < fChildren?.length; i++) {
        const child = fChildren[i] ?? {};
        if (child?.type === 'FRAME' || child?.type === 'INSTANCE' || child?.type === 'COMPONENT') {
            const backGroundImage = await getFigmaImagePath({
                token,
                figFile,
                srcPath,
                imageRef: getImageRef(child?.fills),
                child: undefined
            })
            const baseType = getBaseType(child);
            const isLoop = baseType === 'loop';
            if (isLoop /*&& child?.children?.length > 1*/) {
                child.childrenData = child?.children?.map(x => ({_key: x?.id ?? randomUUID().toString()}));
                child.children = [child?.children?.[0]];
            }
            const extendFrame =
                isCondition && i === 1
                    ? undefined
                    :
                    `i${fChildren[i - 1]?.id}_${firstUpperCaseRestSmall(fChildren[i - 1]?.name)}`.replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const name = `i${child?.id}_${firstUpperCaseRestSmall(child?.name)}`
                .replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const mChild = {
                ...child,
                name,
                module,
                extendFrame: i > 0 && extendFrame ? `./${extendFrame}.yml` : undefined,
                isLoopElement,
                styles: isLoop ? {
                    display: 'flex',
                    color: 'transparent',
                    flexDirection: child?.layoutMode === 'VERTICAL' ? 'column' : 'row',
                    flexWrap: transformLayoutWrap(child?.layoutWrap),
                    justifyContent: transformLayoutAxisAlign(frame?.primaryAxisAlignItems),
                    alignItems: transformLayoutAxisAlign(frame?.counterAxisAlignItems),
                    // flex: 1
                    flex: frame?.layoutMode === 'VERTICAL'
                        ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                        : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                } : {
                    ...child.styles ?? {},
                    boxShadow: getDropShadowEffect(child),
                    backdropFilter: getBackgroundBlurEffect(child),
                    WebkitBackdropFilter: getBackgroundBlurEffect(child),
                    filter: getLayerBlurEffect(child),
                    flex: 1, // i===fChildren?.length-1?undefined:1,
                    // flex: frame?.layoutMode === 'VERTICAL'
                    //     ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                    //     : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                },
                mainFrame: {
                    base: frame?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
                    id: sanitizeFullColon(`${name ?? ''}_frame`),
                    styles: {
                        spaceValue: i > 0 ? frame?.itemSpacing ?? 0 : 0,
                        paddingLeft: child?.paddingLeft,
                        paddingRight: child?.paddingRight,
                        paddingTop: child?.paddingTop,
                        paddingBottom: child?.paddingBottom,
                        flexWrap: transformLayoutWrap(child?.layoutWrap),
                        flex: frame?.layoutMode === 'VERTICAL'
                            ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                            : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                        justifyContent: transformLayoutAxisAlign(frame?.primaryAxisAlignItems),
                        alignItems: transformLayoutAxisAlign(frame?.counterAxisAlignItems),
                        width: getSize(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width)
                            ?? (frame?.layoutMode === 'VERTICAL' && child?.layoutAlign === 'STRETCH' ? '100%' : undefined),
                        height: getSize(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height)
                            ?? (frame?.layoutMode !== 'VERTICAL' && child?.layoutAlign === 'STRETCH' ? '100%' : undefined),
                        fallbackWidth: child?.layoutSizingHorizontal === 'FILL' || child?.layoutAlign === 'STRETCH'
                            ? child?.absoluteRenderBounds?.width
                            : undefined,
                        fallbackHeight: child?.layoutSizingVertical === 'FILL' || child?.layoutAlign === 'STRETCH'
                            ? child?.absoluteRenderBounds?.height
                            : undefined,
                        ...getContainerLikeStyles(child, backGroundImage),
                        boxShadow: getDropShadowEffect(child),
                        backdropFilter: getBackgroundBlurEffect(child),
                        WebkitBackdropFilter: getBackgroundBlurEffect(child),
                        filter: getLayerBlurEffect(child),
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
            const extendFrame =
                isCondition && i === 1
                    ? undefined
                    :
                    `i${fChildren[i - 1]?.id}_${firstUpperCaseRestSmall(fChildren[i - 1]?.name)}`.replaceAll(/[^a-zA-Z0-9]/ig, '_');
            const name = `i${child?.id}_${firstUpperCaseRestSmall(child?.name)}`
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
                    backdropFilter: getBackgroundBlurEffect(child),
                    WebkitBackdropFilter: getBackgroundBlurEffect(child),
                    filter: getLayerBlurEffect(child),
                },
                extendFrame: i > 0 && extendFrame ? `./${extendFrame}.yml` : undefined,
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
export async function getPagesAndTraverseChildren({document, components, token, figFile, srcPath, downloadAssets = false}) {
    const replaceModule = v => justString(v).replaceAll(/(\[.*])/g, '').trim();
    const replaceName = t => justString(t).replaceAll(/(.*\[)|(].*)/g, '').trim();
    const pages = [];
    clearObject(id2nameMapCache);
    clearObject(sharedComponentMapCache);
    figmaAssetDownloadsDisabled = false;
    figmaAssetWarningWritten = false;
    figmaAssetDownloadsEnabled = downloadAssets;
    const sharedDefinitions = collectSharedComponents(document, components);
    const sPages = document?.children?.filter(x => (x?.visible ?? true) && x?.type === 'FRAME');
    for (const page of sPages ?? []) {
        const surface = routeFromSurfaceName(replaceModule(page?.name));
        id2nameMapCache[page?.id] = {
            ...surface,
            module: replaceName(page?.name),
            barrierDismissible: page?.overlayBackgroundInteraction === 'CLOSE_ON_CLICK_OUTSIDE',
            overlayPositionType: page?.overlayPositionType
        };
    }
    for (const page of sPages ?? []) {
        const surface = id2nameMapCache[page?.id];
        const module = /*replaceName(page?.name).includes('/') ? */replaceName(page?.name)/* : null;*/
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
                    height: '100vh',
                    width: '100vw',
                    fallbackWidth: page?.absoluteBoundingBox?.width,
                    fallbackHeight: page?.absoluteBoundingBox?.height,
                    // maxWidth: page?.absoluteRenderBounds?.width,
                    // margin: 'auto',
                    ...getContainerLikeStyles(page, backGroundImage),
                }
            }
        });
    }
    for (const [componentId, component] of sharedDefinitions) {
        const shared = sharedComponentMapCache[componentId];
        const module = 'shared/common';
        const root = {
            ...structuredClone(component),
            type: 'COMPONENT',
            name: shared.name,
            module,
            extendFrame: undefined,
            mainFrame: {
                base: component?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
                id: sanitizeFullColon(`${shared.name}_frame`),
                styles: {
                    paddingLeft: component?.paddingLeft,
                    paddingRight: component?.paddingRight,
                    paddingTop: component?.paddingTop,
                    paddingBottom: component?.paddingBottom,
                    ...getContainerLikeStyles(component)
                }
            }
        };
        const transformed = await transformFrameChildren({frame: root, module, isLoopElement: false, token, figFile, srcPath});
        pages.push({...root, children: transformed?.children ?? []});
    }
    return pages;
}

function getBackgroundBlurEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'BACKGROUND_BLUR');
    return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
}

function getDropShadowEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'DROP_SHADOW')
        ?? itOrEmptyList(child?.effects).find(x => x?.type === 'INNER_SHADOW');
    const inner = effect?.type === 'INNER_SHADOW' ? 'inset' : '';
    const x = effect?.offset?.x ?? 0;
    const y = effect?.offset?.y ?? 0;
    const radius = effect?.radius ?? 0;
    const spread = effect?.spread ?? 0;
    const color = getColor([{type: 'SOLID', color: {...child?.color ?? {}}}]);
    return effect?.visible
        ? `${inner} ${x}px ${y}px ${radius}px ${spread}px ${color}`.trim()
        : undefined;
}

function getLayerBlurEffect(child) {
    const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'LAYER_BLUR');
    return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
}

function getColor(source) {
    const getAlpha = value => Math.max(0, Math.min(1,
        Number(value?.color?.a ?? 1) * Number(value?.opacity ?? 1)
    ));
    return itOrEmptyList(source)
        .filter(x => x?.type === 'SOLID')
        .map(y => `rgba(${y?.color?.r * 255},${y?.color?.g * 255},${y?.color?.b * 255},${getAlpha(y)})`)
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
    // console.log(`${child?.name}`.endsWith('_icon')?undefined:getSize(child?.layoutSizingHorizontal, child?.absoluteBoundingBox?.width)??'-',child?.name);
    return {
        width: `${child?.name}`.endsWith('_icon') ? undefined : getSize(child?.layoutSizingHorizontal, child?.absoluteBoundingBox?.width),
        height: getSize(child?.layoutSizingVertical, child?.absoluteBoundingBox?.height),
    }
}

function sanitizedNameForLoopElement(child) {
    const id = child?.id ?? '';
    const name = child?.name;
    const b = `${name}`.trim()
        // .replaceAll('_text', '')
        // .replaceAll('_icon', '')
        // .replaceAll('_image', '')
        .replaceAll(`i${id?.replaceAll(':', '_')}_`, '');
    const chunks = b.split('_');
    if (chunks.length > 1) {
        chunks.pop();
    }
    return chunks.map(x => `${x.toLowerCase()}`).join('_');
}

async function createTextComponent(filename, child) {
    const yamlData = yaml.dump({
        component: {
            base: 'text',
            modifier: {
                compose: child?.extendFrame,
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
                    children: child?.isLoopElement
                        ? `inputs.loopElement.${sanitizedNameForLoopElement(child)}??${JSON.stringify(child?.characters ?? '')}`
                        : child?.characters,
                    id: sanitizeFullColon(`${child?.name}`)
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
            base: 'container',
            modifier: {
                compose: child?.extendFrame,
                styles: {
                    ...getContainerLikeStyles(child, null),
                    ...getSizeStyles(child),
                    borderColor: 'states.borderColor',
                    fontSize: 15,
                    padding: '0 8px'
                },
                props: {
                    control: 'input',
                    type: 'states.inputType',
                    value: 'states.value',
                    onChange: {action: 'state.set', target: 'value', value: 'event.value'},
                    placeholder: 'Type here',
                    id: sanitizeFullColon(`${child?.name}`)
                },
                states: {
                    value: '',
                    inputType: type,
                    borderColor: getColor(child?.strokes) ?? 'transparent',
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
            base: 'container',
            modifier: {
                props: {id: sanitizeFullColon(`${child?.name}`)},
                compose: child?.extendFrame,
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

function interactionBehavior(child) {
    const actions = (child?.interactions ?? []).flatMap(interaction => interaction?.actions ?? []).filter(Boolean);
    const eventActions = [];
    const states = {};
    const navigationKinds = new Set(['NAVIGATE', 'OVERLAY', 'SWAP', 'SWAP_OVERLAY', 'BACK', 'CLOSE', 'CLOSE_OVERLAY']);
    const hasNavigation = actions.some(action => navigationKinds.has(`${action?.navigation ?? action?.type ?? ''}`.toUpperCase())
        || (`${action?.type ?? ''}`.toUpperCase() === 'NODE' && action?.destinationId));
    if (hasNavigation) {
        eventActions.push({action: 'navigation.open', ...resolvePrototypeRoute(child, id2nameMapCache)});
    }
    for (const action of actions) {
        const kind = `${action?.type ?? action?.action ?? ''}`.toUpperCase();
        if (kind === 'CHANGE_TO') {
            states.variant = child?.id ?? null;
            eventActions.push({action: 'state.set', target: 'variant', value: action?.destinationId ?? action?.value});
        }
        if (kind === 'SET_VARIABLE') {
            const target = `variable_${`${action?.variableId ?? action?.variableName ?? 'value'}`.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            const value = action?.variableValue?.value ?? action?.variableValue ?? action?.value ?? null;
            states[target] = action?.initialValue ?? null;
            eventActions.push({action: 'state.set', target, value});
        }
    }
    return {
        states,
        onClick: eventActions.length === 0
            ? undefined
            : eventActions.length === 1
                ? eventActions[0]
                : {action: 'sequence', actions: eventActions}
    };
}

async function createConditionComponent({filename, child, srcPath}) {
    const baseType = (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
    const behavior = interactionBehavior(child);

    let isCondition = false;
    let leftName, rightName;
    if (baseType === 'condition') {
        isCondition = true;
        rightName = child?.children?.[0]?.name;
        leftName = child?.children?.[1]?.name;
    }

    const last = child?.children?.[child?.children?.length - 1];
    const yamlData = yaml.dump({
        condition: {
            modifier: {
                ref: sharedComponentRef({filename, child, srcPath}),
                compose: child?.extendFrame,
                styles: child.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: behavior.onClick
                },
                left: (isCondition && leftName)
                    ? `./${leftName}.yml`
                    : (last ? `./${last?.name}.yml` : undefined),
                right: (isCondition && rightName)
                    ? `./${rightName}.yml`
                    : undefined,
                states: isCondition || Object.keys(behavior.states).length > 0 ? {
                    ...(isCondition ? {condition: false} : {}),
                    ...behavior.states,
                } : undefined,
                frame: {
                    base: child?.mainFrame?.base,
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}_frame'` : `${child?.name}_frame`),
                    styles: {
                        ...child?.mainFrame?.styles,
                        cursor: baseType === 'button' ? 'pointer' : undefined,
                        overflow: child?.clipsContent ? 'hidden' : undefined,
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

async function createLoopComponent({filename, child, srcPath}) {
    child = structuredClone(child);
    const last = child?.children?.[0];
    const yamlData = yaml.dump({
        loop: {
            modifier: {
                ref: sharedComponentRef({filename, child, srcPath}),
                compose: child?.extendFrame,
                styles: {
                    ...child.styles,
                    overflow: child?.clipsContent ? 'hidden' : undefined
                },
                states: {data: child.childrenData ?? []},
                props: {
                    id: sanitizeFullColon(`${child?.name}`)
                },
                feed: last ? `./${last?.name}.yml` : undefined,
                frame: {
                    base: child?.mainFrame?.base,
                    id: child?.mainFrame?.id,
                    styles: {
                        ...child?.mainFrame?.styles,
                        overflow: child?.clipsContent ? 'hidden' : undefined,
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

function dumpImageYaml({child, srcUrl, objectFit = 'cover'}) {
    return yaml.dump({
        component: {
            base: 'image',
            modifier: {
                props: {
                    id: sanitizeFullColon(`${child?.name}`),
                    alt: child?.name,
                    src: child?.isLoopElement ? `inputs.loopElement.${sanitizedNameForLoopElement(child)}??${srcUrl ?? ''}` : srcUrl ?? '',
                },
                compose: child?.extendFrame,
                styles: {
                    ...getContainerLikeStyles(child, null),
                    ...getSizeStyles(child),
                    objectFit
                    // objectFit: `${child?.name}`.endsWith('_icon')?undefined:'cover'
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
    const yamlData = dumpImageYaml({srcUrl, child, objectFit: 'none'})
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
        } else if (child?.type === 'FRAME' || child?.type === 'INSTANCE' || child?.type === 'COMPONENT') {
            const baseType = (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
            if (baseType === 'loop') {
                await createLoopComponent({filename, child, srcPath});
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
