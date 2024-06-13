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

function transformFrameChildren(frame, module) {
    const viewFrame = {
        base: frame?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
        styles: {
            [frame?.layoutMode === 'HORIZONTAL' ? 'paddingRight' : 'paddingBottom']: frame?.itemSpacing ?? 0,
            flexWrap: `${frame?.layoutWrap ?? 'NOWRAP'}`.replaceAll('_', '').toLowerCase()
        }
    };
    const children = [];
    for (let i = 0; i < frame?.children?.length; i++) {
        const child = frame?.children[i];
        if (child?.type === 'FRAME') {
            const mChild = {
                ...child,
                module,
                extendFrame: i > 0 ? `./${frame?.children[i - 1]?.name}.yml` : undefined,
                mainFrame: viewFrame
            };
            const f = transformFrameChildren(mChild, module);
            children.push(f);
        } else {
            const sc = {
                ...child,
                module,
                extendFrame: i > 0 ? `./${frame?.children[i - 1]?.name}.yml` : undefined,
                childFrame: viewFrame
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
            // extendFrame: last ? `./${last?.name}.yml` : undefined,
            mainFrame: {
                base: x?.layoutMode === 'VERTICAL' ? 'column.start.stack' : 'row.start.stack',
                styles: {
                    paddingLeft: x?.paddingLeft,
                    paddingRight: x?.paddingRight,
                    paddingTop: x?.paddingTop,
                    paddingBottom: x?.paddingBottom,
                    // margin: isFrame?'auto':undefined,
                    // maxWidth: x?.absoluteBoundingBox?.width,
                    // minHeight: '100vh',
                    backgroundColor: `rgba(${x?.backgroundColor?.r / 255},${x?.backgroundColor?.g / 255},${x?.backgroundColor?.b / 255},${x?.backgroundColor?.a / 255})`,
                }
            }
        }
    });
}

export async function walkFrameChildren(children, srcPath) {
    function getChildFileName(child) {
        return resolve(join(srcPath, 'modules', child?.module ?? '', `${child?.name}.yml`));
    }

    async function defaultContent(filename, child, i) {
        const yamlData = yaml.dump({
            component: {
                base: 'rectangle',
                modifier: {
                    extend: child?.extendFrame,
                    styles: child?.style ?? {},
                    frame: child?.childFrame,
                }
            }
        });
        await writeFile(filename, yamlData);
    }

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const path = resolve(join(srcPath, 'modules', child?.module ?? ''));
        const filename = getChildFileName(child)
        await ensurePathExist(path);
        await ensureFileExist(filename);

        if (child?.type === 'TEXT') {
            const yamlData = yaml.dump({
                component: {
                    base: 'text',
                    modifier: {
                        extend: child?.extendFrame,
                        styles: child?.style ?? {},
                        props: {
                            children: 'states.value'
                        },
                        states: {
                            value: child?.characters,
                        },
                        frame: child?.childFrame,
                    }
                }
            })
            await writeFile(filename, yamlData);
        } else if (child?.type === 'RECTANGLE') {
            const baseType = `${child?.name}`.split('_').pop()
            if (baseType === 'input') {
                const yamlData = yaml.dump({
                    component: {
                        base: 'input',
                        modifier: {
                            extend: child?.extendFrame,
                            styles: child?.style ?? {},
                            props: {
                                type: 'text',
                                value: 'states.value',
                                onChange: 'logics.onTextChange',
                                placeholder: 'Type here'
                            },
                            states: {
                                value: '',
                            },
                            frame: child?.childFrame,
                        }
                    }
                });
                await writeFile(filename, yamlData);
            } else if (baseType === 'password') {
                const yamlData = yaml.dump({
                    component: {
                        base: 'input',
                        modifier: {
                            extend: child?.extendFrame,
                            styles: child?.style ?? {},
                            props: {
                                type: 'password',
                                value: 'states.value',
                                onChange: 'logics.onTextChange',
                                placeholder: 'Type here'
                            },
                            states: {
                                value: '',
                            },
                            frame: child?.childFrame,
                        }
                    }
                })
                await writeFile(filename, yamlData);
            } else if (baseType === 'container') {
                await defaultContent(filename, child, i)
            } else {
                await defaultContent(filename, child, i)
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
            await defaultContent(filename, child, i);
        }

    }
}

