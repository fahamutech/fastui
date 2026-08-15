/**
 * Flutter routing/AppRoute code generation: the generated `app_route.dart`
 * router wiring plus the user-owned `routing_guard.dart` stub.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {ensureFileExist} from '../../../shared/fs.mjs';
import {getFileName} from '../../naming.mjs';
import {routeFromSurfaceName} from '../../../shared/routing.mjs';
import {flutterRoutingGuardSource, flutterRuntimeSource} from './runtime.mjs';

function dartColor(value) {
    const rgba = `${value ?? ''}`.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (rgba) return `Color.fromRGBO(${Math.round(Number(rgba[1]))}, ${Math.round(Number(rgba[2]))}, ${Math.round(Number(rgba[3]))}, ${rgba[4] ?? 1})`;
    const hex = `${value ?? ''}`.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) return `Color(0x${hex[1].length === 6 ? 'FF' : ''}${hex[1].toUpperCase()})`;
    return 'Colors.transparent';
}

function routeEntry(page) {
    const presentation = page.presentation ?? {};
    const barrier = presentation.barrier ?? {};
    const transition = presentation.transition ?? {};
    return `  '${page.name}': FastUISurfaceDefinition(
    type: '${page.type}',
    presentation: FastUISurfacePresentation(
      mode: '${presentation.mode ?? (page.type === 'page' ? 'flow' : 'overlay')}',
      placement: '${presentation.placement ?? 'stretch'}',
      safeArea: ${presentation.safeArea === true},
      barrierDismissible: ${barrier.dismissible === true},
      barrierColor: ${dartColor(barrier.color)},
      backgroundColor: Colors.transparent,
      transition: '${transition.type ?? 'none'}',
      direction: '${transition.direction ?? 'none'}',
      durationMs: ${Number.isFinite(Number(transition.durationMs)) ? Number(transition.durationMs) : 0},
    ),
    builder: () => ${getFileName(page.surfaceName)}(),
  ),`;
}

/**
 * Writes/refreshes the generated Flutter app_route.dart router wiring, the
 * shared fastui_runtime.dart, and the user-owned routing_guard.dart (only
 * seeding the guard the first time it's created).
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<void>}
 */
export async function ensureFlutterAppRouteFile({pages, initialId}) {
    const rawInitialPage = pages.find(page => page?.id === initialId && routeFromSurfaceName(page?.name).type === 'page');
    const initialPage = routeFromSurfaceName(
        rawInitialPage?.name ?? pages.find(page => routeFromSurfaceName(page?.name).type === 'page')?.name ?? 'home_page'
    ).name;
    const routes = pages.map(page => ({
        ...page,
        ...routeFromSurfaceName(page?.name)
    }));
    const imports = routes.map(page => {
        const module = `${page?.module ?? ''}`.replace(/^\/+|\/+$/g, '');
        return `import './modules/${module ? `${module}/` : ''}${page.surfaceName}.dart';`;
    }).join('\n');
    const routeEntries = routes.map(routeEntry).join('\n');
    const outputPath = resolve(join('lib', 'app_route.dart'));
    const guardPath = resolve(join('lib', 'routing_guard.dart'));
    await ensureFileExist(outputPath);
    await ensureFileExist(guardPath);
    let guardSource = '';
    try { guardSource = await readFile(guardPath, 'utf8'); } catch (_) {}
    if (!guardSource.includes('beforeNavigate')) await writeFile(guardPath, flutterRoutingGuardSource);
    await writeFile(resolve(join('lib', 'fastui_runtime.dart')), flutterRuntimeSource());
    await writeFile(outputPath, `import 'package:flutter/material.dart';
import 'fastui_runtime.dart';
import 'routing_guard.dart';
${imports}

final fastUIRouter = FastUINavigation.createRouter(
  routes: <String, FastUISurfaceDefinition>{
${routeEntries}
  },
  initialRoute: '${initialPage}',
  guard: beforeNavigate,
);

class FastUIAppRoute extends StatelessWidget {
  const FastUIAppRoute({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      theme: FastUIStyleHelper.lightTheme(),
      darkTheme: FastUIStyleHelper.darkTheme(),
      themeMode: ThemeMode.system,
      routerDelegate: fastUIRouter,
      routeInformationParser: const FastUIRouteInformationParser(),
    );
  }
}
`);
}
