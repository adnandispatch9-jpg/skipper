import 'dart:async';

import 'package:bonsoir/bonsoir.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api/client.dart';
import '../core/format.dart';
import '../state/providers.dart';
import '../theme.dart';

class FoundMac {
  const FoundMac(this.name, this.host, this.port);
  final String name;
  final String host;
  final int port;
}

class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  BonsoirDiscovery? _discovery;
  StreamSubscription? _events;
  final _found = <String, FoundMac>{};
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _discover();
  }

  @override
  void dispose() {
    _events?.cancel();
    _discovery?.stop();
    super.dispose();
  }

  Future<void> _discover() async {
    try {
      final discovery = BonsoirDiscovery(type: '_skipper._tcp');
      await discovery.initialize();
      _events = discovery.eventStream?.listen((event) {
        switch (event) {
          case BonsoirDiscoveryServiceFoundEvent():
            discovery.serviceResolver.resolveService(event.service);
          case BonsoirDiscoveryServiceResolvedEvent():
            final s = event.service;
            if (s.host != null && mounted) setState(() => _found[s.name] = FoundMac(s.name, s.host!.replaceFirst(RegExp(r'\.$'), ''), s.port));
          case BonsoirDiscoveryServiceLostEvent():
            if (mounted) setState(() => _found.remove(event.service.name));
          default:
        }
      });
      await discovery.start();
      _discovery = discovery;
    } catch (_) {
      // Discovery is a convenience; scanning or typing the address still works.
    }
  }

  Future<void> _pair(PairingInfo info) async {
    setState(() => (_busy = true, _error = null));
    try {
      await ref.read(pairingProvider.notifier).pair(info);
    } on SkipperException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan({FoundMac? expected}) async {
    final raw = await Navigator.of(context).push<String>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const _ScanPage()));
    if (raw == null) return;
    final info = PairingInfo.parse(raw);
    if (info == null) {
      setState(() => _error = 'That code is not a Skipper code. In Skipper on your Mac, choose Connect phone.');
      return;
    }
    await _pair(info);
  }

  Future<void> _manual({FoundMac? mac}) async {
    final result = await showModalBottomSheet<PairingInfo>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ManualSheet(mac: mac),
    );
    if (result != null) await _pair(result);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 24, 20, 24), children: [
          ClipRRect(borderRadius: BorderRadius.circular(15), child: Image.asset('assets/icon.png', width: 64, height: 64)),
          const SizedBox(height: 16),
          const Text('Connect to Skipper on your Mac', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, height: 1.15, letterSpacing: -0.5)),
          const SizedBox(height: 10),
          Text('Your phone talks to your Mac over this Wi-Fi. Nothing goes through the cloud.', style: TextStyle(color: c.muted, height: 1.45)),
          const SizedBox(height: 24),
          const SectionLabel('Found on this network'),
          const SizedBox(height: 10),
          if (_found.isEmpty)
            SurfaceCard(
              child: Row(children: [
                SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: c.faint)),
                const SizedBox(width: 12),
                Expanded(child: Text('Looking for Skipper… Start it on your Mac with network access turned on.', style: TextStyle(color: c.muted, fontSize: 13))),
              ]),
            )
          else
            for (final mac in _found.values)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SurfaceCard(
                  child: Row(children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(10)),
                      child: Icon(Icons.laptop_mac_rounded, color: c.accent, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(mac.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('${mac.host}:${mac.port}', style: TextStyle(color: c.muted, fontSize: 12.5)),
                      ]),
                    ),
                    FilledButton(
                      onPressed: _busy ? null : () => _manual(mac: mac),
                      style: FilledButton.styleFrom(backgroundColor: c.accent, foregroundColor: c.onAccent),
                      child: const Text('Connect'),
                    ),
                  ]),
                ),
              ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _busy ? null : _scan,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50), backgroundColor: c.surface2, foregroundColor: c.text),
            icon: const Icon(Icons.qr_code_scanner_rounded),
            label: const Text('Scan the code in Skipper', style: TextStyle(fontSize: 15)),
          ),
          const SizedBox(height: 8),
          Text('On your Mac, open Skipper and choose Connect phone.', textAlign: TextAlign.center, style: TextStyle(color: c.muted, fontSize: 12.5)),
          const SizedBox(height: 16),
          TextButton(onPressed: _busy ? null : _manual, child: const Text('Enter the address manually')),
          if (_busy) const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator())),
          if (_error != null)
            Container(
              margin: const EdgeInsets.only(top: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: c.waitingSoft, borderRadius: BorderRadius.circular(12)),
              child: Text(_error!, style: TextStyle(color: c.text)),
            ),
        ]),
      ),
    );
  }
}

class _ScanPage extends StatefulWidget {
  const _ScanPage();

  @override
  State<_ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<_ScanPage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan the Skipper code')),
      body: Stack(children: [
        MobileScanner(
          onDetect: (capture) {
            final value = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
            if (value == null || _done) return;
            _done = true;
            Navigator.of(context).pop(value);
          },
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            margin: const EdgeInsets.all(24),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(12)),
            child: const Text('Point the camera at the code shown by Skipper on your Mac.', style: TextStyle(color: Colors.white), textAlign: TextAlign.center),
          ),
        ),
      ]),
    );
  }
}

class _ManualSheet extends StatefulWidget {
  const _ManualSheet({this.mac});
  final FoundMac? mac;

  @override
  State<_ManualSheet> createState() => _ManualSheetState();
}

class _ManualSheetState extends State<_ManualSheet> {
  late final _host = TextEditingController(text: widget.mac?.host ?? '');
  late final _port = TextEditingController(text: '${widget.mac?.port ?? 4317}');
  final _token = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _host.dispose();
    _port.dispose();
    _token.dispose();
    super.dispose();
  }

  void _submit() {
    final pasted = PairingInfo.parse(_token.text);
    if (pasted != null) {
      Navigator.pop(context, pasted);
      return;
    }
    final port = int.tryParse(_port.text.trim());
    final token = _token.text.trim();
    if (_host.text.trim().isEmpty || port == null || token.length < 8) {
      setState(() => _error = 'Fill in the address, port and access token.');
      return;
    }
    Navigator.pop(context, PairingInfo(host: _host.text.trim(), port: port, token: token));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    InputDecoration field(String label) => InputDecoration(labelText: label, filled: true, fillColor: c.surface2, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none));
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.mac == null ? 'Connect manually' : 'Connect to ${widget.mac!.name}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text('Paste the link Skipper printed on your Mac, or type the token from it.', style: TextStyle(color: c.muted, fontSize: 13)),
        const SizedBox(height: 16),
        if (widget.mac == null) ...[
          TextField(controller: _host, decoration: field('Mac address, e.g. 192.168.1.5'), keyboardType: TextInputType.url, autocorrect: false),
          const SizedBox(height: 10),
          TextField(controller: _port, decoration: field('Port'), keyboardType: TextInputType.number),
          const SizedBox(height: 10),
        ],
        TextField(controller: _token, decoration: field('Access token or link'), autocorrect: false, enableSuggestions: false, onSubmitted: (_) => _submit()),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: c.danger))),
        const SizedBox(height: 16),
        FilledButton(onPressed: _submit, style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), backgroundColor: c.accent, foregroundColor: c.onAccent), child: const Text('Connect')),
      ]),
    );
  }
}
