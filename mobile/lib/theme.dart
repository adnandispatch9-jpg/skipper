import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

/// Skipper's palette, taken from the dashboard's dark and light tokens (public/app.css).
@immutable
class SkipperColors extends ThemeExtension<SkipperColors> {
  const SkipperColors({
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.border,
    required this.text,
    required this.muted,
    required this.faint,
    required this.accent,
    required this.accentSoft,
    required this.onAccent,
    required this.working,
    required this.workingSoft,
    required this.waiting,
    required this.waitingSoft,
    required this.sleeping,
    required this.sleepingSoft,
    required this.ended,
    required this.permission,
    required this.permissionSoft,
    required this.danger,
  });

  final Color bg, surface, surface2, border, text, muted, faint, accent, accentSoft, onAccent;
  final Color working, workingSoft, waiting, waitingSoft, sleeping, sleepingSoft, ended, permission, permissionSoft, danger;

  static const dark = SkipperColors(
    bg: Color(0xFF101113),
    surface: Color(0xFF17181B),
    surface2: Color(0xFF1F2125),
    border: Color(0xFF2B2D33),
    text: Color(0xFFECEBE6),
    muted: Color(0xFFA29F97),
    faint: Color(0xFF8D8A83),
    accent: Color(0xFF8EA2FF),
    accentSoft: Color(0xFF232A4A),
    onAccent: Color(0xFF0D1020),
    working: Color(0xFF3CCF8E),
    workingSoft: Color(0xFF173527),
    waiting: Color(0xFFF0A93B),
    waitingSoft: Color(0xFF3A2A12),
    sleeping: Color(0xFFA78BFA),
    sleepingSoft: Color(0xFF2A2244),
    ended: Color(0xFF77746D),
    permission: Color(0xFFFF8A4C),
    permissionSoft: Color(0xFF3D1F10),
    danger: Color(0xFFF07171),
  );

  static const light = SkipperColors(
    bg: Color(0xFFF6F5F1),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFEFEDE7),
    border: Color(0xFFE2DFD6),
    text: Color(0xFF1C1B19),
    muted: Color(0xFF66635C),
    faint: Color(0xFF6D6961),
    accent: Color(0xFF2F4BD8),
    accentSoft: Color(0xFFE6EAFC),
    onAccent: Color(0xFFFFFFFF),
    working: Color(0xFF13774E),
    workingSoft: Color(0xFFDDF3E8),
    waiting: Color(0xFF995C00),
    waitingSoft: Color(0xFFFBECD2),
    sleeping: Color(0xFF694BDF),
    sleepingSoft: Color(0xFFEBE5FD),
    ended: Color(0xFF8F8B82),
    permission: Color(0xFFB73D0D),
    permissionSoft: Color(0xFFFDE4D6),
    danger: Color(0xFFBF3838),
  );

  Color stateColor(String state) => switch (state) {
        'permission' => permission,
        'waiting' => waiting,
        'working' => working,
        'sleeping' => sleeping,
        _ => ended,
      };

  Color stateSoft(String state) => switch (state) {
        'permission' => permissionSoft,
        'waiting' => waitingSoft,
        'working' => workingSoft,
        'sleeping' => sleepingSoft,
        _ => surface2,
      };

  @override
  SkipperColors copyWith() => this;

  @override
  SkipperColors lerp(ThemeExtension<SkipperColors>? other, double t) => t < 0.5 ? this : (other as SkipperColors? ?? this);
}

ThemeData skipperTheme(Brightness brightness) {
  final c = brightness == Brightness.dark ? SkipperColors.dark : SkipperColors.light;
  final base = ThemeData(brightness: brightness, useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: c.bg,
    colorScheme: ColorScheme.fromSeed(seedColor: c.accent, brightness: brightness).copyWith(
      primary: c.accent,
      onPrimary: c.onAccent,
      surface: c.surface,
      onSurface: c.text,
      error: c.danger,
    ),
    textTheme: base.textTheme.apply(bodyColor: c.text, displayColor: c.text, fontFamily: '.SF Pro Text'),
    dividerColor: c.border,
    appBarTheme: AppBarTheme(backgroundColor: c.bg, foregroundColor: c.text, elevation: 0, scrolledUnderElevation: 0, centerTitle: true),
    cupertinoOverrideTheme: CupertinoThemeData(primaryColor: c.accent, brightness: brightness),
    extensions: [c],
  );
}

extension SkipperThemeX on BuildContext {
  SkipperColors get colors => Theme.of(this).extension<SkipperColors>()!;
}

/// Small uppercase section label, like `.label` on the dashboard.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(
        child: Text(text.toUpperCase(),
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.7, color: context.colors.faint)),
      ),
      ?trailing,
    ]);
  }
}

class SurfaceCard extends StatelessWidget {
  const SurfaceCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.borderColor, this.onTap});
  final Widget child;
  final EdgeInsets padding;
  final Color? borderColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: borderColor ?? c.border)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
  }
}

class StateDot extends StatelessWidget {
  const StateDot(this.state, {super.key, this.size = 8});
  final String state;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = context.colors.stateColor(state);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: state == 'working' ? [BoxShadow(color: color.withValues(alpha: 0.25), spreadRadius: 3)] : null,
      ),
    );
  }
}

class StateChip extends StatelessWidget {
  const StateChip(this.state, this.label, {super.key});
  final String state;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: c.stateSoft(state), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        StateDot(state, size: 7),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: c.stateColor(state), fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

/// A row of progress segments, like the dashboard's plan bar.
class Segments extends StatelessWidget {
  const Segments({super.key, required this.done, required this.total, this.color});
  final int done;
  final int total;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    if (total <= 0) return const SizedBox.shrink();
    return Row(
      children: [
        for (var i = 0; i < total; i++) ...[
          if (i > 0) const SizedBox(width: 3),
          Expanded(
            child: Container(height: 4, decoration: BoxDecoration(color: i < done ? (color ?? c.working) : c.border, borderRadius: BorderRadius.circular(2))),
          ),
        ],
      ],
    );
  }
}
