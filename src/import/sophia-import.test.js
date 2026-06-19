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

function makeSpiralEntry(t, overrides) {
  var entry = {
    t: t, pos: 1, freq: 174, regime: 'GUT', geo: 'Seed of Life',
    state: 'SCATTERED FIELD', keyword: 'Foundation', hex: 8, hexName: 'Holding Together',
    coherence: 6, focus: 68, meditation: 33,
    delta: 60, theta: 13, alpha: 4, beta: 10, gamma: 14,
    spiral: {
      plv_matrix: {
        AF7_AF8:  { theta: 0.42, alpha: 0.36, beta: 0.32, gamma: 0.21 },
        TP9_TP10: { theta: 0.93, alpha: 0.04, beta: 0.24, gamma: 0.18 },
        AF7_TP9:  { theta: 0.35, alpha: 0.20, beta: 0.15, gamma: 0.20 },
        AF8_TP10: { theta: 0.33, alpha: 0.35, beta: 0.18, gamma: 0.06 },
        AF7_TP10: { theta: 0.32, alpha: 0.21, beta: 0.37, gamma: 0.36 },
        AF8_TP9:  { theta: 0.22, alpha: 0.41, beta: 0.30, gamma: 0.15 }
      },
      phase_lag_left:      { lagMs: 3.65, direction: 'front-to-back', strength: 0.20, band: 'alpha' },
      phase_lag_right:     { lagMs: 2.83, direction: 'front-to-back', strength: 0.35, band: 'alpha' },
      phase_lag_bilateral: { lagMs: 3.24, direction: 'front-to-back', symmetry: 1 },
      hcr: {
        theta: { interHemi: 0.67, ipsi: 0.34, hcr: 1.98, interp: 'hemispheric-dominant' },
        alpha: { interHemi: 0.20, ipsi: 0.27, hcr: 0.75, interp: 'ipsilateral-dominant' },
        beta:  { interHemi: 0.28, ipsi: 0.16, hcr: 1.71, interp: 'hemispheric-dominant' },
        gamma: { interHemi: 0.19, ipsi: 0.13, hcr: 1.51, interp: 'hemispheric-dominant' }
      },
      dominant_band: 'theta'
    },
    artifact: { movementScore: 0.001, deltaHigh: false, deltaArtifactLikely: false, source: 'eeg-mad' },
    heartRate: 88
  };
  if (overrides) {
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) entry[k] = overrides[k];
    }
  }
  return entry;
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

describe('spiral metrics (v2 exports)', function () {

  it('convertSnapshot should pass through spiral and artifact blocks', function () {
    var snap = SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z'));
    assert(snap.spiral, 'spiral present');
    assertEqual(snap.spiral.dominant_band, 'theta');
    assertEqual(snap.spiral.plv_matrix.TP9_TP10.theta, 0.93);
    assertEqual(snap.spiral.hcr.gamma.hcr, 1.51);
    assertEqual(snap.spiral.phase_lag_bilateral.direction, 'front-to-back');
    assert(snap.artifact, 'artifact present');
    assertEqual(snap.artifact.movementScore, 0.001);
  });

  it('convertSnapshot should null spiral/artifact for pre-v2 entries', function () {
    var snap = SophiaImport.convertSnapshot(makeSophiaExport().timeline[0]);
    assertEqual(snap.spiral, null);
    assertEqual(snap.artifact, null);
  });

  it('computeSophiaSummary should aggregate spiral metrics', function () {
    var snaps = [
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z')),
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:41.987Z', {
        spiral: {
          plv_matrix: {},
          phase_lag_bilateral: { lagMs: -5.3, direction: 'back-to-front', symmetry: 0.94 },
          hcr: {
            theta: { hcr: 1.02 }, alpha: { hcr: 1.25 },
            beta: { hcr: 0.95 }, gamma: { hcr: 0.78 }
          },
          dominant_band: 'theta'
        }
      })),
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:01:11.987Z', {
        spiral: {
          plv_matrix: {},
          phase_lag_bilateral: { lagMs: 0.75, direction: 'front-to-back', symmetry: 0.5 },
          hcr: {
            theta: { hcr: 1.00 }, alpha: { hcr: 1.00 },
            beta: { hcr: 1.00 }, gamma: { hcr: 1.00 }
          },
          dominant_band: 'theta'
        }
      }))
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    assert(sum.spiral, 'spiral summary present');
    assertEqual(sum.spiral.samples, 3);
    // theta HCR mean: (1.98 + 1.02 + 1.00) / 3 = 1.3333 → 1.33
    assertEqual(sum.spiral.mean_hcr.theta, 1.33);
    // front-to-back appears 2x, back-to-front 1x → dominant front-to-back
    assertEqual(sum.spiral.dominant_dir, 'front-to-back');
    assertEqual(sum.spiral.phase_lag_dir_counts['front-to-back'], 2);
    assertEqual(sum.spiral.phase_lag_dir_counts['back-to-front'], 1);
    // symmetry mean: (1 + 0.94 + 0.5) / 3 = 0.8133 → 0.81
    assertEqual(sum.spiral.mean_symmetry, 0.81);
  });

  it('computeSophiaSummary should return null spiral when no snapshot has spiral', function () {
    var snaps = [SophiaImport.convertSnapshot(makeSophiaExport().timeline[0])];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    assertEqual(sum.spiral, null);
  });

  it('buildNewSophiaRecord should carry spiral through to stored snapshots and summary', function () {
    freshEnv();
    var exp = makeSophiaExport({ timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')] });
    var rec = SophiaImport.buildNewSophiaRecord(exp);
    assert(rec.source_data.snapshots[0].spiral, 'snapshot retains spiral');
    assert(rec.source_data.summary.spiral, 'summary has spiral block');
    assertEqual(rec.source_data.summary.spiral.dominant_dir, 'front-to-back');
    var v = TaggerStore.validateRecord(rec);
    assertEqual(v.valid, true, 'should be valid: ' + v.errors.join(', '));
  });
});

describe('spiral summary visuals data', function () {

  it('should compute a session-mean PLV matrix', function () {
    var snaps = [
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z')),
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:41.987Z', {
        spiral: {
          plv_matrix: { AF7_AF8: { theta: 0.22, alpha: 0.46, beta: 0.12, gamma: 0.01 } },
          phase_lag_bilateral: { direction: 'front-to-back', symmetry: 0.8 },
          hcr: {}, dominant_band: 'theta'
        }
      }))
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    // AF7_AF8 theta: (0.42 + 0.22) / 2 = 0.32
    assertEqual(sum.spiral.mean_plv_matrix.AF7_AF8.theta, 0.32);
    // TP9_TP10 theta only present in first snapshot (0.93) → mean 0.93
    assertEqual(sum.spiral.mean_plv_matrix.TP9_TP10.theta, 0.93);
  });

  it('should summarize left/right pathway direction and strength', function () {
    var snaps = [
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z')),
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:41.987Z'))
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    assertEqual(sum.spiral.left_pathway.direction, 'front-to-back');
    assertEqual(sum.spiral.left_pathway.strength, 0.2);   // mean of two 0.20s
    assertEqual(sum.spiral.right_pathway.direction, 'front-to-back');
    assertEqual(sum.spiral.right_pathway.strength, 0.35);
  });
});

describe('actionable insights', function () {

  it('should generate insights array on the summary', function () {
    var rec = SophiaImport.buildNewSophiaRecord(
      makeSophiaExport({ timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')] })
    );
    var ins = rec.source_data.summary.insights;
    assert(Array.isArray(ins) && ins.length > 0, 'insights present');
    ins.forEach(function (x) {
      assert(typeof x.text === 'string' && x.text.length > 0, 'has text');
      assert(['good', 'watch', 'tip'].indexOf(x.kind) !== -1, 'valid kind: ' + x.kind);
    });
  });

  it('should flag low coherence as a watch insight', function () {
    // makeSpiralEntry has coherence 6 → low
    var snap = SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z'));
    var sum = SophiaImport.computeSophiaSummary([snap]);
    var hasLow = sum.insights.some(function (x) {
      return x.kind === 'watch' && /coherence/i.test(x.text);
    });
    assert(hasLow, 'should warn about low coherence');
  });

  it('should detect a rising coherence trend', function () {
    var snaps = [
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z', { coherence: 8 })),
      SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:41.987Z', { coherence: 40 }))
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    var hasRise = sum.insights.some(function (x) { return /rose from 8% to 40%/.test(x.text); });
    assert(hasRise, 'should detect rising trend');
  });

  it('should call out clean data when artifact is low', function () {
    var snap = SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z'));
    var sum = SophiaImport.computeSophiaSummary([snap]);
    var clean = sum.insights.some(function (x) { return x.kind === 'good' && /clean data/i.test(x.text); });
    assert(clean, 'should note clean data');
  });

  it('should produce no insights array crash on pre-v2 data', function () {
    var sum = SophiaImport.computeSophiaSummary([
      SophiaImport.convertSnapshot(makeSophiaExport().timeline[0])
    ]);
    assert(Array.isArray(sum.insights), 'insights still an array without spiral');
  });
});

describe('traveling wave (v2.1 exports)', function () {

  function twSnap(t, tw) {
    return SophiaImport.convertSnapshot({
      t: t, regime: 'GUT', coherence: 9, delta: 40, theta: 20, alpha: 10, beta: 18, gamma: 12,
      spiral: { plv_matrix: {}, phase_lag_bilateral: { direction: 'front-to-back', symmetry: 0.8 }, hcr: {}, traveling_wave: tw }
    });
  }

  it('convertSnapshot should preserve the traveling_wave block', function () {
    var s = twSnap('2026-06-19T13:40:16.830Z', { band: 'alpha', angleDeg: 33, direction: 'front-right', speedMps: 7.62, planarity: 0.65, strength: 0.16, rotationDegPerSec: null });
    assert(s.spiral.traveling_wave, 'tw present');
    assertEqual(s.spiral.traveling_wave.angleDeg, 33);
    assertEqual(s.spiral.traveling_wave.direction, 'front-right');
  });

  it('should aggregate traveling-wave vectors into the summary', function () {
    var snaps = [
      twSnap('2026-06-19T13:40:16.830Z', { angleDeg: 0,  direction: 'rightward', speedMps: 2, planarity: 0.9, strength: 0.3, rotationDegPerSec: 99 }),
      twSnap('2026-06-19T13:40:46.830Z', { angleDeg: 90, direction: 'leftward',  speedMps: 4, planarity: 0.5, strength: 0.5, rotationDegPerSec: -35 }),
      twSnap('2026-06-19T13:41:16.830Z', { angleDeg: 90, direction: 'leftward',  speedMps: 6, planarity: 0.7, strength: 0.4, rotationDegPerSec: null })
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    var tw = sum.spiral.traveling_wave;
    assert(tw, 'traveling_wave summary present');
    assertEqual(tw.samples, 3);
    assertEqual(tw.dominant_direction, 'leftward'); // 2x leftward
    assertEqual(tw.mean_speed_mps, 4);              // (2+4+6)/3
    assertEqual(tw.mean_planarity, 0.7);            // (0.9+0.5+0.7)/3
    // circular mean of 0°, 90°, 90° = atan2(2,1) ≈ 63°
    assertEqual(tw.mean_angle_deg, 63);
    // rotation: 99>0 ccw, -35<0 cw, null none
    assertEqual(tw.rotation.ccw, 1);
    assertEqual(tw.rotation.cw, 1);
    assertEqual(tw.rotation.none, 1);
    assertEqual(tw.rotation.mean_abs_deg_per_sec, 67); // (99+35)/2
  });

  it('should be null when no snapshot has a traveling_wave', function () {
    var snap = SophiaImport.convertSnapshot(makeSpiralEntry('2026-06-19T10:00:11.987Z'));
    var sum = SophiaImport.computeSophiaSummary([snap]);
    assertEqual(sum.spiral.traveling_wave, null);
  });

  it('should generate a rotating-wave insight when most epochs rotate', function () {
    var snaps = [
      twSnap('2026-06-19T13:40:16.830Z', { angleDeg: 0,  direction: 'leftward', speedMps: 2, planarity: 0.9, strength: 0.3, rotationDegPerSec: 99 }),
      twSnap('2026-06-19T13:40:46.830Z', { angleDeg: 10, direction: 'leftward', speedMps: 3, planarity: 0.8, strength: 0.4, rotationDegPerSec: 80 })
    ];
    var sum = SophiaImport.computeSophiaSummary(snaps);
    var rotating = sum.insights.some(function (x) { return /rotating waves/i.test(x.text); });
    assert(rotating, 'should report rotating waves');
  });
});

describe('session-level diagnostics (v2.1 exports)', function () {

  it('buildNewSophiaRecord should capture neurodynamics and channel_diagnostic', function () {
    freshEnv();
    var exp = makeSophiaExport({
      neurodynamics: { mean: { higuchiFD: 1.6, sampleEntropy: 1.1 }, portraitChannel: 'TP10' },
      channelDiagnostic: { verdict: 'AUX channels not usable', lineNoise: { meanScalpRatio: 0.9 } },
      timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')]
    });
    var rec = SophiaImport.buildNewSophiaRecord(exp);
    assert(rec.source_data.neurodynamics, 'neurodynamics captured');
    assertEqual(rec.source_data.neurodynamics.portraitChannel, 'TP10');
    assert(rec.source_data.channel_diagnostic, 'channel_diagnostic captured');
    var v = TaggerStore.validateRecord(rec);
    assertEqual(v.valid, true, 'should be valid: ' + v.errors.join(', '));
  });

  it('should be null for exports without those fields', function () {
    freshEnv();
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    assertEqual(rec.source_data.neurodynamics, null);
    assertEqual(rec.source_data.channel_diagnostic, null);
  });
});

describe('neurodynamics insights (v2.1 exports)', function () {

  function ndExport(nd, cd) {
    return makeSophiaExport({
      neurodynamics: nd,
      channelDiagnostic: cd,
      timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')]
    });
  }

  it('should flag a healthy complexity range', function () {
    var rec = SophiaImport.buildNewSophiaRecord(ndExport({
      portraitChannel: 'TP10', tau: 7, embeddingDim: 3,
      mean: { higuchiFD: 1.60, sampleEntropy: 1.13, lempelZiv: 0.72, recurrenceRate: 0.006 },
      perChannel: {
        TP9:  { higuchiFD: 1.61 }, AF7: { higuchiFD: 1.66 },
        AF8:  { higuchiFD: 1.64 }, TP10:{ higuchiFD: 1.48 }
      }
    }));
    var hit = rec.source_data.summary.insights.some(function (x) {
      return x.kind === 'good' && /complexity/i.test(x.text) && /Higuchi FD 1\.60/.test(x.text);
    });
    assert(hit, 'should report healthy complexity');
  });

  it('should flag low complexity as a tip', function () {
    var rec = SophiaImport.buildNewSophiaRecord(ndExport({
      mean: { higuchiFD: 1.25 }
    }));
    var hit = rec.source_data.summary.insights.some(function (x) {
      return x.kind === 'tip' && /complexity was low/i.test(x.text);
    });
    assert(hit, 'should report low complexity');
  });

  it('should flag a wide cross-channel complexity gap', function () {
    var rec = SophiaImport.buildNewSophiaRecord(ndExport({
      mean: { higuchiFD: 1.6 },
      perChannel: {
        TP9: { higuchiFD: 1.9 }, AF7: { higuchiFD: 1.5 },
        AF8: { higuchiFD: 1.55 }, TP10: { higuchiFD: 1.45 }
      }
    }));
    var hit = rec.source_data.summary.insights.some(function (x) {
      return x.kind === 'watch' && /varied across channels/i.test(x.text);
    });
    assert(hit, 'should report cross-channel gap (1.9 vs 1.45)');
  });

  it('should warn about non-EEG-like channels', function () {
    var rec = SophiaImport.buildNewSophiaRecord(ndExport(
      { mean: { higuchiFD: 1.6 } },
      { stats: { AF7: { spectrum: { eegLike: false } }, TP9: { spectrum: { eegLike: true } } } }
    ));
    var hit = rec.source_data.summary.insights.some(function (x) {
      return x.kind === 'watch' && /AF7 looked more like noise/i.test(x.text);
    });
    assert(hit, 'should warn about AF7');
  });

  it('should add no neurodynamics insights when data is absent', function () {
    var rec = SophiaImport.buildNewSophiaRecord(makeSophiaExport());
    var hit = rec.source_data.summary.insights.some(function (x) {
      return /complexity|Higuchi|noise than clean EEG/i.test(x.text);
    });
    assert(!hit, 'no neuro insights without data');
  });
});

describe('spiral export', function () {

  it('exportSophiaSnapshotsCSV should include PLV matrix and HCR columns', function () {
    var TaggerExport = require('../export/tagger-export');
    var rec = SophiaImport.buildNewSophiaRecord(
      makeSophiaExport({ timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')] })
    );
    var csv = TaggerExport.exportSophiaSnapshotsCSV([rec]);
    var lines = csv.split('\n');
    assert(lines[0].indexOf('plv_TP9_TP10_theta') !== -1, 'header has plv column');
    assert(lines[0].indexOf('hcr_gamma') !== -1, 'header has hcr column');
    assert(lines[0].indexOf('pl_bilateral_direction') !== -1, 'header has phase lag column');
    // Data row should contain the TP9_TP10 theta value 0.93 and bilateral direction
    assert(lines[1].indexOf('0.93') !== -1, 'data row has plv value');
    assert(lines[1].indexOf('front-to-back') !== -1, 'data row has direction');
  });

  it('exportSophiaCSV should include aggregate spiral columns', function () {
    var TaggerExport = require('../export/tagger-export');
    var rec = SophiaImport.buildNewSophiaRecord(
      makeSophiaExport({ timeline: [makeSpiralEntry('2026-06-19T10:00:11.987Z')] })
    );
    var csv = TaggerExport.exportSophiaCSV([rec]);
    var lines = csv.split('\n');
    assert(lines[0].indexOf('spiral_mean_hcr_theta') !== -1, 'header has spiral summary col');
    assert(lines[0].indexOf('spiral_dominant_dir') !== -1, 'header has dominant dir col');
    assert(lines[1].indexOf('front-to-back') !== -1, 'data row has dominant dir');
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
