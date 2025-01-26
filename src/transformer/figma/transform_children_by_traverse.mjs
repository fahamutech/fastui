//
// function getBackgroundBlurEffect(child) {
//     const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'BACKGROUND_BLUR');
//     return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
// }
//
// function getDropShadowEffect(child) {
//     const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'DROP_SHADOW')
//         ?? itOrEmptyList(child?.effects).find(x => x?.type === 'INNER_SHADOW');
//     const inner = effect?.type === 'INNER_SHADOW' ? 'inset' : '';
//     const x = effect?.offset?.x ?? 0;
//     const y = effect?.offset?.y ?? 0;
//     const radius = effect?.radius ?? 0;
//     const spread = effect?.spread ?? 0;
//     const color = getColor([{type: 'SOLID', color: {...child?.color ?? {}}}]);
//     return effect?.visible
//         ? `${inner} ${x}px ${y}px ${radius}px ${spread}px ${color}`.trim()
//         : undefined;
// }
//
// function getLayerBlurEffect(child) {
//     const effect = itOrEmptyList(child?.effects).find(x => x?.type === 'LAYER_BLUR');
//     return effect?.visible ? `blur(${effect?.radius ?? 0}px)` : undefined;
// }
//
// function getBaseType(child) {
//     return (`${child?.name}`.split('_').pop() ?? '').toLowerCase();
// }
//
// function transformLayoutWrap(layoutWrap) {
//     return `${layoutWrap ?? 'NOWRAP'}`.replaceAll('_', '').toLowerCase();
// }
//
// function transformLayoutAxisAlign(counterAxisAlignItems) {
//     switch (counterAxisAlignItems) {
//         case 'MIN':
//             return 'flex-start';
//         case 'MAX':
//             return 'flex-end';
//         case  'CENTER':
//             return 'center';
//         case 'SPACE_BETWEEN':
//             return 'space-between';
//         default:
//             return 'normal';
//     }
// }
//
// // Refactored transformChildrenByTraverse function
// import {getFigmaImagePath} from "./image.mjs";
// import {getContainerLikeStyles, getImageRef} from "./utils.mjs";
// import {randomUUID} from "node:crypto";
// import {firstUpperCaseRestSmall, itOrEmptyList, sanitizeFullColon} from "../../helpers/general.mjs";
//
// export async function transformChildrenByTraverse({
//                                                frame,
//                                                module,
//                                                isLoopElement,
//                                                token,
//                                                figFile,
//                                                srcPath
//                                            }) {
//     const children = [];
//
//     // Determine if the parent frame is a 'condition' type
//     const parentBaseType = (frame?.name?.split('_')?.pop() || '').trim().toLowerCase();
//     const isCondition = parentBaseType === 'condition';
//
//     // Filter visible children or include all if it's a condition
//     let frameChildren = frame?.children?.filter(
//         child => (child?.visible ?? true) || isCondition
//     ) ?? [];
//
//     // If it's a condition, make all children visible and set absoluteRenderBounds
//     if (isCondition) {
//         frameChildren = frameChildren.map(child => ({
//             ...child,
//             visible: true,
//             absoluteRenderBounds: child?.absoluteBoundingBox
//         }));
//     }
//
//     // Process each child in the frame
//     for (let i = 0; i < frameChildren.length; i++) {
//         const child = frameChildren[i] ?? {};
//         const isLastChild = i === frameChildren.length - 1;
//
//         if (['FRAME', 'INSTANCE', 'COMPONENT'].includes(child?.type)) {
//             // Process frame-like child elements
//             const processedChild = await processFrameChild({
//                 child,
//                 frame,
//                 module,
//                 isLoopElement,
//                 token,
//                 figFile,
//                 srcPath,
//                 isCondition,
//                 index: i,
//                 frameChildren,
//                 isLastChild
//             });
//             children.push(processedChild);
//         } else {
//             // Process other types of child elements
//             const processedChild = processNonFrameChild({
//                 child,
//                 frame,
//                 module,
//                 isLoopElement,
//                 isCondition,
//                 index: i,
//                 frameChildren,
//                 isLastChild
//             });
//             children.push(processedChild);
//         }
//     }
//
//     return {
//         ...frame,
//         children
//     };
// }
//
// // Helper function to process frame-like child elements
// async function processFrameChild({
//                                      child,
//                                      frame,
//                                      module,
//                                      isLoopElement,
//                                      token,
//                                      figFile,
//                                      srcPath,
//                                      isCondition,
//                                      index,
//                                      frameChildren,
//                                      isLastChild
//                                  }) {
//     // Retrieve background image path
//     const backgroundImage = await getFigmaImagePath({
//         token,
//         figFile,
//         srcPath,
//         imageRef: getImageRef(child?.fills)
//     });
//
//     // Determine the base type and check if it's a loop
//     const baseType = getBaseType(child);
//     const isLoop = baseType === 'loop';
//
//     // If the child is a loop, prepare childrenData and limit to the first child
//     if (isLoop) {
//         child.childrenData = child?.children?.map(x => ({
//             _key: x?.id ?? randomUUID().toString()
//         }));
//         child.children = [child?.children?.[0]];
//     }
//
//     // Generate names for the child and extendFrame
//     const name = generateChildName(child);
//     const extendFrameName = generateExtendFrameName({ frameChildren, index, isCondition });
//
//     // Build styles for the child
//     const styles = isLoop
//         ? buildLoopStyles({ child, frame })
//         : buildChildStyles({ child, frame });
//
//     // Build styles for the main frame
//     const mainFrameStyles = buildMainFrameStyles({
//         child,
//         frame,
//         backgroundImage,
//         isLastChild
//     });
//
//     // Create the modified child object
//     const modifiedChild = {
//         ...child,
//         name,
//         module,
//         extendFrame: extendFrameName ? `./${extendFrameName}.yml` : undefined,
//         isLoopElement,
//         styles,
//         mainFrame: {
//             base: frame?.layoutMode === 'VERTICAL' ? 'column.start' : 'row.start',
//             id: sanitizeFullColon(`${name}_frame`),
//             styles: mainFrameStyles
//         }
//     };
//
//     // Recursively process the child
//     return await transformChildrenByTraverse({
//         frame: modifiedChild,
//         module,
//         isLoopElement: isLoop || isLoopElement,
//         token,
//         figFile,
//         srcPath
//     });
// }
//
// // Helper function to process non-frame child elements
// function processNonFrameChild({
//                                   child,
//                                   frame,
//                                   module,
//                                   isLoopElement,
//                                   isCondition,
//                                   index,
//                                   frameChildren,
//                                   isLastChild
//                               }) {
//     // Generate names for the child and extendFrame
//     const name = generateChildName(child);
//     const extendFrameName = generateExtendFrameName({ frameChildren, index, isCondition });
//
//     // Build styles for the child
//     const style = {
//         ...child?.style ?? {},
//         [frame?.layoutMode === 'HORIZONTAL' ? 'marginRight' : 'marginBottom']: frame?.itemSpacing ?? 0,
//         flex: getFlexValue({ child, frame }),
//         backdropFilter: getBackgroundBlurEffect(child),
//         WebkitBackdropFilter: getBackgroundBlurEffect(child),
//         filter: getLayerBlurEffect(child)
//     };
//
//     // Build styles for the child frame
//     const childFrameStyles = {
//         flexWrap: transformLayoutWrap(frame?.layoutWrap),
//         flex: getFlexValue({ child, frame })
//     };
//
//     // Create the modified child object
//     return {
//         ...child,
//         name,
//         module,
//         isLoopElement,
//         style,
//         extendFrame: extendFrameName ? `./${extendFrameName}.yml` : undefined,
//         childFrame: {
//             base: frame?.layoutMode === 'HORIZONTAL' ? 'row.start' : 'column.start',
//             id: sanitizeFullColon(`${name}_frame`),
//             styles: childFrameStyles
//         }
//     };
// }
//
// // Helper function to generate a sanitized child name
// function generateChildName(child) {
//     const rawName = `i${child?.id}_${firstUpperCaseRestSmall(child?.name || '')}`;
//     return rawName.replace(/[^a-zA-Z0-9]/g, '_');
// }
//
// // Helper function to generate the extendFrame name
// function generateExtendFrameName({ frameChildren, index, isCondition }) {
//     if (index <= 0 || (isCondition && index === 1)) return undefined;
//     const previousChild = frameChildren[index - 1];
//     const rawName = `i${previousChild?.id}_${firstUpperCaseRestSmall(previousChild?.name || '')}`;
//     return rawName.replace(/[^a-zA-Z0-9]/g, '_');
// }
//
// // Helper function to build styles for loop elements
// function buildLoopStyles({ child, frame }) {
//     return {
//         display: 'flex',
//         color: 'transparent',
//         flexDirection: child?.layoutMode === 'VERTICAL' ? 'column' : 'row',
//         flexWrap: transformLayoutWrap(child?.layoutWrap),
//         justifyContent: transformLayoutAxisAlign(
//             child?.layoutMode === 'VERTICAL'
//                 ? child?.primaryAxisAlignItems
//                 : child?.counterAxisAlignItems
//         ),
//         alignItems: transformLayoutAxisAlign(
//             child?.layoutMode === 'VERTICAL'
//                 ? child?.counterAxisAlignItems
//                 : child?.primaryAxisAlignItems
//         ),
//         flex: getFlexValue({ child, frame })
//     };
// }
//
// // Helper function to build styles for non-loop elements
// function buildChildStyles({ child, frame }) {
//     return {
//         ...child?.styles ?? {},
//         boxShadow: getDropShadowEffect(child),
//         backdropFilter: getBackgroundBlurEffect(child),
//         WebkitBackdropFilter: getBackgroundBlurEffect(child),
//         filter: getLayerBlurEffect(child),
//         flex: getFlexValue({ child, frame })
//     };
// }
//
// // Helper function to build styles for the main frame
// function buildMainFrameStyles({ child, frame, backgroundImage, isLastChild }) {
//     return {
//         spaceValue: isLastChild ? 0 : frame?.itemSpacing ?? 0,
//         paddingLeft: child?.paddingLeft,
//         paddingRight: child?.paddingRight,
//         paddingTop: child?.paddingTop,
//         paddingBottom: child?.paddingBottom,
//         flexWrap: transformLayoutWrap(child?.layoutWrap),
//         flex: getFlexValue({ child, frame }),
//         justifyContent: transformLayoutAxisAlign(
//             child?.layoutMode === 'VERTICAL'
//                 ? child?.primaryAxisAlignItems
//                 : child?.counterAxisAlignItems
//         ),
//         alignItems: transformLayoutAxisAlign(
//             child?.layoutMode === 'VERTICAL'
//                 ? child?.counterAxisAlignItems
//                 : child?.primaryAxisAlignItems
//         ),
//         width: getSize(child?.layoutSizingHorizontal, child?.absoluteRenderBounds?.width),
//         height: getSize(child?.layoutSizingVertical, child?.absoluteRenderBounds?.height),
//         ...getContainerLikeStyles(child, backgroundImage),
//         boxShadow: getDropShadowEffect(child),
//         backdropFilter: getBackgroundBlurEffect(child),
//         WebkitBackdropFilter: getBackgroundBlurEffect(child),
//         filter: getLayerBlurEffect(child)
//     };
// }
//
// // Helper function to determine flex value based on layout sizing
// function getFlexValue({ child, frame }) {
//     if (frame?.layoutMode === 'VERTICAL') {
//         return child?.layoutSizingVertical === 'FILL' ? 1 : undefined;
//     } else {
//         return child?.layoutSizingHorizontal === 'FILL' ? 1 : undefined;
//     }
// }