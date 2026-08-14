import {
    getDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren,
} from './figma/index.mjs';
import {isRouteSurfaceName} from '../shared/routing.mjs';

export async function translateFigmaToSpecs({data, srcPath, token, figFile, downloadAssets = false}) {
    const document = getDesignDocument(data);
    const children = await getPagesAndTraverseChildren({
        document,
        components: data?.components,
        srcPath,
        token,
        figFile,
        downloadAssets,
    });
    await walkFrameChildren({children, srcPath, token, figFile});
    const pages = children
        .filter(item => isRouteSurfaceName(`${item?.name}`.split(' ')[0]))
        .map(item => ({
            name: item?.name,
            module: item?.module,
            id: item?.id,
            presentation: item?.surfacePresentation,
        }));
    return {document, children, pages, initialId: document?.flowStartingPoints?.[0]?.nodeId};
}
