/**
 * Serializes one already-annotated Figma node (see tree.mjs) to its FastUI
 * YAML spec file. Each `create*Component` function owns exactly one of the
 * spec primitives (component/condition/loop) for exactly one Figma node
 * shape (text/image/vector/rectangle/frame/instance).
 *
 * Composition is top-down: a node that owns children (FRAME/INSTANCE/
 * COMPONENT) emits `modifier.extend` listing those children in order, and
 * `modifier.frame` as `{base, id, current, next}` - `current` styles this
 * node's own view, `next` styles each extended child's wrapper. Leaf nodes
 * (text/image/vector/rectangle) never have children, so they never emit
 * `extend`. There is no `ref`/`compose`: an INSTANCE reuses its shared MAIN
 * COMPONENT spec by pointing `base` at it (see shared-components.mjs).
 */
import * as yaml from 'js-yaml';
import {writeFile} from 'node:fs/promises';
import {sanitizeFullColon} from '../../shared/fn.mjs';
import {getContainerLikeStyles, getImageRef, getSizeStyles, repeatScrollDirection} from './layout.mjs';
import {getColor} from './color.mjs';
import {getBaseType, sanitizedNameForLoopElement} from './naming.mjs';
import {interactionBehavior} from './route.mjs';
import {sharedComponentBasePath} from './shared-components.mjs';
import {getFigmaImagePath} from './assets.mjs';

/**
 * Maps tree.mjs's internal `{base, id, styles}` frame annotation to the
 * spec-level `{base, id, current, next}` contract. `next` is left empty:
 * the translator does not yet infer per-parent child participation styles,
 * so authored specs can add `frame.next` by hand where needed.
 */
function toFrameShape(internalFrame, extraCurrentStyles = {}) {
    if (!internalFrame) return undefined;
    return {
        base: internalFrame.base,
        id: internalFrame.id,
        current: {...internalFrame.styles, ...extraCurrentStyles},
        next: {},
    };
}

export async function createTextComponent(filename, child) {
    const yamlData = yaml.dump({
        component: {
            base: 'text',
            modifier: {
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
                frame: toFrameShape(child?.childFrame),
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
                frame: toFrameShape(child?.childFrame),
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
                styles: {
                    ...getContainerLikeStyles(child, backgroundImage),
                    ...getSizeStyles(child)
                },
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: toFrameShape(child?.childFrame),
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

/**
 * A plain Figma FRAME/COMPONENT container (no explicit condition/loop/
 * instance metadata): a top-down composer whose visible children become an
 * ordered `modifier.extend` list.
 */
export async function createFrameComponent({filename, child, routeLookup}) {
    const baseType = getBaseType(child);
    const behavior = interactionBehavior(child, routeLookup);
    const childPaths = (child?.children ?? []).map(item => `./${item?.name}.yml`);
    const yamlData = yaml.dump({
        component: {
            base: 'container',
            modifier: {
                extend: childPaths.length > 0 ? childPaths : undefined,
                styles: child?.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: behavior.onClick
                },
                states: Object.keys(behavior.states).length > 0 ? behavior.states : undefined,
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: toFrameShape(child?.mainFrame, {
                    cursor: baseType === 'button' ? 'pointer' : undefined,
                    overflow: child?.clipsContent ? 'hidden' : undefined,
                }),
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

/**
 * A Figma INSTANCE: reuses its shared MAIN COMPONENT spec via `base`, and
 * composes its own overriding child (if any) via `extend` so the instance's
 * local override replaces the shared definition's own child in that slot.
 * @param sharedComponentMap {Record<string, {name: string}>}
 * @param routeLookup {Record<string, *>}
 */
export async function createInstanceComponent({filename, child, srcPath, sharedComponentMap, routeLookup}) {
    const behavior = interactionBehavior(child, routeLookup);
    const override = child?.children?.[child?.children?.length - 1];
    const yamlData = yaml.dump({
        component: {
            base: sharedComponentBasePath({filename, child, srcPath, sharedComponentMap}),
            modifier: {
                extend: override ? `./${override?.name}.yml` : undefined,
                styles: child?.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: behavior.onClick
                },
                states: Object.keys(behavior.states).length > 0 ? behavior.states : undefined,
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: toFrameShape(child?.mainFrame),
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

/**
 * A Figma node explicitly named/flagged as a condition (`getBaseType(child)
 * === 'condition'`). Only ever called for that explicit case; a plain frame
 * is a container (see createFrameComponent), not a condition.
 * @param routeLookup {Record<string, *>}
 */
export async function createConditionComponent({filename, child, routeLookup}) {
    const baseType = getBaseType(child);
    const behavior = interactionBehavior(child, routeLookup);
    const rightName = child?.children?.[0]?.name;
    const leftName = child?.children?.[1]?.name;

    const yamlData = yaml.dump({
        condition: {
            modifier: {
                styles: child.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: behavior.onClick
                },
                left: leftName ? `./${leftName}.yml` : undefined,
                right: rightName ? `./${rightName}.yml` : undefined,
                states: {condition: false, ...behavior.states},
                metadata: child?.surfacePresentation ? {surface: child.surfacePresentation} : undefined,
                frame: toFrameShape(child?.mainFrame, {
                    cursor: baseType === 'button' ? 'pointer' : undefined,
                    overflow: child?.clipsContent ? 'hidden' : undefined,
                }),
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

export async function createLoopComponent({filename, child}) {
    child = structuredClone(child);
    const last = child?.children?.[0];
    const yamlData = yaml.dump({
        loop: {
            modifier: {
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
                frame: toFrameShape(child?.mainFrame, {
                    overflow: child?.clipsContent ? 'hidden' : undefined,
                }),
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
                styles: {
                    ...getContainerLikeStyles(child, null),
                    ...getSizeStyles(child),
                    objectFit
                },
                frame: toFrameShape(child?.childFrame),
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
