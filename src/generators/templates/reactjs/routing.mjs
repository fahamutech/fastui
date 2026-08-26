/**
 * React routing/AppRoute code generation: the runtime `routing.mjs` module,
 * the user-owned `routing_guard.mjs` stub, and the generated `AppRoute.jsx`
 * that lazily mounts every page/dialog/sheet surface FastUI discovered.
 */
import {ensureFileExist, ensurePathExist} from '../../../shared/fs.mjs';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {getFileName} from '../../naming.mjs';
import {routeFromSurfaceName} from '../../../shared/routing.mjs';
import {reactRuntimeSource} from './runtime.mjs';

export const reactGuardSource = `/**
 * User-owned navigation policy. Return allow, cancel, or redirect.
 * @param {{previous: object|null, next: object, operation: string, source: string}} intent
 */
export async function beforeNavigate(intent) {
  return {decision: 'allow', route: intent.next};
}
`;

export function normalizeRoutes(pages = []) {
    return pages.map(page => ({...page, ...routeFromSurfaceName(page?.name)}));
}

export function reactRoutingSource() {
    return `import {BehaviorSubject, Subject} from 'rxjs';
import {beforeNavigate} from './routing_guard.mjs';
import {appState} from './fastui_runtime.mjs';

const currentRoute = new BehaviorSubject(undefined);
const routeEvents = new Subject();

function normalizeRoute(route, fallbackType = 'page') {
  if (typeof route === 'string') return {name: route.replace(/^\\//, ''), type: fallbackType};
  const type = route?.type === 'bottom_sheet' ? 'sheet' : (route?.type ?? fallbackType);
  return {...route, name: route?.name ? String(route.name).replace(/^\\//, '') : undefined, type};
}

function browserRouteName() {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash;
  const path = hash.startsWith('#/') ? hash.slice(2) : window.location.pathname.replace(/^\\//, '');
  return path.split(/[?#]/, 1)[0];
}

function browserRouteUrl(name) {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/')
    ? '/#/' + name
    : '/' + name;
}

async function guardNavigation(intent) {
  const result = await beforeNavigate(intent);
  if (result === false || result?.decision === 'cancel') return {decision: 'cancel'};
  if (typeof result === 'string') return {decision: 'redirect', route: normalizeRoute(result)};
  if (result?.decision === 'redirect') {
    return {...result, route: normalizeRoute(result.route ?? result.redirect, intent.next.type)};
  }
  return {decision: 'allow', route: normalizeRoute(result?.route ?? intent.next, intent.next.type)};
}

export async function setCurrentRoute(route, pushToHistory = true, source = 'action') {
  const requested = normalizeRoute(route);
  const operation = requested.type === 'back' || requested.type === 'close'
    ? requested.type
    : requested.replace ? 'replace' : 'open';
  const result = await guardNavigation({previous: currentRoute.value ?? null, next: requested, operation, source});
  if (result.decision === 'cancel') return false;
  const next = normalizeRoute(result.route ?? requested, requested.type);
  const previous = currentRoute.value;

  if (next.type === 'close' || next.type === 'back') {
    if (previous?.type === 'dialog' || previous?.type === 'sheet') {
      currentRoute.next(previous.parent);
      appState.set({route: previous.parent});
      routeEvents.next({type: 'close', previous});
    } else if (next.type === 'back' && pushToHistory && typeof window !== 'undefined') {
      window.history.back();
    }
    return true;
  }

  const resolved = next.type === 'dialog' || next.type === 'sheet'
    ? {...next, parent: previous?.type === 'page' ? previous : previous?.parent}
    : next;
  currentRoute.next(resolved);
  appState.set({route: resolved});
  routeEvents.next(resolved);
  if (pushToHistory && resolved.type === 'page' && typeof window !== 'undefined') {
    const method = resolved.replace ? 'replaceState' : 'pushState';
    window.history[method]({fastuiRoute: resolved}, '', browserRouteUrl(resolved.name));
  }
  return true;
}

export function listeningForRouteChange(fn) {
  return routeEvents.subscribe(fn);
}

export function getCurrentRouteValue() {
  return currentRoute.value;
}

if (typeof window !== 'undefined') {
  window.onpopstate = event => {
    void setCurrentRoute(event.state?.fastuiRoute ?? {name: browserRouteName(), type: 'page'}, false, 'browser');
  };
  window.onhashchange = () => {
    void setCurrentRoute({name: browserRouteName(), type: 'page'}, false, 'browser');
  };
}
`;
}

function lazyImport(page) {
    const module = `${page?.module ?? ''}`.replace(/^\/+|\/+$/g, '');
    const component = getFileName(page.surfaceName);
    return `const ${component} = lazy(() => import('./modules/${module ? `${module}/` : ''}${page.surfaceName}').then(value => ({default: value.${component}})));`;
}

function routeSwitch(name, routes) {
    const cases = routes.map(page => `    case '${page.name}': return <${getFileName(page.surfaceName)} />;`).join('\n');
    return `function ${name}(current) {\n  switch (current) {\n${cases}\n    default: return <></>;\n  }\n}`;
}

export function reactAppRouteSource({pages, initialId}) {
    const routes = normalizeRoutes(pages);
    const initialPage = routes.find(page => page?.id === initialId && page.type === 'page')?.name
        ?? routes.find(page => page.type === 'page')?.name
        ?? 'home';
    const pathCases = routes.map(page => `    case '/${page.name}': return '${page.name}';`).join('\n');
    const pathTypeCases = routes.map(page => `    case '/${page.name}': return '${page.type}';`).join('\n');
    const presentations = Object.fromEntries(routes.map(page => [page.name, page.presentation ?? {
        mode: page.type === 'page' ? 'flow' : 'overlay',
        placement: 'stretch',
        safeArea: false,
        scroll: 'none',
        barrier: {dismissible: false, color: 'transparent'},
        transition: {type: 'none', durationMs: 0},
    }]));
    return `import {lazy, Suspense, useEffect, useState} from 'react';
import {listeningForRouteChange, setCurrentRoute} from './routing.mjs';
${routes.map(lazyImport).join('\n')}

${routeSwitch('getPageRoute', routes.filter(page => page.type === 'page'))}

${routeSwitch('getDialogRoute', routes.filter(page => page.type === 'dialog'))}

${routeSwitch('getSheetRoute', routes.filter(page => page.type === 'sheet'))}

const surfacePresentations = ${JSON.stringify(presentations)};

function SurfaceHost({name, children}) {
  const presentation = surfacePresentations[name];
  if (!presentation || presentation.mode !== 'overlay') return children;
  const placement = {
    center: ['center', 'center'], topStart: ['flex-start', 'flex-start'],
    topCenter: ['center', 'flex-start'], topEnd: ['flex-end', 'flex-start'],
    bottomStart: ['flex-start', 'flex-end'], bottomCenter: ['center', 'flex-end'],
    bottomEnd: ['flex-end', 'flex-end'], stretch: ['stretch', 'stretch'],
  }[presentation.placement] ?? ['stretch', 'stretch'];
  const style = {
    position: 'fixed', inset: 0, display: 'flex',
    justifyContent: placement[0], alignItems: placement[1],
    backgroundColor: presentation.barrier?.color,
    padding: presentation.safeArea ? 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' : undefined,
  };
  return <div role="dialog" aria-modal="true" data-fastui-surface={name} style={style}>{children}</div>;
}

function handlePathToRouteName(pathname) {
  const path = String(pathname).startsWith('/') ? String(pathname) : '/' + pathname;
  switch (path) {
${pathCases}
    default: return '${initialPage}';
  }
}

function handlePathToRouteType(pathname) {
  const path = String(pathname).startsWith('/') ? String(pathname) : '/' + pathname;
  switch (path) {
${pathTypeCases}
    default: return 'page';
  }
}

function currentLocationPath() {
  const hashPath = window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1)
    : '';
  return hashPath || window.location.pathname;
}

export function AppRoute() {
  const [currentPage, setCurrentPage] = useState('');
  const [currentDialog, setCurrentDialog] = useState();
  const [currentSheet, setCurrentSheet] = useState();

  useEffect(() => {
    const subscription = listeningForRouteChange(value => {
      setCurrentDialog(undefined);
      setCurrentSheet(undefined);
      if (value?.type === 'close' || value?.type === 'back') return;
      if (value?.type === 'dialog' && value?.name) setCurrentDialog(handlePathToRouteName(value.name));
      else if (value?.type === 'sheet' && value?.name) setCurrentSheet(handlePathToRouteName(value.name));
      else setCurrentPage(handlePathToRouteName(value?.name ?? value));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const path = currentLocationPath();
    void setCurrentRoute({
      name: handlePathToRouteName(path),
      type: handlePathToRouteType(path),
    }, false, 'initial');
  }, []);

  return <Suspense fallback={<></>}>
    {getPageRoute(currentPage)}
    {currentDialog && <SurfaceHost name={currentDialog}>{getDialogRoute(currentDialog)}</SurfaceHost>}
    {currentSheet && <SurfaceHost name={currentSheet}>{getSheetRoute(currentSheet)}</SurfaceHost>}
  </Suspense>;
}
`;
}

/**
 * Writes/refreshes the generated React AppRoute, routing store, and the
 * user-owned navigation guard, creating the current guard contract when absent.
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<void>}
 */
export async function ensureReactAppRouteFile({pages, initialId}) {
    const nextComponentFilePath = resolve(join('src', 'AppRoute.jsx'));
    const nextStateFilePath = resolve(join('src', 'routing.mjs'));
    const nextGuardFilePath = resolve(join('src', 'routing_guard.mjs'));
    await ensurePathExist(resolve('src'));
    await writeFile(resolve('src', 'fastui_runtime.mjs'), reactRuntimeSource());
    await ensureFileExist(nextGuardFilePath);
    let currentGuard = '';
    try { currentGuard = await readFile(nextGuardFilePath, 'utf8'); } catch (_) {}
    if (!currentGuard.includes('beforeNavigate')) {
        await writeFile(nextGuardFilePath, reactGuardSource);
    }
    await writeFile(nextStateFilePath, reactRoutingSource());
    await writeFile(nextComponentFilePath, reactAppRouteSource({pages, initialId}));
}
