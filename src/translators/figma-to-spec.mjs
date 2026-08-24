import {
    getDesignDocument,
    getNodeDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren,
} from './figma/index.mjs';
import {isRouteSurfaceName} from '../shared/routing.mjs';
import {reconcileFigmaResources} from './figma/resources.mjs';

export async function translateFigmaToSpecs({data, nodeIds, srcPath, token, figFile, downloadAssets = false, template = 'reactjs', projectPath = process.cwd()}) {
    const hasSelectedNodes = Array.isArray(nodeIds) && nodeIds.length > 0;
    const document = hasSelectedNodes ? getNodeDesignDocument(data, nodeIds) : getDesignDocument(data);
    const resources = await reconcileFigmaResources({
        document,
        token,
        figFile,
        projectPath,
        template,
        fresh: downloadAssets,
        preserveExisting: hasSelectedNodes,
    });
    const children = await getPagesAndTraverseChildren({
        document,
        components: data?.components,
        srcPath,
        token,
        figFile,
        downloadAssets: false,
        projectPath,
    });
    await walkFrameChildren({children, srcPath, token, figFile});
    const pages = children
        .filter(item => hasSelectedNodes
            ? `${item?.id ?? ''}`.startsWith('fastui-selected-')
            : isRouteSurfaceName(`${item?.name}`.split(' ')[0]))
        .map(item => ({
            name: item?.name,
            module: item?.module,
            id: item?.id,
            sourceId: item?.sourceNodeId ?? item?.id,
            presentation: item?.surfacePresentation,
        }));
    return {document, children, pages, initialId: document?.flowStartingPoints?.[0]?.nodeId, resources};
}
