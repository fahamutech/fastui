import axios from "axios";
import {ensureFileExist, ensurePathExist, itOrEmptyList, justString, maybeRandomName} from "../../utils/index.mjs";
import {join, resolve} from "node:path";
import {writeFile} from "node:fs/promises";
import * as yaml from "js-yaml"

/**
 *
 * @param token
 * @param figFile
 * @return {Promise<any>}
 */
export async function fetchFigmaFile({token, figFile}) {
    const {data} = await axios.get(`https://api.figma.com/v1/files/${figFile}`, {
        headers: {
            'X-Figma-Token': token
        }
    });
    return data;
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
        // case 'MIN':
        //     return 'flex-start';
        // case 'MAX':
        //     return 'flex-end';
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

function transformLayoutSizing(layoutSizing, size) {
    switch (layoutSizing) {
        case 'FIXED':
            return size;
        // case 'HUG':
        //     return undefined;
        // case "FILL":
        //     return undefined;
        default:
            return undefined;
    }
}

function transformFrameChildren(frame, module) {
    const children = [];
    for (let i = 0; i < frame?.children?.length; i++) {
        const child = frame?.children[i];
        if (child?.type === 'FRAME') {
            const mChild = {
                ...child,
                module,
                extendFrame: i > 0 ? `./${frame?.children[i - 1]?.name}.yml` : undefined,
                mainFrame: {
                    base: frame?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
                    styles: {
                        spaceValue: frame?.itemSpacing ?? 0,
                        paddingLeft: child?.paddingLeft,
                        paddingRight: child?.paddingRight,
                        paddingTop: child?.paddingTop,
                        paddingBottom: child?.paddingBottom,
                        flexWrap: transformLayoutWrap(child?.layoutWrap),
                        justifyContent: frame?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.counterAxisAlignItems)
                            : transformLayoutAxisAlign(child?.primaryAxisAlignItems),
                        alignItems: frame?.layoutMode === 'VERTICAL'
                            ? transformLayoutAxisAlign(child?.primaryAxisAlignItems)
                            : transformLayoutAxisAlign(child?.counterAxisAlignItems),
                        ...getContainerLikeStyles(child),
                        ...getSizeStyles(child)
                    }
                }
            };
            const f = transformFrameChildren(mChild, module);
            children.push(f);
        } else {
            const sc = {
                ...child,
                module,
                style: {
                    ...child?.style ?? {},
                    [frame?.layoutMode === 'HORIZONTAL' ? 'marginRight' : 'marginBottom']: frame?.itemSpacing ?? 0,
                },
                extendFrame: i > 0 ? `./${frame?.children[i - 1]?.name}.yml` : undefined,
                childFrame: {
                    base: frame?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
                    styles: {
                        flexWrap: transformLayoutWrap(frame?.layoutWrap)
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
 * @return  {*[]}
 */
export function getPagesAndTraverseChildren(document) {
    const replaceModule = v => justString(v).replaceAll(/(\[.*])/g, '').trim();
    const replaceName = t => justString(t).replaceAll(/(.*\[)|(].*)/g, '').trim();

    return itOrEmptyList(document?.children).map(x => {
        const module = replaceName(x?.name).includes('/') ? replaceName(x?.name) : null;
        const pageChildren = transformFrameChildren(x, module)?.children;
        return {
            ...x,
            name: maybeRandomName(replaceModule(x?.name)),
            type: maybeRandomName(x?.type),
            module,
            children: pageChildren,
            mainFrame: {
                base: x?.layoutMode === 'VERTICAL' ? 'column.start.stack' : 'row.start.stack',
                styles: {
                    paddingLeft: x?.paddingLeft,
                    paddingRight: x?.paddingRight,
                    paddingTop: x?.paddingTop,
                    paddingBottom: x?.paddingBottom,
                    minHeight: '100vh',
                    ...getContainerLikeStyles(x),
                }
            }
        }
    });
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

function getContainerLikeStyles(child) {
    return {
        ...child?.style ?? {},
        borderRadius: child?.cornerRadius,
        borderTopLeftRadius: child?.rectangleCornerRadii?.[0],
        borderTopRightRadius: child?.rectangleCornerRadii?.[1],
        borderBottomRightRadius: child?.rectangleCornerRadii?.[2],
        borderBottomLeftRadius: child?.rectangleCornerRadii?.[3],
        backgroundColor: getColor(child?.fills),
        ...getBorderStyles(child)
    }
}

function getSizeStyles(child) {
    return {
        width: transformLayoutSizing(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width),
        height: transformLayoutSizing(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height),
    }
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
                    color: getColor(child?.fills)
                },
                props: {
                    children: 'states.value',
                    id: child?.name
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
                    ...getContainerLikeStyles(child),
                    ...getSizeStyles(child),
                    borderColor: 'states.borderColor',
                    fontSize: 15,
                    padding: '0 8px'
                },
                props: {
                    type,
                    value: 'states.value',
                    onChange: 'logics.onTextChange',
                    placeholder: 'Type here',
                    id: child?.name
                },
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
                states: {
                    value: '',
                    borderColor: getColor(child?.strokes),
                },
                frame: child?.childFrame,
            }
        }
    }, undefined);
    await writeFile(filename, yamlData);
}

export async function walkFrameChildren(children, srcPath) {
    function getChildFileName(child) {
        return resolve(join(srcPath, 'modules', child?.module ?? '', `${child?.name}.yml`));
    }

    async function createContainerComponent(filename, child, i) {
        const yamlData = yaml.dump({
            component: {
                base: 'rectangle',
                modifier: {
                    props: {id: child?.name},
                    extend: child?.extendFrame,
                    styles: {
                        ...getContainerLikeStyles(child),
                        ...getSizeStyles(child)
                    },
                    frame: child?.childFrame,
                }
            }
        }, undefined);
        await writeFile(filename, yamlData);
    }

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const path = resolve(join(srcPath, 'modules', child?.module ?? ''));
        const filename = getChildFileName(child)
        await ensurePathExist(path);
        await ensureFileExist(filename);

        if (child?.type === 'TEXT') {
            await createTextComponent(filename, child);
        } else if (child?.type === 'RECTANGLE') {
            const baseType = `${child?.name}`.split('_').pop()
            if (baseType === 'input') {
                await createTextInputComponent(filename, child);
            } else if (baseType === 'password') {
                await createTextInputComponent(filename, child, 'password');
            } else if (baseType === 'container') {
                await createContainerComponent(filename, child, i);
            } else {
                await createContainerComponent(filename, child, i)
            }
        } else if (child?.type === 'FRAME') {
            const last = child?.children?.[child?.children?.length - 1];
            const yamlData = yaml.dump({
                condition: {
                    modifier: {
                        extend: child?.extendFrame,
                        left: last ? `./${last?.name}.yml` : undefined,
                        frame: child?.mainFrame,
                    }
                }
            });
            await writeFile(filename, yamlData);
            await walkFrameChildren(child?.children, srcPath);
        } else {
            await createContainerComponent(filename, child, i);
        }

    }
}

