import {
    getDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren,
} from '../services/automation/figma.mjs';
import {isRouteSurfaceName} from '../services/navigation.mjs';

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
        .map(item => ({name: item?.name, module: item?.module, id: item?.id}));
    return {document, children, pages, initialId: document?.flowStartingPoints?.[0]?.nodeId};
}
