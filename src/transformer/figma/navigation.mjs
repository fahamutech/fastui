import {ensureFileExist} from "../../helpers/general.mjs";
import {join, resolve} from "node:path";
import {getFileName} from "../../generator/index.mjs";
import {absolutePathParse} from "../../helpers/setup.mjs";
import {writeFile} from "node:fs/promises";

/**
 *
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<*>}
 */
export async function ensureAppRouteFileExist({pages, initialId}) {
    const rawInitialPage = pages
        .filter(x => (x?.id === initialId) && `${x?.name}`.trim()?.endsWith('_page'))
        .shift();
    const initialPage = (rawInitialPage?.name ?? 'home')
        .replace('_page', '')
        .trim();
    pages = pages.map(x => {
        x.route_type = `${x?.name}`.split('_').pop();
        x.route_name = `${x?.name}`
            .replaceAll('_page', '')
            .replaceAll('_dialog', '');
        return x;
    });
    const componentFilePath = resolve(join('src', 'AppRoute.jsx'));
    const stateFilePath = resolve(join('src', 'routing.mjs'));
    const guardFilePath = resolve(join('src', 'routing_guard.mjs'));
    await ensureFileExist(componentFilePath);
    await ensureFileExist(stateFilePath);
    await ensureFileExist(guardFilePath);
    const importTrans = page => `import {${getFileName(page.name)}} from './modules/${page.module.replace(/^\/+/g, '')}/${page.name}';`;
    const guardFileContents = await import(absolutePathParse(guardFilePath));
    const shouldWriteGuardFs = typeof guardFileContents?.beforeNavigate !== "function";
    if (shouldWriteGuardFs) {
        await writeFile(guardFilePath, `
/**
 * 
 * @param prev {string|{name:string,type:string}}
 * @param next {string|{name:string,type:string}}
 * @param callback {(next:string|object)=>*}
 */
export function beforeNavigate({prev,next},callback){
    callback(next);
}`);
    }

    await writeFile(stateFilePath, `
import {BehaviorSubject} from "rxjs";
import {beforeNavigate} from './routing_guard.mjs';

const currentRoute = new BehaviorSubject(undefined);

/**
 *
 * @param route {string|{name: string, type: string, module: string}|{name: string, type: string}}
 * @param pushToState{boolean}
 */
export function setCurrentRoute(route,pushToState=true) {
    beforeNavigate({prev:currentRoute.value,next:route},(nextRoute)=>{
        nextRoute = \`\${nextRoute?.name??nextRoute}\`.trim()?.replace(/^\\//ig,'')??'';
        currentRoute.next({name: nextRoute, type: route?.type, module: route?.module});
       if(pushToState && \`\${route?.type}\`.toLowerCase()!=='dialog' && \`\${route?.type}\`.toLowerCase()!=='close'){
           window.history.pushState({}, '', \`/\${nextRoute}\`);
       }
    });
}

/**
 *
 * @param fn {function}
 */
export function listeningForRouteChange(fn) {
    return currentRoute.subscribe(fn);
}

export function getCurrentRouteValue() {
    return currentRoute.value;
}
if (typeof window !== 'undefined') {
    window.onpopstate = function (_) {
        const path = window.location.pathname.replace(/^\\//ig,'');
        beforeNavigate({prev:currentRoute.value,next:path},(nextRoute)=>{
            nextRoute = \`\${nextRoute?.name ?? nextRoute}\`.trim()?.replace(/^\\//ig,'')??'';
            currentRoute.next({name:nextRoute,type:'page'});
        });
    } 
}`);

    await writeFile(componentFilePath, `import {useState,useEffect} from 'react';
import {listeningForRouteChange,setCurrentRoute} from './routing.mjs';
${pages.map(importTrans).join('\n')}

function getPageRoute(current) {
    switch (current) {
    ${
        pages
            .filter(x => `${x?.route_type}`.toLowerCase() === 'page')
            .map(page => {
                return `
        case '${page?.route_name}':
            return <${getFileName(page.name)}/>`
            }).join('\n')
    }
        default:
            return <></>
    }
}

function getDialogRoute(current) {
    switch (current) {
    ${
        pages
            .filter(x => `${x?.route_type}`.toLowerCase() === 'dialog')
            .map(page => {
                return `
        case '${page?.route_name}':
            return <${getFileName(page.name)}/>`
            }).join('\n')
    }
        default:
            return <></>
    }
}

function handlePathToRouteName(pathname){
    pathname = \`\${pathname}\`.startsWith('/')?pathname:\`/\${pathname}\`;
    switch (pathname) {
        ${pages.map(page => {
        return `
        case '/${page?.route_name}':
            return '${page?.route_name}';`
    }).join('\n')}
        default:
            return '${initialPage}';
    }
}

export function AppRoute(){
    const [currentPage, setCurrentPage] = useState('');
    const [currentDialog, setCurrentDialog] = useState(undefined);
    
    useEffect(() => {
        const subs = listeningForRouteChange(value => {
            setCurrentDialog(undefined);
            if(value?.type==='close'){
                return;
            }
            if (value?.type === 'dialog' && value?.name) {
                setCurrentDialog(handlePathToRouteName(value?.name));
            } else  {
                // if (value?.type === 'page' || typeof value === 'string')
                setCurrentPage(handlePathToRouteName(value?.name ?? value));
            }
        });
        return () => subs.unsubscribe();
    }, []);

    useEffect(() => {
        setCurrentRoute(handlePathToRouteName(window.location.pathname),false)
    }, []);
    
    return (
        <>
            {getPageRoute(currentPage)}
            <div style={{display: currentDialog? 'block': 'none', position: 'fixed', top: 0, bottom: 0, left: 0, right: 0}}>
                {getDialogRoute(currentDialog)}
            </div>
        </>
    )
}
    `);
}