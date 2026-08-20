/**
 * Orchestrates one Figma -> spec translation run: walks every page/frame,
 * annotates each child with its own/sibling layout axes (mainFrame/wrapper),
 * and hands each annotated node to spec-writer.mjs to serialize.
 *
 * Owns the two caches (`routeLookup`, `sharedComponentMap`) that need to
 * survive across the whole document walk - and, per the existing public API,
 * across the separate getPagesAndTraverseChildren() then walkFrameChildren()
 * calls a caller makes for one translation run. They are reset at the start
 * of every getPagesAndTraverseChildren() call.
 */
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {ensureFileExist, ensurePathExist} from '../../shared/fs.mjs';
import {maybeRandomName, sanitizeFullColon} from '../../shared/fn.mjs';
import {routeFromSurfaceName} from '../../shared/routing.mjs';
import {getBaseType, generatedNodeName, moduleFromName, sanitizedNameForLoopElement, stripModuleSuffix, textStateBinding, vectorResourceName} from './naming.mjs';
import {getContainerLikeStyles, getSize, isRepeatType, transformLayoutAxisAlign, transformLayoutWrap, getImageRef} from './layout.mjs';
import {getBackgroundBlurEffect, getDropShadowEffect, getLayerBlurEffect} from './effects.mjs';
import {getColor} from './color.mjs';
import {collectSharedComponents} from './shared-components.mjs';
import {configureAssetDownloads, getFigmaImagePath} from './assets.mjs';
import {
    createContainerComponent,
    createConditionComponent,
    createFrameComponent,
    createInstanceComponent,
    createLoopComponent,
    createTextComponent,
    createVectorComponent,
    handleRectangleComponent,
} from './spec-writer.mjs';

const DEFAULT_PAGE_MODULE = 'presentation/pages';

async function loopRowData(node, {token, figFile, srcPath}) {
    const row = {_key: node?.id ?? randomUUID().toString()};
    const visit = async child => {
        const key = sanitizedNameForLoopElement(child);
        if (child?.type === 'TEXT') {
            if (key) row[key] = `${child?.characters ?? ''}`;
        }
        const imageRef = child?.type === 'VECTOR'
            ? vectorResourceName(child)
            : getBaseType(child) === 'image'
                ? getImageRef(child?.fills)
                : undefined;
        if (key && imageRef) {
            row[key] = await getFigmaImagePath({
                token, figFile, srcPath, imageRef, child,
                format: child?.type === 'VECTOR' ? 'svg' : undefined,
            }) ?? '';
        }
        await Promise.all((child?.children ?? []).map(visit));
    };
    await visit(node);
    return row;
}

let routeLookup = {};
let sharedComponentMap = {};

/**
 * Annotates one frame's direct children with the layout metadata every spec
 * writer needs (own axis + styles under `mainFrame`/`childFrame`), recursing
 * into container-like children first. Composition itself (which children
 * compose which parent) is expressed later, at spec-write time, purely from
 * each parent's own `children` array (see spec-writer.mjs).
 */
async function transformFrameChildren({frame, module, isLoopElement, token, figFile, srcPath}) {
    const children = [];
    const isCondition = getBaseType(frame) === 'condition';
    let fChildren = frame?.children?.filter(x => (x?.visible ?? true) || isCondition) ?? [];
    if (isCondition) {
        fChildren = fChildren.map(x => ({...x, visible: true, absoluteRenderBounds: x?.absoluteBoundingBox}));
    }
    for (let i = 0; i < fChildren?.length; i++) {
        const child = fChildren[i] ?? {};
        const stateText = child?.type === 'TEXT' ? textStateBinding(child) : null;
        const name = generatedNodeName(child);

        if (child?.type === 'FRAME' || child?.type === 'INSTANCE' || child?.type === 'COMPONENT') {
            const backGroundImage = await getFigmaImagePath({
                token, figFile, srcPath, imageRef: getImageRef(child?.fills), child: undefined
            });
            const isLoop = isRepeatType(getBaseType(child));
            if (isLoop) {
                child.childrenData = await Promise.all(
                    (child?.children ?? []).map(row => loopRowData(row, {token, figFile, srcPath}))
                );
                child.children = [child?.children?.[0]];
            }
            // Flex participation on the parent's own axis: this child only
            // grows when the parent lays out along the axis the child is
            // actually set to FILL on.
            const flexForAxis = frame?.layoutMode === 'VERTICAL'
                ? (child?.layoutSizingVertical === 'FILL' ? 1 : undefined)
                : (child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined);
            const mChild = {
                ...child,
                name,
                module,
                isLoopElement,
                styles: isLoop ? {
                    display: 'flex',
                    color: 'transparent',
                    flexDirection: child?.layoutMode === 'VERTICAL' ? 'column' : 'row',
                    flexWrap: transformLayoutWrap(child?.layoutWrap),
                    justifyContent: transformLayoutAxisAlign(frame?.primaryAxisAlignItems),
                    alignItems: transformLayoutAxisAlign(frame?.counterAxisAlignItems),
                    flex: flexForAxis,
                } : {
                    ...child.styles ?? {},
                    boxShadow: getDropShadowEffect(child),
                    backdropFilter: getBackgroundBlurEffect(child),
                    WebkitBackdropFilter: getBackgroundBlurEffect(child),
                    filter: getLayerBlurEffect(child),
                    flex: flexForAxis,
                },
                mainFrame: {
                    base: child?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
                    id: sanitizeFullColon(`${name ?? ''}_frame`),
                    styles: {
                        spaceValue: child?.itemSpacing ?? 0,
                        paddingLeft: child?.paddingLeft,
                        paddingRight: child?.paddingRight,
                        paddingTop: child?.paddingTop,
                        paddingBottom: child?.paddingBottom,
                        flexWrap: transformLayoutWrap(child?.layoutWrap),
                        flex: flexForAxis,
                        justifyContent: transformLayoutAxisAlign(child?.primaryAxisAlignItems),
                        alignItems: transformLayoutAxisAlign(child?.counterAxisAlignItems),
                        width: getSize(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width)
                            ?? (frame?.layoutMode === 'VERTICAL' && (child?.layoutAlign === 'STRETCH' || child?.layoutSizingHorizontal === 'FILL') ? '100%' : undefined),
                        height: getSize(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height)
                            ?? (frame?.layoutMode !== 'VERTICAL' && (child?.layoutAlign === 'STRETCH' || child?.layoutSizingVertical === 'FILL') ? '100%' : undefined),
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
            const sc = {
                ...child,
                figmaName: child?.name,
                stateText,
                name,
                module,
                isLoopElement,
                style: {
                    ...child?.style ?? {},
                    flex: frame?.layoutMode === 'VERTICAL'
                        ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                        : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                    backdropFilter: getBackgroundBlurEffect(child),
                    WebkitBackdropFilter: getBackgroundBlurEffect(child),
                    filter: getLayerBlurEffect(child),
                },
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
            };
            children.push(sc);
        }
    }
    return {...frame, children};
}

function surfacePresentationFor(page) {
    const route = routeFromSurfaceName(stripModuleSuffix(page?.name));
    const placement = ({
        CENTER: 'center', TOP_LEFT: 'topStart', TOP_CENTER: 'topCenter', TOP_RIGHT: 'topEnd',
        BOTTOM_LEFT: 'bottomStart', BOTTOM_CENTER: 'bottomCenter', BOTTOM_RIGHT: 'bottomEnd',
        MANUAL: 'stretch',
    })[page?.overlayPositionType] ?? 'stretch';
    return {
        mode: route.type === 'page' ? 'flow' : 'overlay',
        placement,
        viewport: {
            width: '100vw', // page?.absoluteBoundingBox?.width,
            height: '100vh', //page?.absoluteBoundingBox?.height,
        },
        safeArea: false,
        scroll: 'none',
        barrier: {
            dismissible: page?.overlayBackgroundInteraction === 'CLOSE_ON_CLICK_OUTSIDE',
            color: getColor(page?.overlayBackground ? [page.overlayBackground] : []) ?? 'transparent',
        },
        transition: {type: 'none', durationMs: 0},
    };
}

/**
 * Walks every top-level page/frame plus every shared component definition,
 * annotating each with its own mainFrame and the sibling wrapper axis its
 * children compose against.
 * @param document {*}
 * @param components
 * @param token {string}
 * @param figFile {string}
 * @param srcPath {string}
 * @param downloadAssets
 * @return {Promise<*[]>}
 */
export async function getPagesAndTraverseChildren({document, components, token, figFile, srcPath, downloadAssets = false, projectPath = process.cwd()}) {
    const pages = [];
    routeLookup = {};
    sharedComponentMap = {};
    configureAssetDownloads(downloadAssets, projectPath);
    const sharedDefinitions = collectSharedComponents(document, components, sharedComponentMap);
    const sPages = document?.children?.filter(x => (x?.visible ?? true) && x?.type === 'FRAME');

    for (const page of sPages ?? []) {
        const surface = routeFromSurfaceName(stripModuleSuffix(page?.name));
        routeLookup[page?.id] = {
            ...surface,
            module: moduleFromName(page?.name) || DEFAULT_PAGE_MODULE,
            barrierDismissible: page?.overlayBackgroundInteraction === 'CLOSE_ON_CLICK_OUTSIDE',
            overlayPositionType: page?.overlayPositionType,
            presentation: surfacePresentationFor(page),
        };
    }
    for (const page of sPages ?? []) {
        const module = moduleFromName(page?.name) || DEFAULT_PAGE_MODULE;
        const backGroundImage = await getFigmaImagePath({token, figFile, srcPath, imageRef: getImageRef(page?.fills)});
        const pageChildren = await transformFrameChildren({frame: page, module, isLoopElement: false, token, srcPath, figFile});
        pages.push({
            ...page,
            name: stripModuleSuffix(page?.name),
            type: maybeRandomName(page?.type),
            module,
            children: pageChildren?.children ?? [],
            surfacePresentation: surfacePresentationFor(page),
            mainFrame: {
                base: page?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
                id: sanitizeFullColon(`${stripModuleSuffix(page?.name)}_frame`),
                styles: {
                    paddingLeft: page?.paddingLeft,
                    paddingRight: page?.paddingRight,
                    paddingTop: page?.paddingTop,
                    paddingBottom: page?.paddingBottom,
                    spaceValue: page?.itemSpacing ?? 0,
                    justifyContent: transformLayoutAxisAlign(page?.primaryAxisAlignItems),
                    alignItems: transformLayoutAxisAlign(page?.counterAxisAlignItems),
                    height: '100vh',
                    width: '100vw',
                    fallbackWidth: page?.absoluteBoundingBox?.width,
                    fallbackHeight: page?.absoluteBoundingBox?.height,
                    ...getContainerLikeStyles(page, backGroundImage),
                    overflow: page?.clipsContent ? 'hidden' : undefined,
                }
            }
        });
    }
    for (const [componentId, component] of sharedDefinitions) {
        const shared = sharedComponentMap[componentId];
        const module = 'shared/common';
        const root = {
            ...structuredClone(component),
            type: 'COMPONENT',
            name: shared.name,
            module,
            mainFrame: {
                base: component?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
                id: sanitizeFullColon(`${shared.name}_frame`),
                styles: {
                    paddingLeft: component?.paddingLeft,
                    paddingRight: component?.paddingRight,
                    paddingTop: component?.paddingTop,
                    paddingBottom: component?.paddingBottom,
                    spaceValue: component?.itemSpacing ?? 0,
                    justifyContent: transformLayoutAxisAlign(component?.primaryAxisAlignItems),
                    alignItems: transformLayoutAxisAlign(component?.counterAxisAlignItems),
                    ...getContainerLikeStyles(component),
                    overflow: component?.clipsContent ? 'hidden' : undefined,
                }
            }
        };
        const transformed = await transformFrameChildren({frame: root, module, isLoopElement: false, token, figFile, srcPath});
        pages.push({...root, children: transformed?.children ?? []});
    }
    return pages;
}

/**
 * Writes every annotated node produced by getPagesAndTraverseChildren() to
 * its own YAML spec file, recursing into frame/instance/component children.
 */
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
            await handleRectangleComponent(structuredClone({child, srcPath, figFile, token, filename}));
        } else if (child?.type === 'VECTOR') {
            await createVectorComponent({filename, child, srcPath, token, figFile});
        } else if (child?.type === 'FRAME' || child?.type === 'INSTANCE' || child?.type === 'COMPONENT') {
            if (isRepeatType(getBaseType(child))) {
                await createLoopComponent({filename, child});
            } else if (child?.type === 'INSTANCE') {
                await createInstanceComponent({filename, child: structuredClone(child), srcPath, sharedComponentMap, routeLookup});
            } else if (getBaseType(child) === 'condition') {
                await createConditionComponent({filename, child: structuredClone(child), routeLookup});
            } else {
                await createFrameComponent({filename, child: structuredClone(child), routeLookup});
            }
            await walkFrameChildren(structuredClone({children: child?.children, srcPath, token, figFile}));
        } else {
            const backGroundImage = await getFigmaImagePath({
                token,
                figFile,
                srcPath,
                imageRef: getImageRef(child?.fills),
                child,
            });
            await createContainerComponent(filename, structuredClone(child), backGroundImage);
        }
    }
}
