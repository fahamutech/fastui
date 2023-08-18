export function getChildren(modifier) {
    const data = modifier?.props?.children;
    if (`${data}`?.startsWith('$')) {
        return {type: 'state', value: `${data}`?.replace(/[$]/ig, '')};
    } else {
        return {type: 'raw', value: data};
    }
}