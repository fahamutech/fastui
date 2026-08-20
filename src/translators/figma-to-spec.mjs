import {
    getDesignDocument,
    getPagesAndTraverseChildren,
    walkFrameChildren,
} from './figma/index.mjs';
import {isRouteSurfaceName} from '../shared/routing.mjs';
import {reconcileFigmaResources} from './figma/resources.mjs';

export async function translateFigmaToSpecs({data, srcPath, token, figFile, downloadAssets = false, template = 'reactjs', projectPath = process.cwd()}) {
    const document = getDesignDocument(data);
    const resources = await reconcileFigmaResources({
        document,
        token,
        figFile,
        projectPath,
        template,
        fresh: downloadAssets,
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
        .filter(item => isRouteSurfaceName(`${item?.name}`.split(' ')[0]))
        .map(item => ({
            name: item?.name,
            module: item?.module,
            id: item?.id,
            presentation: item?.surfacePresentation,
        }));
    return {document, children, pages, initialId: document?.flowStartingPoints?.[0]?.nodeId, resources};
}
