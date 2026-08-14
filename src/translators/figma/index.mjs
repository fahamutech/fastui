/**
 * Public surface of the Figma translator: downloading/reading the design
 * file (client.mjs) and turning it into FastUI YAML specs (tree.mjs).
 */
export {fetchFigmaFile, getDesignDocument, getFigmaCachePath} from './client.mjs';
export {getPagesAndTraverseChildren, walkFrameChildren} from './tree.mjs';
export {resolvePrototypeRoute} from './route.mjs';
