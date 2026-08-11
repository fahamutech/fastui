import {getFileName} from './index.mjs';
import {routeFromSurfaceName} from './navigation.mjs';

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
import {appState} from './stores/observable_store.mjs';

const currentRoute = new BehaviorSubject(undefined);
const routeEvents = new Subject();

function normalizeRoute(route, fallbackType = 'page') {
  if (typeof route === 'string') return {name: route.replace(/^\\//, ''), type: fallbackType};
  const type = route?.type === 'bottom_sheet' ? 'sheet' : (route?.type ?? fallbackType);
  return {...route, name: route?.name ? String(route.name).replace(/^\\//, '') : undefined, type};
}

async function guardNavigation(intent) {
  // Compatibility for existing callback-style user guards.
  if (beforeNavigate.length >= 2) {
    return new Promise(resolve => beforeNavigate(
      {prev: intent.previous, next: intent.next},
      route => resolve(route ? {decision: 'allow', route} : {decision: 'cancel'}),
    ));
  }
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
    window.history[method]({fastuiRoute: resolved}, '', '/' + resolved.name);
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
    const path = window.location.pathname.replace(/^\\//, '');
    void setCurrentRoute(event.state?.fastuiRoute ?? {name: path, type: 'page'}, false, 'browser');
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
    return `import {lazy, Suspense, useEffect, useState} from 'react';
import {listeningForRouteChange, setCurrentRoute} from './routing.mjs';
${routes.map(lazyImport).join('\n')}

${routeSwitch('getPageRoute', routes.filter(page => page.type === 'page'))}

${routeSwitch('getDialogRoute', routes.filter(page => page.type === 'dialog'))}

${routeSwitch('getSheetRoute', routes.filter(page => page.type === 'sheet'))}

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
    void setCurrentRoute({
      name: handlePathToRouteName(window.location.pathname),
      type: handlePathToRouteType(window.location.pathname),
    }, false, 'initial');
  }, []);

  return <Suspense fallback={<></>}>
    <div data-fastui-page style={{boxSizing: 'border-box', width: '100%', maxWidth: '100%', minWidth: 0, minHeight: '100dvh', overflowX: 'hidden'}}>{getPageRoute(currentPage)}</div>
    {currentDialog && <div role="dialog" aria-modal="true" style={{boxSizing: 'border-box', position: 'fixed', inset: 0, maxWidth: '100%', overflow: 'auto'}}>{getDialogRoute(currentDialog)}</div>}
    {currentSheet && <div role="dialog" aria-modal="true" data-fastui-sheet style={{boxSizing: 'border-box', position: 'fixed', inset: 0, maxWidth: '100%', display: 'flex', alignItems: 'flex-end', overflowX: 'hidden', overflowY: 'auto'}}>{getSheetRoute(currentSheet)}</div>}
  </Suspense>;
}
`;
}
