import {ensureFileExist, ensurePathExist, sanitizeFullColon} from "../../helpers/general.mjs";
import {join, resolve} from "node:path";
import {appendFile, readFile, writeFile} from "node:fs/promises";
import * as yaml from "js-yaml"
import {absolutePathParse} from "../../helpers/setup.mjs";
import {getFigmaImagePath} from "./image.mjs";
import {getColor, getContainerLikeStyles, getImageRef} from "./utils.mjs";
import {id2nameMapCache} from "./cache.mjs";


/**
 *
 * @param data
 * @return {*}
 */
export function getDesignDocument(data) {
    return data?.document?.children?.[0];
}

export function getSize(layoutSizing, size) {
    if (layoutSizing === 'FIXED') {
        return size;
    } else {
        return undefined;
    }
}

function getSizeStyles(child) {
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
                extend: child?.extendFrame,
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
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
            base: 'rectangle',
            modifier: {
                props: {id: sanitizeFullColon(`${child?.name}`)},
                extend: child?.extendFrame,
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
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
    const route = id2nameMapCache[child?.transitionNodeID] ?? {type: 'close'};
    const logicPath = resolve(join(srcPath, 'modules', child?.module ?? '', 'logics', `${child?.name}.mjs`));

    await ensurePathExist(logicPath);
    await ensureFileExist(logicPath);
    const logicImportFile = await import(absolutePathParse(logicPath));

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

    if (baseType === 'button' && (id2nameMapCache[child?.transitionNodeID] || (Array.isArray(child?.interactions) && child?.interactions?.length > 0))) {
        await handleNavigations({srcPath, child});
    }

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
                extend: child?.extendFrame,
                styles: child.styles,
                props: {
                    id: sanitizeFullColon(child?.isLoopElement ? `'_'+loopIndex+'${sanitizedNameForLoopElement(child)}'` : `${child?.name}`),
                    onClick: baseType === 'button' ? 'logics.onClick' : undefined
                },
                left: (isCondition && leftName)
                    ? `./${leftName}.yml`
                    : (last ? `./${last?.name}.yml` : undefined),
                right: (isCondition && rightName)
                    ? `./${rightName}.yml`
                    : undefined,
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
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

async function ensureLoopDataExist({srcPath, child}) {
    const dummyLength = (child.childrenData ?? [{_key: Math.random()}]).length;
    const dummyChildren = `new Array(${dummyLength}).fill({}).map(()=>({_key:Math.random()}))`;

    const logicPath = resolve(join(srcPath, 'modules', child?.module ?? '', 'logics', `${child?.name}.mjs`));

    await ensurePathExist(logicPath);
    await ensureFileExist(logicPath);
    const logicImportFile = await import(absolutePathParse(logicPath));

    const setDataRegex1 = /states\s*.\s*setData\s*\(\s*(.*\s*)+?\)/g;
    const setDataRegex2 = /states\s*.\s*setData\s*\(\s*\w*\s*\)/g;
    const onStartSignatureRegex = /onStart\s*\(\s*data\s*\)\s*\{/g;

    const onStartFnString = logicImportFile?.onStart?.toString() ?? '';
    if (onStartFnString && onStartFnString !== '') {
        const condition1 = setDataRegex1.test(onStartFnString);
        const condition2 = setDataRegex2.test(onStartFnString);
        if (condition1) {
            return
        }
        if (condition2) {
            return
        }
        const newOnStartString = onStartFnString
            .replaceAll(onStartSignatureRegex, `onStart(data) {\n    data.component.states.setData(${dummyChildren.replaceAll('"', '')});`);
        const logicFileNwString = (await readFile(logicPath))
            .toString().replace(onStartFnString, newOnStartString)
        await writeFile(logicPath, logicFileNwString);
    } else {
        await appendFile(logicPath, `
/**
* @param data {
* {component: {states: *,inputs: *}, args: Array<*>}
* }
*/
export function onStart(data) {
    data.component.states.setData(${dummyChildren.replaceAll('"', '')});
}`);
    }
}

async function createLoopComponent({filename, child, srcPath}) {
    child = structuredClone(child);
    await ensureLoopDataExist({srcPath, child});
    const last = child?.children?.[0];
    const yamlData = yaml.dump({
        loop: {
            modifier: {
                extend: child?.extendFrame,
                styles: {
                    ...child.styles,
                    overflow: 'auto'
                },
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
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
    } else if (baseType === 'image') {
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
                states: {srcUrl: srcUrl ?? ''},
                props: {
                    id: sanitizeFullColon(`${child?.name}`),
                    alt: child?.name,
                    src: child?.isLoopElement ? `inputs.loopElement.${sanitizedNameForLoopElement(child)}??srcUrl` : 'states.srcUrl',
                },
                effects: {
                    onStart: {
                        body: 'logics.onStart'
                    }
                },
                extend: child?.extendFrame,
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

export async function writeModifiedFigmaJson2Specs({children, srcPath, token, figFile}) {
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
                await writeModifiedFigmaJson2Specs(structuredClone({
                    children: child?.children,
                    srcPath,
                    token,
                    figFile
                }));
            } else {
                await createConditionComponent({filename, child: structuredClone(child), srcPath});
                await writeModifiedFigmaJson2Specs(structuredClone({
                    children: child?.children,
                    srcPath,
                    token,
                    figFile
                }));
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

