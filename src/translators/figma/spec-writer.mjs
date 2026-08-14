/**
 * Serializes one already-annotated Figma node (see tree.mjs) to its FastUI
 * YAML spec file. Each `create*Component` function owns exactly one of the
 * spec primitives (component/condition/loop) for exactly one Figma node
 * shape (text/image/vector/rectangle/frame).
 */
import * as yaml from 'js-yaml';
import {writeFile} from 'node:fs/promises';
import {sanitizeFullColon} from '../../shared/fn.mjs';
import {getContainerLikeStyles, getImageRef, getSizeStyles, repeatScrollDirection} from './layout.mjs';
import {getColor} from './color.mjs';
import {getBaseType, sanitizedNameForLoopElement} from './naming.mjs';
import {interactionBehavior} from './route.mjs';
import {sharedComponentRef} from './shared-components.mjs';
import {getFigmaImagePath} from './assets.mjs';

export async function createTextComponent(filename, child) {
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
    });
    await writeFile(filename, yamlData);
}

export async function createTextInputComponent(filename, child, type = 'text') {
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

export async function createContainerComponent(filename, child, backgroundImage) {
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
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: child?.childFrame,
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

/**
 * @param sharedComponentMap {Record<string, {name: string}>}
 * @param routeLookup {Record<string, *>}
 */
export async function createConditionComponent({filename, child, srcPath, sharedComponentMap, routeLookup}) {
    const baseType = getBaseType(child);
    const behavior = interactionBehavior(child, routeLookup);

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
                ref: sharedComponentRef({filename, child, srcPath, sharedComponentMap}),
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
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: {
                    base: child?.mainFrame?.base,
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}_frame'` : `${child?.name}_frame`),
                    styles: {
                        ...child?.mainFrame?.styles,
                        cursor: baseType === 'button' ? 'pointer' : undefined,
                        overflow: child?.clipsContent ? 'hidden' : undefined,
                    }
                },
                wrapper: {
                    base: child?.wrapperBase ?? child?.mainFrame?.base,
                },
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

/**
 * @param sharedComponentMap {Record<string, {name: string}>}
 */
export async function createLoopComponent({filename, child, srcPath, sharedComponentMap}) {
    child = structuredClone(child);
    const last = child?.children?.[0];
    const yamlData = yaml.dump({
        loop: {
            modifier: {
                ref: sharedComponentRef({filename, child, srcPath, sharedComponentMap}),
                compose: child?.extendFrame,
                styles: {
                    ...child.styles,
                    overflow: child?.clipsContent ? 'hidden' : undefined
                },
                states: {data: child.childrenData ?? []},
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                props: {
                    id: sanitizeFullColon(`${child?.name}`),
                    scroll: repeatScrollDirection(child),
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
                wrapper: {
                    base: child?.wrapperBase ?? child?.mainFrame?.base,
                },
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

export function dumpImageYaml({child, srcUrl, objectFit = 'cover'}) {
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
                },
                frame: child?.childFrame,
            }
        }
    }, undefined);
}

export async function createImageComponent({filename, child, token, srcPath, figFile}) {
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

export async function createVectorComponent({filename, child, srcPath, token, figFile}) {
    child = structuredClone({
        ...child,
        fills: undefined,
        strokes: undefined,
        strokeWeight: undefined
    });
    const srcUrl = await getFigmaImagePath({
        token,
        figFile,
        format: 'svg',
        srcPath,
        imageRef: sanitizeFullColon(`${child?.name}`),
        child,
    });
    const yamlData = dumpImageYaml({srcUrl, child, objectFit: 'none'});
    await writeFile(filename, yamlData);
}

export async function handleRectangleComponent({child, filename, srcPath, token, figFile}) {
    const baseType = getBaseType(child);
    if (baseType === 'input') {
        const inputType = `${child?.name}`.toLowerCase()?.includes('password') ? 'password' : undefined;
        await createTextInputComponent(filename, child, inputType);
    } else if (baseType === 'image') {
        await createImageComponent({filename, child, srcPath, token, figFile});
    } else {
        const backGroundImage = await getFigmaImagePath({
            token,
            figFile,
            srcPath,
            imageRef: getImageRef(child?.fills),
            child,
        });
        await createContainerComponent(filename, child, backGroundImage);
    }
}
