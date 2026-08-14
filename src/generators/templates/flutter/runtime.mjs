export function flutterRuntimeSource() {
    return `import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'stores/observable_store.dart';

typedef FastUISurfaceBuilder = Widget Function();
typedef FastUINavigationGuard = Future<FastUINavigationDecision> Function(FastUINavigationIntent intent);

class FastUISurfacePresentation {
  const FastUISurfacePresentation({
    required this.mode,
    required this.placement,
    required this.safeArea,
    required this.barrierDismissible,
    required this.barrierColor,
    required this.backgroundColor,
    required this.transition,
    required this.direction,
    required this.durationMs,
  });
  final String mode;
  final String placement;
  final bool safeArea;
  final bool barrierDismissible;
  final Color barrierColor;
  final Color backgroundColor;
  final String transition;
  final String direction;
  final int durationMs;
}

class FastUISurfaceDefinition {
  const FastUISurfaceDefinition({required this.type, required this.presentation, required this.builder});
  final String type;
  final FastUISurfacePresentation presentation;
  final FastUISurfaceBuilder builder;
}

class FastUIRouteRef {
  const FastUIRouteRef({this.name, this.type = 'page', this.replace = false, this.params = const <String, dynamic>{}});
  final String? name;
  final String type;
  final bool replace;
  final Map<String, dynamic> params;

  FastUIRouteRef copyWith({String? name, String? type, bool? replace, Map<String, dynamic>? params}) =>
      FastUIRouteRef(name: name ?? this.name, type: type ?? this.type, replace: replace ?? this.replace, params: params ?? this.params);
}

class FastUINavigationIntent {
  const FastUINavigationIntent({required this.previous, required this.next, required this.operation, required this.source});
  final FastUIRouteRef? previous;
  final FastUIRouteRef next;
  final String operation;
  final String source;
}

enum FastUINavigationDecisionType { allow, cancel, redirect }

class FastUINavigationDecision {
  const FastUINavigationDecision._(this.type, [this.route]);
  const FastUINavigationDecision.allow() : this._(FastUINavigationDecisionType.allow);
  const FastUINavigationDecision.cancel() : this._(FastUINavigationDecisionType.cancel);
  const FastUINavigationDecision.redirect(FastUIRouteRef route) : this._(FastUINavigationDecisionType.redirect, route);
  final FastUINavigationDecisionType type;
  final FastUIRouteRef? route;
}

class FastUIRouteInformationParser extends RouteInformationParser<String> {
  const FastUIRouteInformationParser();

  @override
  Future<String> parseRouteInformation(RouteInformation routeInformation) async =>
      routeInformation.uri.path.replaceFirst(RegExp(r'^/'), '');

  @override
  RouteInformation restoreRouteInformation(String configuration) =>
      RouteInformation(uri: Uri(path: '/\$configuration'));
}

class FastUIRouterDelegate extends RouterDelegate<String>
    with ChangeNotifier, PopNavigatorRouterDelegateMixin<String> {
  FastUIRouterDelegate({required String initialRoute}) : _pages = <String>[initialRoute];

  final List<String> _pages;

  @override
  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  BuildContext? get overlayContext => navigatorKey.currentContext;
  String get currentName => _pages.last;

  @override
  String get currentConfiguration => currentName;

  void open(String name, {bool replace = false}) {
    if (replace && _pages.isNotEmpty) _pages.removeLast();
    if (_pages.isEmpty || _pages.last != name) _pages.add(name);
    notifyListeners();
  }

  bool popPage() {
    if (_pages.length <= 1) return false;
    _pages.removeLast();
    notifyListeners();
    return true;
  }

  @override
  Future<bool> popRoute() => FastUINavigation.systemBack();

  @override
  Future<void> setNewRoutePath(String configuration) async {
    if (configuration.isEmpty || configuration == currentName) return;
    await FastUINavigation.navigateByName(configuration, replace: true, source: 'browser');
  }

  @override
  Widget build(BuildContext context) => Navigator(
    key: navigatorKey,
    pages: _pages.map((name) => MaterialPage<void>(
      key: ValueKey<String>(name),
      name: '/\$name',
      child: FastUINavigation.surface(name),
    )).toList(),
    onDidRemovePage: (_) {},
  );
}

class FastUINavigation {
  FastUINavigation._();

  static Map<String, FastUISurfaceDefinition> _surfaces = const {};
  static FastUINavigationGuard? _guard;
  static FastUIRouterDelegate? _router;
  static FastUIRouteRef? _overlay;
  static final ValueNotifier<FastUIRouteRef?> currentRoute = ValueNotifier<FastUIRouteRef?>(null);

  static void _publishRoute(FastUIRouteRef? route, [BuildContext? context]) {
    currentRoute.value = route;
    if (context == null || route == null) return;
    try {
      FastUIStateScope.read(context).set(<String, dynamic>{
        'route': <String, dynamic>{'name': route.name, 'type': route.type, 'params': route.params},
      });
    } catch (_) {}
  }

  static FastUIRouterDelegate createRouter({
    required Map<String, FastUISurfaceDefinition> routes,
    required String initialRoute,
    FastUINavigationGuard? guard,
  }) {
    _surfaces = routes;
    _guard = guard;
    final router = FastUIRouterDelegate(initialRoute: initialRoute);
    _router = router;
    _publishRoute(FastUIRouteRef(name: initialRoute, type: routes[initialRoute]?.type ?? 'page'));
    return router;
  }

  static Widget surface(String name, {bool expand = false}) {
    final child = _surfaces[name]?.builder.call() ?? const SizedBox.shrink();
    final material = Material(type: MaterialType.transparency, child: child);
    return expand ? SizedBox.expand(child: material) : material;
  }

  static String _normalizeType(String type) => type == 'bottom_sheet' ? 'sheet' : type;

  static Future<FastUINavigationDecision> _decide(FastUINavigationIntent intent) async {
    if (_guard == null) return const FastUINavigationDecision.allow();
    try {
      return await _guard!(intent);
    } catch (_) {
      return const FastUINavigationDecision.cancel();
    }
  }

  static Future<T?> navigate<T>(
    BuildContext context, {
    String? name,
    String type = 'page',
    bool replace = false,
    String? transition,
    String? direction,
    int? durationMs,
    bool? barrierDismissible,
    Map<String, dynamic> params = const <String, dynamic>{},
    String source = 'action',
  }) => _navigate<T>(
    context: context,
    requested: FastUIRouteRef(name: name, type: _normalizeType(type), replace: replace, params: params),
    transition: transition,
    direction: direction,
    durationMs: durationMs,
    barrierDismissible: barrierDismissible,
    source: source,
  );

  static Future<void> navigateByName(String name, {bool replace = false, String source = 'action'}) async {
    final definition = _surfaces[name];
    if (definition == null) return;
    await _navigate<void>(
      context: _router?.overlayContext,
      requested: FastUIRouteRef(name: name, type: definition.type, replace: replace),
      source: source,
    );
  }

  static Future<bool> systemBack() async {
    final before = currentRoute.value;
    await _navigate<void>(
      context: _router?.overlayContext,
      requested: const FastUIRouteRef(type: 'back'),
      source: 'system',
    );
    return currentRoute.value != before;
  }

  static Future<T?> _navigate<T>({
    required BuildContext? context,
    required FastUIRouteRef requested,
    String? transition,
    String? direction,
    int? durationMs,
    bool? barrierDismissible,
    required String source,
  }) async {
    final operation = requested.type == 'back' || requested.type == 'close'
        ? requested.type
        : requested.replace ? 'replace' : 'open';
    final intent = FastUINavigationIntent(previous: currentRoute.value, next: requested, operation: operation, source: source);
    final decision = await _decide(intent);
    if (context != null && !context.mounted) return null;
    if (decision.type == FastUINavigationDecisionType.cancel) return null;
    final route = decision.type == FastUINavigationDecisionType.redirect ? decision.route! : requested;
    final type = _normalizeType(route.type);

    if (type == 'close' || type == 'back') {
      if (_overlay != null) {
        final navigator = _router?.navigatorKey.currentState;
        if (navigator?.canPop() == true) navigator!.pop<T>();
        _overlay = null;
        _publishRoute(FastUIRouteRef(name: _router?.currentName, type: 'page'), context);
        return null;
      }
      if (type == 'back' && _router?.popPage() == true) {
        _publishRoute(FastUIRouteRef(name: _router?.currentName, type: 'page'), context);
      }
      return null;
    }

    if (route.name == null || !_surfaces.containsKey(route.name)) return null;
    final presentation = _surfaces[route.name]!.presentation;
    if (type == 'page') {
      _router?.open(route.name!, replace: route.replace);
      _publishRoute(route.copyWith(type: 'page'), context);
      return null;
    }

    final overlayContext = context ?? _router?.overlayContext;
    if (overlayContext == null) return null;
    if (_overlay != null && _router?.navigatorKey.currentState?.canPop() == true) {
      _router!.navigatorKey.currentState!.pop();
      await Future<void>.delayed(Duration.zero);
      if (!overlayContext.mounted) return null;
    }
    _overlay = route.copyWith(type: type);
    _publishRoute(_overlay, overlayContext);
    final resolvedDuration = Duration(milliseconds: durationMs ?? presentation.durationMs);
    final resolvedDismissible = barrierDismissible ?? presentation.barrierDismissible;
    final positionedSurface = _position(surface(route.name!), presentation.placement);
    final presentedSurface = presentation.safeArea ? SafeArea(child: positionedSurface) : positionedSurface;
    final child = PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) {
          unawaited(_navigate<void>(context: overlayContext, requested: const FastUIRouteRef(type: 'close'), source: 'system'));
        }
      },
      child: presentedSurface,
    );
    Future<T?> result;
    if (type == 'sheet') {
      result = showModalBottomSheet<T>(
        context: overlayContext,
        useRootNavigator: true,
        isScrollControlled: true,
        useSafeArea: presentation.safeArea,
        isDismissible: resolvedDismissible,
        enableDrag: resolvedDismissible,
        barrierColor: presentation.barrierColor,
        backgroundColor: presentation.backgroundColor,
        routeSettings: RouteSettings(name: '/\${route.name}'),
        builder: (_) => child,
      );
    } else {
      result = showGeneralDialog<T>(
        context: overlayContext,
        useRootNavigator: true,
        barrierDismissible: resolvedDismissible,
        barrierLabel: resolvedDismissible ? 'Dismiss' : null,
        barrierColor: presentation.barrierColor,
        routeSettings: RouteSettings(name: '/\${route.name}'),
        transitionDuration: resolvedDuration,
        pageBuilder: (dialogContext, animation, secondaryAnimation) => child,
        transitionBuilder: (dialogContext, animation, secondaryAnimation, child) => _transition(
          animation,
          child,
          transition ?? presentation.transition,
          direction ?? presentation.direction,
        ),
      );
    }
    final value = await result;
    if (!overlayContext.mounted) return value;
    if (_overlay?.name == route.name) {
      _overlay = null;
      _publishRoute(FastUIRouteRef(name: _router?.currentName, type: 'page'), overlayContext);
    }
    return value;
  }

  static Widget _position(Widget child, String placement) {
    final alignment = switch (placement) {
      'center' => Alignment.center,
      'topStart' => Alignment.topLeft,
      'topCenter' => Alignment.topCenter,
      'topEnd' => Alignment.topRight,
      'bottomStart' => Alignment.bottomLeft,
      'bottomCenter' => Alignment.bottomCenter,
      'bottomEnd' => Alignment.bottomRight,
      _ => null,
    };
    return alignment == null ? child : Align(alignment: alignment, child: child);
  }

  static Widget _transition(Animation<double> animation, Widget child, String? transition, String? direction) {
    final kind = (transition ?? '').toUpperCase();
    if (kind.contains('MOVE') || kind.contains('SLIDE') || kind.contains('PUSH')) {
      final begin = switch ((direction ?? '').toUpperCase()) {
        'RIGHT' => const Offset(-1, 0),
        'TOP' => const Offset(0, 1),
        'BOTTOM' => const Offset(0, -1),
        _ => const Offset(1, 0),
      };
      return SlideTransition(position: Tween<Offset>(begin: begin, end: Offset.zero).animate(animation), child: child);
    }
    return FadeTransition(opacity: animation, child: child);
  }
}

class FastUIImage extends StatelessWidget {
  const FastUIImage({super.key, required this.source, this.width, this.height, this.fit});
  final String source;
  final double? width;
  final double? height;
  final BoxFit? fit;

  @override
  Widget build(BuildContext context) {
    final normalizedSource = source.replaceFirst(RegExp(r'^asset://figma/'), 'assets/images/figma/');
    final isSvg = Uri.tryParse(normalizedSource)?.path.toLowerCase().endsWith('.svg') == true;
    if (normalizedSource.startsWith('http://') || normalizedSource.startsWith('https://')) {
      if (isSvg) {
        return SvgPicture.network(normalizedSource, width: width, height: height, fit: fit ?? BoxFit.contain);
      }
      return Image.network(normalizedSource, width: width, height: height, fit: fit);
    }
    if (isSvg) {
      return SvgPicture.asset(normalizedSource.replaceFirst(RegExp(r'^/'), ''), width: width, height: height, fit: fit ?? BoxFit.contain);
    }
    return Image.asset(normalizedSource.replaceFirst(RegExp(r'^/'), ''), width: width, height: height, fit: fit);
  }
}
`;
}

export const flutterRoutingGuardSource = `import 'fastui_runtime.dart';

/// User-owned navigation policy. Return allow, cancel, or redirect.
Future<FastUINavigationDecision> beforeNavigate(FastUINavigationIntent intent) async {
  return const FastUINavigationDecision.allow();
}
`;
