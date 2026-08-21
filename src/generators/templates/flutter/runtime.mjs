export function flutterRuntimeSource() {
    return `import 'dart:async';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'translations/generated.dart';

class FastUIProviderInstance<S> {
  const FastUIProviderInstance({
    required this.id,
    this.initialOverrides = const <String, dynamic>{},
  });
  final String id;
  final Map<String, dynamic> initialOverrides;

  @override
  bool operator ==(Object other) =>
      identical(this, other) || other is FastUIProviderInstance<S> && other.id == id;

  @override
  int get hashCode => Object.hash(S, id);
}

class FastUIComponentContext<S, N> {
  const FastUIComponentContext({
    required this.context,
    required this.ref,
    required this.state,
    required this.notifier,
    required this.inputs,
    required this.args,
    required this.componentId,
    required Map<String, void Function(dynamic)> setters,
  }) : _setters = setters;

  final BuildContext context;
  final WidgetRef ref;
  final S state;
  final N notifier;
  final Map<String, dynamic> inputs;
  final List<dynamic> args;
  final String componentId;
  final Map<String, void Function(dynamic)> _setters;

  void setState(String key, dynamic value) {
    final setter = _setters[key];
    if (setter == null) throw ArgumentError.value(key, 'key', 'No generated FastUI setter');
    setter(value);
  }
  T read<T>(ProviderListenable<T> provider) => ref.read(provider);
}

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

/// Runtime parser retained only for hand-authored service-computed style maps.
/// Static YAML and Figma styles are emitted as typed Flutter properties.
class FastUIStyleHelper {
  FastUIStyleHelper._();

  static ThemeData lightTheme() => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
    useMaterial3: true,
  );

  static ThemeData darkTheme() => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue, brightness: Brightness.dark),
    useMaterial3: true,
  );

  /// Parses a CSS length value that may carry a 'px' suffix.
  static double? _parseLen(dynamic v) {
    if (v is num) return v.toDouble();
    if (v is String) {
      return double.tryParse(v.replaceAll(RegExp(r'[a-zA-Z%]+\$'), ''));
    }
    return null;
  }

  /// Parses a CSS color string: hex #RRGGBB / #RRGGBBAA, rgba(), or a named
  /// CSS color keyword.
  static Color? _parseColor(dynamic raw) {
    if (raw is! String) return null;
    final v = raw.trim();
    if (RegExp(r'^#[0-9a-f]{3,8}\$', caseSensitive: false).hasMatch(v)) {
      var css = v.substring(1);
      if (css.length == 3 || css.length == 4) {
        css = css.split('').map((char) => '\$char\$char').join();
      }
      final hex = css.length == 6 ? 'FF\$css' : '\${css.substring(6)}\${css.substring(0, 6)}';
      try { return Color(int.parse(hex, radix: 16)); } catch (_) { return null; }
    }
    final m = RegExp(
      r'^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)\$',
      caseSensitive: false,
    ).firstMatch(v);
    if (m != null) {
      final a = m[4] != null ? (double.tryParse(m[4]!) ?? 1.0).clamp(0.0, 1.0) : 1.0;
      int channel(String value) => (double.tryParse(value) ?? 0).round().clamp(0, 255);
      return Color.fromRGBO(channel(m[1]!), channel(m[2]!), channel(m[3]!), a);
    }
    const named = <String, int>{
      'red': 0xFFFF0000, 'blue': 0xFF0000FF, 'green': 0xFF008000, 'lime': 0xFF00FF00,
      'yellow': 0xFFFFFF00, 'orange': 0xFFFFA500, 'purple': 0xFF800080, 'pink': 0xFFFFC0CB,
      'white': 0xFFFFFFFF, 'black': 0xFF000000, 'grey': 0xFF808080, 'gray': 0xFF808080,
      'cyan': 0xFF00FFFF, 'magenta': 0xFFFF00FF, 'brown': 0xFFA52A2A, 'teal': 0xFF008080,
      'navy': 0xFF000080, 'maroon': 0xFF800000, 'olive': 0xFF808000, 'silver': 0xFFC0C0C0,
      'coral': 0xFFFF7F50, 'salmon': 0xFFFA8072, 'indigo': 0xFF4B0082, 'violet': 0xFFEE82EE,
      'transparent': 0x00000000,
    };
    final code = named[v.toLowerCase()];
    return code != null ? Color(code) : null;
  }

  /// Builds a widget from a merged CSS-style map, covering the full CSS
  /// box model: background, dimensions, padding, margin, border, border-radius,
  /// box-shadow, opacity, overflow-clipping, and min/max constraints.
  static Widget buildBox(
    Map<String, dynamic> styles, {
    Widget? child,
  }) {
    final s = Map<String, dynamic>.from(styles);

    // Color
    final color = _parseColor(s['backgroundColor'] ?? s['background']);

    // Dimensions
    final w = _parseLen(s['width']);
    final h = _parseLen(s['height']);

    // Border radius
    final radius = _parseBorderRadius(s);

    // Border
    BorderSide borderSide(String side) {
      final borderClr = _parseColor(s['border\${side}Color'] ?? s['borderColor']);
      final borderW = _parseLen(s['border\${side}Width'] ?? s['borderWidth']) ?? 0.0;
      return borderClr != null && borderW > 0
          ? BorderSide(color: borderClr, width: borderW)
          : BorderSide.none;
    }
    final topBorder = borderSide('Top');
    final rightBorder = borderSide('Right');
    final bottomBorder = borderSide('Bottom');
    final leftBorder = borderSide('Left');
    final border = topBorder == BorderSide.none && rightBorder == BorderSide.none &&
            bottomBorder == BorderSide.none && leftBorder == BorderSide.none
        ? null
        : Border(top: topBorder, right: rightBorder, bottom: bottomBorder, left: leftBorder);

    // Padding / Margin
    final pad = _parseEdgeInsets(s, 'padding');
    final mar = _parseEdgeInsets(s, 'margin');

    // Box shadow
    final shadows = _parseBoxShadow(s['boxShadow']);

    // Background image
    final bgImg = _parseDecorationImage(s['backgroundImage'], s['backgroundSize'], s['backgroundPosition']);

    final hasDecoration = color != null || radius != null || border != null ||
        (shadows?.isNotEmpty ?? false) || bgImg != null;

    Widget result = Container(
      width: w,
      height: h,
      padding: pad,
      margin: mar,
      decoration: hasDecoration
          ? BoxDecoration(
              color: color,
              borderRadius: radius,
              border: border,
              boxShadow: shadows,
              image: bgImg,
            )
          : null,
      child: child,
    );

    // Min/Max constraints
    final minW = _parseLen(s['minWidth']);
    final maxW = _parseLen(s['maxWidth']);
    final minH = _parseLen(s['minHeight']);
    final maxH = _parseLen(s['maxHeight']);
    if (minW != null || maxW != null || minH != null || maxH != null) {
      result = ConstrainedBox(
        constraints: BoxConstraints(
          minWidth: minW ?? 0.0,
          maxWidth: maxW ?? double.infinity,
          minHeight: minH ?? 0.0,
          maxHeight: maxH ?? double.infinity,
        ),
        child: result,
      );
    }

    // Overflow clipping
    final overflow = (s['overflow'] ?? s['overflowX'] ?? '').toString().toLowerCase();
    if (overflow == 'hidden' || overflow == 'clip') {
      result = radius != null
          ? ClipRRect(borderRadius: radius, child: result)
          : ClipRect(child: result);
    }

    // Opacity
    final opacityVal = _parseLen(s['opacity']);
    if (opacityVal != null && opacityVal < 1.0) {
      result = Opacity(opacity: opacityVal.clamp(0.0, 1.0), child: result);
    }

    final layerBlur = _parseBlur(s['filter']);
    if (layerBlur != null) {
      result = ImageFiltered(
        imageFilter: ui.ImageFilter.blur(sigmaX: layerBlur, sigmaY: layerBlur),
        child: result,
      );
    }

    final backdropBlur = _parseBlur(s['backdropFilter'] ?? s['WebkitBackdropFilter']);
    if (backdropBlur != null) {
      result = ClipRect(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: backdropBlur, sigmaY: backdropBlur),
          child: result,
        ),
      );
    }

    return result;
  }

  /// Parses per-corner border-radius when no uniform shorthand is set.
  static BorderRadius? _parseBorderRadius(Map<String, dynamic> s) {
    final raw = s['borderRadius']?.toString().trim() ?? '';
    final values = raw.isEmpty
        ? <double>[]
        : raw.split(RegExp(r'\\s+')).map(_parseLen).whereType<double>().toList();
    if (values.length == 1) return BorderRadius.circular(values.first);
    if (values.length >= 2) {
      final tl = values[0];
      final tr = values[1];
      final br = values.length >= 3 ? values[2] : values[0];
      final bl = values.length >= 4 ? values[3] : values[1];
      return BorderRadius.only(
        topLeft: Radius.circular(tl), topRight: Radius.circular(tr),
        bottomRight: Radius.circular(br), bottomLeft: Radius.circular(bl),
      );
    }
    return _parseCornerRadius(s);
  }

  static BorderRadius? _parseCornerRadius(Map<String, dynamic> s) {
    final tl = _parseLen(s['borderTopLeftRadius']);
    final tr = _parseLen(s['borderTopRightRadius']);
    final br = _parseLen(s['borderBottomRightRadius']);
    final bl = _parseLen(s['borderBottomLeftRadius']);
    if (tl == null && tr == null && br == null && bl == null) return null;
    return BorderRadius.only(
      topLeft: Radius.circular(tl ?? 0),
      topRight: Radius.circular(tr ?? 0),
      bottomRight: Radius.circular(br ?? 0),
      bottomLeft: Radius.circular(bl ?? 0),
    );
  }

  /// Parses CSS padding/margin shorthand + individual side overrides into
  /// [EdgeInsets]. Shorthand "8", "8 16", "8 16 8", or "8 16 8 16" (T R B L).
  static EdgeInsets? _parseEdgeInsets(Map<String, dynamic> s, String prefix) {
    final raw = (s[prefix]?.toString() ?? '').trim();
    final parts = raw.isEmpty
        ? <double>[]
        : raw.split(RegExp(r'\\s+')).map((v) => _parseLen(v) ?? 0.0).toList();
    double shT = 0, shR = 0, shB = 0, shL = 0;
    if (parts.length == 1) {
      shT = shR = shB = shL = parts[0];
    } else if (parts.length == 2) {
      shT = shB = parts[0]; shL = shR = parts[1];
    } else if (parts.length == 3) {
      shT = parts[0]; shL = shR = parts[1]; shB = parts[2];
    } else if (parts.length >= 4) {
      shT = parts[0]; shR = parts[1]; shB = parts[2]; shL = parts[3];
    }
    final t = _parseLen(s['\${prefix}Top']) ?? shT;
    final r = _parseLen(s['\${prefix}Right']) ?? shR;
    final b = _parseLen(s['\${prefix}Bottom']) ?? shB;
    final l = _parseLen(s['\${prefix}Left']) ?? shL;
    if (t == 0 && r == 0 && b == 0 && l == 0) return null;
    return EdgeInsets.fromLTRB(l, t, r, b);
  }

  /// Parses a CSS box-shadow string "x y blur? spread? color?".
  static List<BoxShadow>? _parseBoxShadow(dynamic raw) {
    if (raw == null) return null;
    final v = raw.toString().trim();
    if (v.isEmpty || v == 'none') return null;
    final colorPat = RegExp(r'rgba?\\([^)]+\\)|#[0-9a-f]{3,8}', caseSensitive: false);
    final colorMatch = colorPat.firstMatch(v);
    final shadowColor = colorMatch != null ? _parseColor(colorMatch.group(0)) : null;
    final cleaned = v
        .replaceAll(RegExp(r'rgba?\\([^)]+\\)', caseSensitive: false), '')
        .replaceAll(RegExp(r'#[0-9a-f]{3,8}', caseSensitive: false), '');
    final nums = cleaned
        .split(RegExp(r'[\\s,]+'))
        .map((e) => _parseLen(e.trim()))
        .whereType<double>()
        .toList();
    if (nums.length < 2) return null;
    return [
      BoxShadow(
        offset: Offset(nums[0], nums[1]),
        blurRadius: nums.length > 2 ? nums[2] : 0,
        spreadRadius: nums.length > 3 ? nums[3] : 0,
        color: shadowColor ?? Colors.black26,
      ),
    ];
  }

  /// Parses a CSS background-image URL into a [DecorationImage].
  static double? _parseBlur(dynamic raw) {
    final match = RegExp(r'blur\(\s*([\d.]+)px\s*\)', caseSensitive: false)
        .firstMatch(raw?.toString() ?? '');
    return match == null ? null : double.tryParse(match.group(1)!);
  }

  static Alignment _parseBackgroundAlignment(dynamic raw) {
    return switch ((raw ?? 'center').toString().trim().toLowerCase()) {
      'top' => Alignment.topCenter,
      'bottom' => Alignment.bottomCenter,
      'left' => Alignment.centerLeft,
      'right' => Alignment.centerRight,
      'top left' || 'left top' => Alignment.topLeft,
      'top right' || 'right top' => Alignment.topRight,
      'bottom left' || 'left bottom' => Alignment.bottomLeft,
      'bottom right' || 'right bottom' => Alignment.bottomRight,
      _ => Alignment.center,
    };
  }

  static DecorationImage? _parseDecorationImage(dynamic bgImage, dynamic bgSize, dynamic bgPosition) {
    if (bgImage == null) return null;
    final m = RegExp(r'url\\(([^)]*)\\)', caseSensitive: false)
        .firstMatch(bgImage.toString());
    if (m == null) return null;
    final src = m.group(1)!
        .replaceAll(RegExp(r'''^['"]|['"]$'''), '')
        .replaceFirst(RegExp(r'^asset://figma/'), 'assets/images/figma/');
    final fit = bgSize?.toString().toLowerCase() == 'contain'
        ? BoxFit.contain
        : BoxFit.cover;
    final ImageProvider<Object> provider =
        RegExp(r'^https?://', caseSensitive: false).hasMatch(src)
            ? NetworkImage(src) as ImageProvider<Object>
            : AssetImage(src.replaceFirst(RegExp(r'^/'), '')) as ImageProvider<Object>;
    return DecorationImage(image: provider, fit: fit, alignment: _parseBackgroundAlignment(bgPosition));
  }

  static Widget applyMeta(Widget child, {dynamic id}) {
    final raw = id?.toString().trim();
    if (raw == null || raw.isEmpty) return child;
    return KeyedSubtree(
      key: ValueKey<String>(raw),
      child: Semantics(identifier: raw, child: child),
    );
  }
}

class FastUITranslationState {
  const FastUITranslationState({
    this.locale = 'default',
    this.catalogs = const <String, Map<String, String>>{
      'default': fastUITranslationsDefault,
    },
  });
  final String locale;
  final Map<String, Map<String, String>> catalogs;

  String translate(String key, {Map<String, dynamic> args = const {}}) {
    var value = catalogs[locale]?[key]
        ?? catalogs['default']?[key]
        ?? key;
    for (final entry in args.entries) {
      value = value.replaceAll('{\${entry.key}}', entry.value?.toString() ?? '');
    }
    return value;
  }
}

class FastUITranslationNotifier extends Notifier<FastUITranslationState> {
  @override
  FastUITranslationState build() => const FastUITranslationState();

  void setLocale(String locale) => state = FastUITranslationState(
        locale: locale,
        catalogs: state.catalogs,
      );

  void load(String locale, Map<String, String> entries) {
    state = FastUITranslationState(
      locale: state.locale,
      catalogs: <String, Map<String, String>>{
        ...state.catalogs,
        locale: <String, String>{...?state.catalogs[locale], ...entries},
      },
    );
  }
}

final fastUITranslationProvider =
    NotifierProvider<FastUITranslationNotifier, FastUITranslationState>(
  FastUITranslationNotifier.new,
);

class FastUITranslationRequest {
  const FastUITranslationRequest({
    required this.key,
    this.args = const <String, dynamic>{},
  });
  final String key;
  final Map<String, dynamic> args;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is FastUITranslationRequest &&
          other.key == key &&
          mapEquals(other.args, args);

  @override
  int get hashCode => Object.hash(key, Object.hashAll(args.entries));
}

final fastUITranslateProvider = Provider.family<String, FastUITranslationRequest>(
  (ref, request) => ref.watch(fastUITranslationProvider).translate(
        request.key,
        args: request.args,
      ),
);

class FastUIImage extends StatelessWidget {
  const FastUIImage({super.key, required this.source, this.width, this.height, this.fit});
  final String source;
  final double? width;
  final double? height;
  final BoxFit? fit;

  IconData get _fallbackIcon {
    final assetName = source.toLowerCase();
    if (assetName.contains('back')) return Icons.arrow_back;
    if (assetName.contains('forward')) return Icons.arrow_forward;
    return Icons.info_outline;
  }

  Widget _assetFallback() => SizedBox(
        width: width,
        height: height,
        child: Center(
          child: Icon(_fallbackIcon, size: width ?? height ?? 24),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final normalizedSource = source.replaceFirst(RegExp(r'^asset://figma/'), 'assets/images/figma/');
    final isSvg = Uri.tryParse(normalizedSource)?.path.toLowerCase().endsWith('.svg') == true;
    if (normalizedSource.startsWith('http://') || normalizedSource.startsWith('https://')) {
      if (isSvg) {
        return SvgPicture.network(
          normalizedSource,
          width: width,
          height: height,
          fit: fit ?? BoxFit.contain,
          errorBuilder: (_, __, ___) => _assetFallback(),
        );
      }
      return Image.network(
        normalizedSource,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) => _assetFallback(),
      );
    }
    if (isSvg) {
      return SvgPicture.asset(
        normalizedSource.replaceFirst(RegExp(r'^/'), ''),
        width: width,
        height: height,
        fit: fit ?? BoxFit.contain,
        errorBuilder: (_, __, ___) => _assetFallback(),
      );
    }
    return Image.asset(
      normalizedSource.replaceFirst(RegExp(r'^/'), ''),
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (_, __, ___) => _assetFallback(),
    );
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
