import {getFigmaImagePath} from "./image.mjs";
import {randomUUID} from "node:crypto";
import {
    firstUpperCaseRestSmall,
    itOrEmptyList,
    justString,
    maybeRandomName,
    sanitizeFullColon
} from "../../helpers/general.mjs";
import {getContainerLikeStyles, getImageRef} from "./utils.mjs";
import {id2nameMapCache} from "./cache.mjs";

async function transformChildrenByTraverse({frame, module, isLoopElement, token, figFile, srcPath}) {
    const children = [];
    const parentBaseType = `${frame?.name?.split('_')?.pop()}`.trim().toLowerCase();
    const isCondition = parentBaseType === 'condition';
    let fChildren = frame?.children?.filter(x => (x?.visible ?? true) || isCondition) ?? [];
    if (isCondition) {
        fChildren = fChildren.map(x => ({...x, visible: true, absoluteRenderBounds: x?.absoluteBoundingBox}));
    }
    for (let i = 0; i < fChildren?.length; i++) {
        const child = fChildren[i] ?? {};
        const isLastChild = (fChildren?.length - 1) === i;
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
                    justifyContent: child?.layoutMode === 'VERTICAL'
                        ? transformLayoutAxisAlign(child?.primaryAxisAlignItems)
                        : transformLayoutAxisAlign(child?.counterAxisAlignItems),
                    alignItems: child?.layoutMode === 'VERTICAL'
                        ? transformLayoutAxisAlign(child?.counterAxisAlignItems)
                        : transformLayoutAxisAlign(child?.primaryAxisAlignItems),
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
                        spaceValue: isLastChild ? 0 : frame?.itemSpacing ?? 0,
                        // (isLastChild && !isLoopElement) ? 0 : frame?.itemSpacing ?? 0,
                        paddingLeft: child?.paddingLeft,
                        paddingRight: child?.paddingRight,
                        paddingTop: child?.paddingTop,
                        paddingBottom: child?.paddingBottom,
                        flexWrap: transformLayoutWrap(child?.layoutWrap),
                        flex: frame?.layoutMode === 'VERTICAL'
                            ? child?.layoutSizingVertical === 'FILL' ? 1 : undefined
                            : child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined,
                        justifyContent: child?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.primaryAxisAlignItems)
                            : transformLayoutAxisAlign(child?.counterAxisAlignItems),
                        alignItems: child?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.counterAxisAlignItems)
                            : transformLayoutAxisAlign(child?.primaryAxisAlignItems),
                        width: getSize(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width),
                        height: getSize(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height),
                        ...getContainerLikeStyles(child, backGroundImage),
                        boxShadow: getDropShadowEffect(child),
                        backdropFilter: getBackgroundBlurEffect(child),
                        WebkitBackdropFilter: getBackgroundBlurEffect(child),
                        filter: getLayerBlurEffect(child),
                    }
                }
            };
            const f = await transformChildrenByTraverse({
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

function getBaseType(child) {
    return (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
}

function transformLayoutWrap(layoutWrap) {
    return `${layoutWrap ?? 'NOWRAP'}`.replaceAll('_', '').toLowerCase();
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

/**
 *
 * @param document
 * @param token
 * @param figFile
 * @param srcPath
 * @return  {Promise<*[]>}
 */
export async function transformFigmaTopLevelDocFrames({document, token, figFile, srcPath}) {
    const replaceModule = v => justString(v).replaceAll(/(\[.*])/g, '').trim();
    const replaceName = t => justString(t).replaceAll(/(.*\[)|(].*)/g, '').trim();
    const pages = [];
    const sPages = document?.children?.filter(x => (x?.visible ?? true) && x?.type === 'FRAME');
    for (const page of sPages ?? []) {
        const nAry = replaceModule(page?.name)?.split('_')
        const type = nAry.pop();
        const name = nAry.join('_');
        const module = /*replaceName(page?.name).includes('/') ? */replaceName(page?.name)/* : null;*/
        id2nameMapCache[page?.id] = {name, type, module}
        const a = {token, figFile, srcPath, imageRef: getImageRef(page?.fills)}
        const backGroundImage = await getFigmaImagePath(a)
        const b = {frame: page, module, isLoopElement: false, token, srcPath, figFile};
        const pageChildren = await transformChildrenByTraverse(b);
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
                    // maxWidth: page?.absoluteRenderBounds?.width,
                    // margin: 'auto',
                    ...getContainerLikeStyles(page, backGroundImage),
                }
            }
        });
    }
    return pages;
}