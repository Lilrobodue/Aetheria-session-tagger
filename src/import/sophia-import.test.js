// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Sophia Import Tests
// Run:  node src/import/sophia-import.test.js
// ═══════════════════════════════════════════════════════════════

function createMockStorage() {
  var data = {};
  return {
    getItem: function (k) { return (k in data) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { data = {}; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
}

// ─── Test harness ───────────────────────────────────────────────

var passed = 0;
var failed = 0;
var currentTest = '';

function describe(name, fn) {
  console.log('\n\x1b[1m' + name + '\x1b[0m');
  fn();
}

function it(name, fn) {
  currentTest = name;
  try {
    fn();
    passed++;
    console.log('  \x1b[32m\u2713\x1b[0m ' + name);
  } catch (e) {
    failed++;
    console.log('  \x1b[31m\u2717\x1b[0m ' + name);
    console.log('    \x1b[31m' + e.message + '\x1b[0m');
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed in: ' + currentTest);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEqual') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

// ─── Load modules ───────────────────────────────────────────────

var TaggerStore = require('../storage/tagger-store');
var SophiaImport = require('./sophia-import');

function freshEnv() {
  TaggerStore._setStorage();
}

// ─── Test data factories ────────────────────────────────────────

function makeSophiaExport(overrides) {
  var base = {
    exportVersion: 2,
    timestamp: '2026-04-16T10:57:30.873Z',
    device: 'MuseS-F0D4',
    deviceType: 'athena',
    session: {
      dataPoints: 1,
      firstReading: '2026-04-16T10:57:07.702Z',
      lastReading: '2026-04-16T10:57:07.702Z'
    },
    currentPosition: {},
    timeline: [
      {
        t: '2026-04-16T10:57:07.702Z',
        pos: 1,
        freq: 174,
        regime: 'GUT',
        geo: 'Seed of Life',
        state: 'SCATTERED FIELD',
        keyword: 'Foundation',
        hex: 24,
        hexName: 'Return',
        coherence: 10,
        focus: 80,
        meditation: 26,
        delta: 25,
        theta: 10,
        alpha: 11,
        beta: 25,
        gamma: 29,
        fnirs: {
          LI: { hbo: -0.029, hbr: 0.028, sqi: 0.988 },
          RI: { hbo: -0.034, hbr: 0.034, sqi: 0.991 },
          LO: { hbo: -0.004, hbr: 0.012, sqi: -0.544 },
          RO: { hbo: -0.003, hbr: 0.016, sqi: 0.167 }
        },
        heartRate: 62
      }
    ],
    latestBrainwave: {},
    athenaData: {},
    frequencyReference: []
  };
  if (overrides) {
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
    }
  }
  return base;
}

function makeMultiSnapshotExport() {
  return makeSophiaExport({
    timeline: [
      {
        t: '2026-04-16T10:57:07.702Z', pos: 1, freq: 174, regime: 'GUT',
        geo: 'Seed of Life', state: 'SCATTERED FIELD', keyword: 'Foundation',
        hex: 24, hexName: 'Return', coherence: 10, focus: 80, meditation: 26,
        delta: 25, theta: 10, alpha: 11, beta: 25, gamma: 29, heartRate: 62
      },
      {
        t: '2026-04-16T11:05:00.000Z', pos: 3, freq: 258, regime: 'HEART',
        geo: 'Torus Knot', state: 'EMERGING COHERENCE', keyword: 'Harmony',
        hex: 19, hexName: 'Approach', coherence: 18, focus: 65, meditation: 55,
        delta: 15, theta: 20, alpha: 30, beta: 20, gamma: 15, heartRate: 58
      },
      {
        t: '2026-04-16T11:12:00.000Z', pos: 5, freq: 396, regime: 'GUT',
        geo: 'Seed of Life', state: 'HARMONIC LOCK', keyword: 'Liberation',
        hex: 11, hexName: 'Peace', coherence: 42, focus: 70, meditation: 60,
        delta: 10, theta: 15, alpha: 35, beta: 25, gamma: 15, heartRate: 55
      }
    ]
  });
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('detectSophiaFormat', function () {

  it('should detect a valid Sophia export', function () {
    assertEqual(SophiaImport.detectSophiaFormat(makeSophiaExport()), true);
  });

  it('should reject Coherence Lab format', function () {
    var obj = { aetheria_export_version: '1.0', export_type: 'session_summary_for_tagger', metadata: {} };
    assertEqual(SophiaImport.detectSophiaFormat(obj), false);
  });

  it('should reject missing markers', function () {
    assertEqual(SophiaImport.detectSophiaFormat({ exportVersion: 2 }), false);
    assertEqual(SophiaImport.detectSophiaFormat({ exportVersion: 2, device: 'X', deviceType: 'Y' }), false);
  });

  it('should reject null/non-object', function () {
    assertEqual(SophiaImport.detectSophiaFormat(null), false);
    assertEqual(SophiaImport.detectSophiaFormat('string'), false);
  });
});

describe('validateSophiaExport', function () {

  it('should pass a valid export', function () {
    var result = SophiaImport.validateSophiaExport(makeSophiaExport());
    assertEqual(result.valid, true);
    assertEqual(result.errors.length, 0);
  });

  it('should fail if exportVersion is missing', function () {
    var obj = makeSophiaExport();
    delete obj.exportVersion;
    var result = SophiaImport.validateSophiaExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors[0].indexOf('export_version') !== -1);
  });

  it('should fail if timeline entry has no timestamp', function () {
    var obj = makeSophiaExport();
    obj.timeline = [{ pos: 1 }];
    var result = SophiaImport.validateSophiaExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors[0].indexOf('timeline[0]') !== -1);
  });

  it('should pass with empty timeline', function () {
    var obj = makeSophiaExport({ timeline: [] });
    var result = SophiaImport.validateSophiaExport(obj);
    assertEqual(result.valid, true);
  });
});

describe('convertSnapshot', function () {

  it('should map timeline entry to canonical shape', function () {
    var entry = makeSophiaExport().timeline[0];
    var snap = SophiaImport.convertSnapshot(entry);

    assertEqual(snap.t, '2026-04-16T10:57:07.702Z');
    assertEqual(snap.position, 1);
    assertEqual(snap.frequency_hz, 174);
    assertEqual(snap.regime, 'GUT');
    assertEqual(snap.symbolic.geometry, 'Seed of Life');
    assertEqual(snap.symbolic.state, 'SCATTERED FIELD');
    assertEqual(snap.symbolic.keyword, 'Foundation');
    assertEqual(snap.symbolic.i_ching_hexagram, 24);
    assertEqual(snap.symbolic.i_ching_name, 'Return');
    assertEqual(snap.metrics.coherence, 10);
    assertEqual(snap.metrics.focus, 80);
    assertEqual(snap.metrics.meditation, 26);
    assertEqual(snap.heart_rate, 62);
  });

  it('should normalize band powers from percentages to decimals', function () {
    var entry = makeSophiaExport().timeline[0];
    var snap = SophiaImport.convertSnapshot(entry);

    // delta=25 (>1) → 0.25
    assertEqual(snap.band_powers.delta, 0.25);
    assertEqual(snap.band_powers.theta, 0.10);
    assertEqual(snap.band_powers.alpha, 0.11);
    assertEqual(snap.band_powers.beta, 0.25);
    assertEqual(snap.band_powers.gamma, 0.29);
  });

  it('should preserve already-decimal band powers', function () {
    var entry = { t: '2026-01-01T00:00:00Z', delta: 0.25, theta: 0.10, alpha: 0.11, beta: 0.25, gamma: 0.29 };
    var snap = SophiaImport.convertSnapshot(entry);
    assertEqual(snap.band_powers.delta, 0.25);
    assertEqual(snap.band_powers.gamma, 0.29);
  });

  it('should derive dominant_wave from band powers', function () {
    // gamma=29 is the highest percentage
    var entry = makeSophiaExport().timeline[0];
    var snap = SophiaImport.convertSnapshot(entry);
    assertEqual(snap.metrics.dominant_wave, 'gamma');
  });

  it('should preserve fnirs data as-is', function () {
    var entry = makeSophiaExport().timeline[0];
    var snap = SophiaImport.convertSnapshot(entry);
    assertEqual(snap.fnirs.LI.sqi, 0.988);
    assertEqual(snap.fnirs.RO.hbo, -0.003);
  });
});

describe('computeSophiaSummary', function () {

  it('should compute summary from multiple snapshots', function () {
    var exp = makeMultiSnapshotExport();
    var snaps = exp.timeline.map(function (e) { return SophiaImport.convertSnapshot(e); });
    var sum = SophiaImport.computeSophiaSummary(snaps);

    // Dominant regime: GUT appears 2x, HEART 1x → GUT
    assertEqual(sum.dominant_regime, 'GUT');
    // Dominant geometry: Seed of Life 2x, Torus Knot 1x
    assertEqual(sum.dominant_geometry, 'Seed of Life');
    // Hexagrams: [11, 19, 24] sorted
    assertEqual(JSON.stringify(sum.hexagrams_encountered), JSON.stringify([11, 19, 24]));
    // Peak coherence: max(10, 18, 42) = 42
    assertEqual(sum.peak_coherence, 42);
    // Mean coherence: (10+18+42)/3 ≈ 23.3
    assertEqual(sum.mean_coherence, 23.3);
    // Mean focus: (80+65+70)/3 = 71.7
    assertEqual(sum.mean_focus, 71.7);
    // Mean meditation: (26+55+60)/3 = 47
    assertEqual(sum.mean_meditation, 47);
  });

  it('should handle single snapshot', function () {
    var entry = makeSophiaExport().timeline[0];
    var snap = SophiaImport.convertSnapshot(entry);
    var sum = SophiaImport.computeSophiaSummary([snap]);

    assertEqual(sum.dominant_regime, 'GUT');
    assertEqual(sum.peak_coherence, 10);
    assertEqual(sum.mean_coherence, 10);
    assertEqual(sum.hexagrams_encountered.length, 1);
    assertEqual(sum.hexagrams_encountered[0], 24);
  });
});

describe('mergeSnapshots', function () {

  it('should concatenate and sort by timestamp', function () {
    var a = [{ t: '2026-04-16T10:00:00Z', regime: 'GUT' }];
    var b = [{ t: '2026-04-16T09:00:00Z', regime: 'HEART' }];
    var merged = SophiaImport.mergeSnapshots(a, b);
    assertEqual(merged.length, 2);
    assertEqual(merged[0].t, '2026-04-16T09:00:00Z');
    assertEqual(merged[1].t, '2026-04-16T10:00:00Z');
  });

  it('should dedup by timestamp', function () {
    var a = [
      { t: '2026-04-16T10:00:00Z', regime: 'GUT' },
      { t: '2026-04-16T11:00:00Z', regime: 'HEART' }
    ];
    var b = [
      { t: '2026-04-16T10:00:00Z', regime: 'GUT' }, // duplicate
      { t: '2026-04-16T12:00:00Z', regime: 'HEAD' }
    ];
    var merged = SophiaImport.mergeSnapshots(a, b);
    assertEqual(merged.length, 3);
  });

  it('should handle empty arrays', function () {
    assertEqual(SophiaImport.mergeSnapshots([], []).length, 0);
    assertEqual(SophiaImport.mergeSnapshots([{ t: 'A' }], []).length, 1);
  });
});

describe('buildNewSophiaRecord', function () {

  it('should produce a v2.0 record', function () {
    freshEnv();
    var exp = makeSophiaExport();
    var rec = SophiaImport.buildNewSophiaRecord(exp);

    assertEqual(rec.schema_version, '2.0');
    assertEqual(rec.source, 'sophia');
    assert(rec.session_id.indexOf('sophia_MuseS-F0D4_') === 0, 'session_id prefix');
    assertEqual(rec.session_date, '2026-04-16');
    assertEqual(rec.source_data.device, 'MuseS-F0D4');
    assertEqual(rec.source_data.device_type, 'athena');
    assertEqual(rec.source_data.snapshot_count, 1);
    assert(Array.isArray(rec.source_data.snapshots));
    assertEqual(rec.source_data.snapshots.length, 1);
    assertEqual(rec.source_data.summary.dominant_regime, 'GUT');
    // raw_import is an array containing the original export
    assert(Array.isArray(rec.raw_import));
    assertEqual(rec.raw_import.length, 1);
    assertEqual(rec.raw_import[0].exportVersion, 2);
    // context should be empty starter
    assertEqual(rec.context.condition, '');
    assertEqual(rec.context.mood_before, null);
  });

  it('should pass TaggerStore.validateRecord', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    var v = TaggerStore.validateRecord(rec);
    assertEqual(v.valid, true, 'should be valid: ' + v.errors.join(', '));
  });
});

describe('appendToSophiaRecord', function () {

  it('should merge snapshots and recompute summary', function () {
    freshEnv();
    var exp1 = makeSophiaExport();
    var rec = SophiaImport.buildNewSophiaRecord(exp1);

    var exp2 = makeSophiaExport({
      timeline: [
        {
          t: '2026-04-16T11:30:00.000Z', pos: 3, freq: 258, regime: 'HEART',
          geo: 'Torus Knot', state: 'EMERGING COHERENCE', keyword: 'Harmony',
          hex: 19, hexName: 'Approach', coherence: 35, focus: 70, meditation: 50,
          delta: 15, theta: 20, alpha: 30, beta: 20, gamma: 15, heartRate: 58
        }
      ]
    });

    var updated = SophiaImport.appendToSophiaRecord(rec, exp2);

    assertEqual(updated.source, 'sophia');
    assertEqual(updated.session_id, rec.session_id, 'should preserve session_id');
    assertEqual(updated.imported_at, rec.imported_at, 'should preserve imported_at');
    assertEqual(updated.source_data.snapshot_count, 2);
    assertEqual(updated.source_data.snapshots.length, 2);
    // Should be sorted by t
    assert(updated.source_data.snapshots[0].t < updated.source_data.snapshots[1].t);
    // Summary recomputed
    assertEqual(updated.source_data.summary.peak_coherence, 35);
    // Hexagrams now include both
    assert(updated.source_data.summary.hexagrams_encountered.indexOf(19) !== -1);
    assert(updated.source_data.summary.hexagrams_encountered.indexOf(24) !== -1);
    // raw_import should have both exports
    assertEqual(updated.raw_import.length, 2);
  });

  it('should dedup snapshots with same timestamp on append', function () {
    freshEnv();
    var exp = makeSophiaExport();
    var rec = SophiaImport.buildNewSophiaRecord(exp);

    // Append same export again — same timestamps
    var updated = SophiaImport.appendToSophiaRecord(rec, exp);
    assertEqual(updated.source_data.snapshot_count, 1, 'should dedup');
    assertEqual(updated.raw_import.length, 2, 'raw_import still appended');
  });

  it('should preserve existing context', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    rec.context.notes = 'user wrote this';
    rec.context.mood_before = 5;

    var exp2 = makeSophiaExport({
      timeline: [{ t: '2026-04-16T12:00:00Z', pos: 2, regime: 'HEART', geo: 'X', coherence: 20 }]
    });
    var updated = SophiaImport.appendToSophiaRecord(rec, exp2);

    assertEqual(updated.context.notes, 'user wrote this');
    assertEqual(updated.context.mood_before, 5);
  });

  it('should pass TaggerStore.validateRecord after append', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    var exp2 = makeSophiaExport({
      timeline: [{ t: '2026-04-16T12:00:00Z', pos: 2, regime: 'HEART', geo: 'X', coherence: 20 }]
    });
    var updated = SophiaImport.appendToSophiaRecord(rec, exp2);
    var v = TaggerStore.validateRecord(updated);
    assertEqual(v.valid, true, 'should be valid: ' + v.errors.join(', '));
  });
});

describe('findRecentSophiaSessions', function () {

  it('should return sophia sessions within window', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    // Set last_snapshot_at to now so it's within the window
    rec.source_data.last_snapshot_at = new Date().toISOString();
    TaggerStore.saveSession(rec);

    var recent = SophiaImport.findRecentSophiaSessions(48);
    assertEqual(recent.length, 1);
    assertEqual(recent[0].source, 'sophia');
  });

  it('should exclude sessions outside the window', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    // Set last_snapshot_at to 3 days ago
    rec.source_data.last_snapshot_at = new Date(Date.now() - 72 * 3600000).toISOString();
    TaggerStore.saveSession(rec);

    var recent = SophiaImport.findRecentSophiaSessions(48);
    assertEqual(recent.length, 0);
  });

  it('should not return non-sophia sessions', function () {
    freshEnv();
    // Save a coherence_lab session
    TaggerStore.saveSession({
      session_id: 'lab-1', source: 'coherence_lab', schema_version: '2.0',
      imported_at: new Date().toISOString(), last_edited_at: new Date().toISOString(),
      session_date: '2026-04-16',
      context: { condition: '', moon: 'unknown', sleep: null, mood_before: null, mood_after: null, mood_change: null, pain: null, activity: '', notes: '' },
      source_data: { summary: {} }, raw_import: null
    });
    var recent = SophiaImport.findRecentSophiaSessions(48);
    assertEqual(recent.length, 0);
  });
});

describe('importSophiaFile (full orchestration)', function () {

  it('should return error for invalid JSON', function () {
    freshEnv();
    var result = SophiaImport.importSophiaFile('not json');
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('JSON') !== -1);
  });

  it('should return error for non-Sophia format', function () {
    freshEnv();
    var result = SophiaImport.importSophiaFile(JSON.stringify({ foo: 'bar' }));
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('Sophia') !== -1);
  });

  it('should return ok with parsedExport and recentSessions', function () {
    freshEnv();
    var result = SophiaImport.importSophiaFile(JSON.stringify(makeSophiaExport()));
    assertEqual(result.status, 'ok');
    assertEqual(result.parsedExport.exportVersion, 2);
    assert(Array.isArray(result.recentSessions));
  });

  it('should include recent sophia sessions in result', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    rec.source_data.last_snapshot_at = new Date().toISOString();
    TaggerStore.saveSession(rec);

    var result = SophiaImport.importSophiaFile(JSON.stringify(makeSophiaExport()));
    assertEqual(result.status, 'ok');
    assertEqual(result.recentSessions.length, 1);
  });

  it('should limit recentSessions to 5', function () {
    freshEnv();
    for (var i = 0; i < 7; i++) {
      var exp = makeSophiaExport({
        device: 'dev-' + i,
        timeline: [{ t: new Date(Date.now() - i * 60000).toISOString(), pos: i, regime: 'GUT', geo: 'X' }]
      });
      var rec = SophiaImport.buildNewSophiaRecord(exp);
      rec.source_data.last_snapshot_at = new Date().toISOString();
      TaggerStore.saveSession(rec);
    }

    var result = SophiaImport.importSophiaFile(JSON.stringify(makeSophiaExport()));
    assert(result.recentSessions.length <= 5, 'should cap at 5');
  });
});

describe('UI helpers', function () {

  it('formatDeviceName should map known types', function () {
    assertEqual(SophiaImport.formatDeviceName('athena'), 'Muse S Athena');
    assertEqual(SophiaImport.formatDeviceName('muse2'), 'Muse 2');
    assertEqual(SophiaImport.formatDeviceName('muses'), 'Muse S');
    assertEqual(SophiaImport.formatDeviceName('custom'), 'custom');
  });

  it('sessionSummaryLabel should produce readable label', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    var label = SophiaImport.sessionSummaryLabel(rec);
    assert(label.indexOf('1 snapshot') !== -1);
    assert(label.indexOf('GUT') !== -1);
    assert(label.indexOf('Seed of Life') !== -1);
  });
});

// ─── Report ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
if (failed === 0) {
  console.log('\x1b[32m  ALL ' + passed + ' TESTS PASSED\x1b[0m');
} else {
  console.log('\x1b[31m  ' + failed + ' FAILED\x1b[0m, ' + passed + ' passed');
}
console.log('='.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
