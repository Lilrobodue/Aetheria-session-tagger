// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Coherence Lab Import Tests
// Run:  node src/import/coherence-lab-import.test.js
// ═══════════════════════════════════════════════════════════════

// ─── localStorage polyfill for Node ─────────────────────────────

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
var CoherenceLabImport = require('./coherence-lab-import');

function freshEnv() {
  TaggerStore._setStorage();
}

// ─── Test data factories ────────────────────────────────────────

function makeStructuredExport(overrides) {
  var base = {
    aetheria_export_version: '1.0',
    export_type: 'session_summary_for_tagger',
    exported_at: '2026-04-16T14:00:00.000Z',
    metadata: {
      sessionId: 'lab-structured-001',
      startTime: '2026-04-16T13:50:00.000Z',
      endTime:   '2026-04-16T13:54:06.000Z',
      softwareVersion: '1.0.0'
    },
    session: {
      sessionId: 'lab-structured-001',
      startTime: '2026-04-16T13:50:00.000Z',
      endTime:   '2026-04-16T13:54:06.000Z',
      duration_seconds: 246
    },
    summary: {
      peak_tcs: 82.7,
      mean_tcs: 41.3,
      peak_bcs: 68.6,
      mean_bcs: 34.2,
      phase_transition_detected: true,
      phase_transition_time_seconds: 118,
      harm_one_count: 13,
      harm_mean: 0.672,
      cascade_flips: 0,
      prescriptions_count: 5,
      closing_type: 'graceful'
    },
    time_series: {
      coherence_t: [0, 1, 2],
      coherence_tcs: [30, 60, 82.7],
      coherence_gut: [0.4, 0.6, 0.8],
      coherence_heart: [0.5, 0.7, 0.9],
      coherence_head: [0.3, 0.5, 0.7],
      coherence_plv: [0.2, 0.4, 0.6],
      coherence_harm: [0.5, 1.0, 0.8],
      bcs_t: [0, 1, 2],
      bcs_value: [20, 50, 68.6],
      bcs_kuramoto: [0.3, 0.6, 0.8],
      bcs_shared_energy: [0.1, 0.3, 0.5],
      bcs_mutual_info: [0.2, 0.4, 0.6],
      bcs_phase_transition: [false, false, true]
    },
    state_transitions: [
      { t: 0, from: 'IDLE', to: 'ACTIVE', reason: 'session_start' },
      { t: 240, from: 'ACTIVE', to: 'CLOSING', reason: 'session_end' }
    ],
    prescriptions: [
      { t: 10, action: 'play', frequency: 432 },
      { t: 30, action: 'play', frequency: 528 },
      { t: 60, action: 'stop' },
      { t: 80, action: 'play', frequency: 396 },
      { t: 120, action: 'play', frequency: 432 },
      { t: 180, action: 'play', frequency: 528 }
    ]
  };
  if (overrides) {
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
    }
  }
  return base;
}

function makeNativeSave(overrides) {
  var base = {
    metadata: {
      sessionId: 'lab-native-001',
      startTime: '2026-04-16T13:50:00.000Z',
      endTime:   '2026-04-16T13:54:06.000Z',
      softwareVersion: '1.0.0'
    },
    streams: {
      coherence: [
        { t: 0,  tcs: 30.0, gut: 0.4, heart: 0.5, head: 0.3, plv: 0.2, harm: 0.5 },
        { t: 1,  tcs: 60.0, gut: 0.6, heart: 0.7, head: 0.5, plv: 0.4, harm: 1.0 },
        { t: 2,  tcs: 82.7, gut: 0.8, heart: 0.9, head: 0.7, plv: 0.6, harm: 1.0 },
        { t: 3,  tcs: 55.0, gut: 0.5, heart: 0.6, head: 0.4, plv: 0.3, harm: 0.7 },
        { t: 4,  tcs: 70.0, gut: 0.7, heart: 0.8, head: 0.6, plv: 0.5, harm: 1.0 }
      ],
      bcs: [
        { t: 0, bcs: 20.0, kuramoto: 0.3, sharedEnergy: 0.1, mutualInfo: 0.2, phaseTransition: false },
        { t: 1, bcs: 50.0, kuramoto: 0.6, sharedEnergy: 0.3, mutualInfo: 0.4, phaseTransition: false },
        { t: 2, bcs: 68.6, kuramoto: 0.8, sharedEnergy: 0.5, mutualInfo: 0.6, phaseTransition: true }
      ],
      state: [
        { t: 0, from: 'IDLE', to: 'ACTIVE', reason: 'session_start' },
        { t: 100, from: 'ACTIVE', to: 'MODULATING', reason: 'cascade flipped to modulate' },
        { t: 240, from: 'MODULATING', to: 'CLOSING', reason: 'session_end' }
      ],
      prescription: [
        { t: 10, action: 'play', frequency: 432 },
        { t: 30, action: 'play', frequency: 528 },
        { t: 60, action: 'stop' }
      ],
      // Raw biosignals that should be dropped during conversion
      rr: [{ t: 0, rr: 800 }],
      eeg: [{ t: 0, alpha: 10 }],
      ppg: [{ t: 0, hr: 72 }],
      fnirs: [{ t: 0, sqi: 0.8 }],
      imu: [{ t: 0, x: 0 }],
      features: [{ t: 0, focus: 0.5 }],
      audio: [{ t: 0, vol: 0.7 }],
      haptic: [{ t: 0, intensity: 0.3 }]
    }
  };
  if (overrides) {
    for (var k in overrides) {
      if (overrides.hasOwnProperty(k)) base[k] = overrides[k];
    }
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('detectCoherenceLabFormat', function () {

  it('should detect structured export (Format A)', function () {
    var obj = makeStructuredExport();
    assertEqual(CoherenceLabImport.detectCoherenceLabFormat(obj), 'structured_export');
  });

  it('should detect native save (Format B)', function () {
    var obj = makeNativeSave();
    assertEqual(CoherenceLabImport.detectCoherenceLabFormat(obj), 'native_save');
  });

  it('should return null for unknown format', function () {
    assertEqual(CoherenceLabImport.detectCoherenceLabFormat({ foo: 'bar' }), null);
  });

  it('should return null for null/non-object', function () {
    assertEqual(CoherenceLabImport.detectCoherenceLabFormat(null), null);
    assertEqual(CoherenceLabImport.detectCoherenceLabFormat('string'), null);
  });
});

describe('validateStructuredExport', function () {

  it('should pass a valid structured export', function () {
    var result = CoherenceLabImport.validateStructuredExport(makeStructuredExport());
    assertEqual(result.valid, true);
    assertEqual(result.errors.length, 0);
  });

  it('should fail if metadata.sessionId is missing', function () {
    var obj = makeStructuredExport();
    delete obj.metadata.sessionId;
    var result = CoherenceLabImport.validateStructuredExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('structured_missing_session_id') !== -1);
  });

  it('should fail if time_series is missing', function () {
    var obj = makeStructuredExport();
    delete obj.time_series;
    var result = CoherenceLabImport.validateStructuredExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('structured_missing_time_series') !== -1);
  });

  it('should fail if summary is missing', function () {
    var obj = makeStructuredExport();
    delete obj.summary;
    var result = CoherenceLabImport.validateStructuredExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('structured_missing_summary') !== -1);
  });

  it('should fail if state_transitions is not an array', function () {
    var obj = makeStructuredExport();
    obj.state_transitions = 'not_array';
    var result = CoherenceLabImport.validateStructuredExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('structured_missing_state_transitions') !== -1);
  });

  it('should fail if prescriptions is not an array', function () {
    var obj = makeStructuredExport();
    delete obj.prescriptions;
    var result = CoherenceLabImport.validateStructuredExport(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('structured_missing_prescriptions') !== -1);
  });
});

describe('validateNativeSave', function () {

  it('should pass a valid native save', function () {
    var result = CoherenceLabImport.validateNativeSave(makeNativeSave());
    assertEqual(result.valid, true);
    assertEqual(result.errors.length, 0);
  });

  it('should fail if metadata.sessionId is missing', function () {
    var obj = makeNativeSave();
    obj.metadata = {};
    var result = CoherenceLabImport.validateNativeSave(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('native_missing_session_id') !== -1);
  });

  it('should fail if streams is missing', function () {
    var obj = makeNativeSave();
    delete obj.streams;
    var result = CoherenceLabImport.validateNativeSave(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('native_missing_streams') !== -1);
  });

  it('should fail if streams.coherence is not an array', function () {
    var obj = makeNativeSave();
    delete obj.streams.coherence;
    var result = CoherenceLabImport.validateNativeSave(obj);
    assertEqual(result.valid, false);
    assert(result.errors.indexOf('native_missing_coherence') !== -1);
  });
});

describe('convertNativeToCanonical', function () {

  it('should produce canonical shape from native save', function () {
    var native = makeNativeSave();
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);

    assertEqual(canonical.aetheria_export_version, '1.0');
    assertEqual(canonical.export_type, 'session_summary_for_tagger');
    assert(typeof canonical.exported_at === 'string');
    assertEqual(canonical.metadata.sessionId, 'lab-native-001');
    assertEqual(canonical.session.duration_seconds, 246);
  });

  it('should compute summary correctly from streams', function () {
    var native = makeNativeSave();
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);
    var sum = canonical.summary;

    // peak_tcs: max of [30, 60, 82.7, 55, 70] = 82.7
    assertEqual(sum.peak_tcs, 82.7);
    // mean_tcs: (30+60+82.7+55+70)/5 = 59.54 → 59.5
    assertEqual(sum.mean_tcs, 59.5);
    // peak_bcs: max of [20, 50, 68.6] = 68.6
    assertEqual(sum.peak_bcs, 68.6);
    // phase transition detected
    assertEqual(sum.phase_transition_detected, true);
    assertEqual(sum.phase_transition_time_seconds, 2);
    // harm_one_count: entries with harm === 1.0 → indices 1, 2, 4 = 3
    assertEqual(sum.harm_one_count, 3);
    // cascade_flips: "cascade flipped to modulate" contains "flipped"
    assertEqual(sum.cascade_flips, 1);
    // prescriptions played: 2 play actions
    assertEqual(sum.prescriptions_count, 2);
    // closing: state has CLOSING
    assertEqual(sum.closing_type, 'graceful');
  });

  it('should convert time_series with camelCase → snake_case', function () {
    var native = makeNativeSave();
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);
    var ts = canonical.time_series;

    assertEqual(ts.coherence_t.length, 5);
    assertEqual(ts.bcs_shared_energy.length, 3);
    assertEqual(ts.bcs_mutual_info.length, 3);
    assertEqual(ts.bcs_phase_transition.length, 3);
    // Verify actual values
    assertEqual(ts.bcs_shared_energy[0], 0.1);
    assertEqual(ts.bcs_mutual_info[2], 0.6);
    assertEqual(ts.bcs_phase_transition[2], true);
  });

  it('should drop raw biosignal streams', function () {
    var native = makeNativeSave();
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);

    // The canonical output should NOT have rr, eeg, ppg, fnirs, imu, features, audio, haptic
    assert(!canonical.rr, 'should not have rr');
    assert(!canonical.eeg, 'should not have eeg');
    assert(!canonical.ppg, 'should not have ppg');
    assert(!canonical.streams, 'should not carry raw streams object');
  });

  it('should handle empty bcs stream gracefully', function () {
    var native = makeNativeSave();
    native.streams.bcs = [];
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);

    assertEqual(canonical.summary.peak_bcs, null);
    assertEqual(canonical.summary.mean_bcs, null);
    assertEqual(canonical.summary.phase_transition_detected, false);
    assertEqual(canonical.summary.phase_transition_time_seconds, null);
  });
});

describe('buildSessionRecord', function () {

  it('should produce a v2.0 tagger record from structured export', function () {
    var exp = makeStructuredExport();
    var record = CoherenceLabImport.buildSessionRecord(exp, 'structured_export');

    assertEqual(record.schema_version, '2.0');
    assertEqual(record.session_id, 'lab-structured-001');
    assertEqual(record.source, 'coherence_lab');
    assertEqual(record.session_date, '2026-04-16');
    assert(typeof record.imported_at === 'string');
    assert(typeof record.last_edited_at === 'string');

    // Context should be empty starter
    assertEqual(record.context.condition, '');
    assertEqual(record.context.mood_before, null);
    assertEqual(record.context.notes, '');

    // source_data should have summary and prescriptions_played
    assertEqual(record.source_data.summary.peak_tcs, 82.7);
    assertEqual(record.source_data.prescriptions_played.length, 5);

    // raw_import should have metadata but NOT time_series (stripped to save space)
    assertEqual(record.raw_import.aetheria_export_version, '1.0');
    assertEqual(record.raw_import.summary.peak_tcs, 82.7);
    assert(record.raw_import.time_series == null, 'time_series should be stripped from raw_import');
  });

  it('should produce a v2.0 record from converted native save', function () {
    var native = makeNativeSave();
    var canonical = CoherenceLabImport.convertNativeToCanonical(native);
    var record = CoherenceLabImport.buildSessionRecord(canonical, 'native_save');

    assertEqual(record.schema_version, '2.0');
    assertEqual(record.session_id, 'lab-native-001');
    assertEqual(record.source, 'coherence_lab');
    assertEqual(record.session_date, '2026-04-16');
    assert(record.source_data.summary.peak_tcs != null);
    assert(record.raw_import.summary != null, 'raw_import has summary');
    assert(record.raw_import.time_series == null, 'time_series stripped');
  });
});

describe('importCoherenceLabFile (full orchestration)', function () {

  it('should return error for invalid JSON', function () {
    freshEnv();
    var result = CoherenceLabImport.importCoherenceLabFile('not json {{{');
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('JSON') !== -1);
  });

  it('should return error for unknown format', function () {
    freshEnv();
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify({ foo: 'bar' }));
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('Coherence Lab') !== -1);
  });

  it('should return error for invalid structured export', function () {
    freshEnv();
    var obj = makeStructuredExport();
    delete obj.summary;
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(obj));
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('summary') !== -1);
  });

  it('should return error for invalid native save', function () {
    freshEnv();
    var obj = makeNativeSave();
    delete obj.streams.coherence;
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(obj));
    assertEqual(result.status, 'error');
    assert(result.error.indexOf('coherence') !== -1);
  });

  it('should successfully import structured export', function () {
    freshEnv();
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport()));
    assertEqual(result.status, 'ok');
    assertEqual(result.isDuplicate, false);
    assertEqual(result.record.session_id, 'lab-structured-001');
    assertEqual(result.record.source, 'coherence_lab');
    assertEqual(result.record.schema_version, '2.0');
  });

  it('should successfully import native save', function () {
    freshEnv();
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeNativeSave()));
    assertEqual(result.status, 'ok');
    assertEqual(result.isDuplicate, false);
    assertEqual(result.record.session_id, 'lab-native-001');
    assertEqual(result.record.source, 'coherence_lab');
  });

  it('should detect duplicate when session already in store', function () {
    freshEnv();
    // First import: save to store
    var first = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport()));
    assertEqual(first.status, 'ok');
    TaggerStore.saveSession(first.record);

    // Second import: same session_id
    var second = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport()));
    assertEqual(second.status, 'duplicate');
    assertEqual(second.isDuplicate, true);
    assert(second.existingRecord != null, 'should have existingRecord');
    assertEqual(second.existingRecord.session_id, 'lab-structured-001');
  });

  it('should produce records that pass TaggerStore.validateRecord', function () {
    freshEnv();
    var resultA = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport()));
    var validA = TaggerStore.validateRecord(resultA.record);
    assertEqual(validA.valid, true, 'structured export record should be valid: ' + validA.errors.join(', '));

    var resultB = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeNativeSave()));
    var validB = TaggerStore.validateRecord(resultB.record);
    assertEqual(validB.valid, true, 'native save record should be valid: ' + validB.errors.join(', '));
  });

  it('both formats should produce records with the same canonical shape', function () {
    freshEnv();
    var recA = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport())).record;
    var recB = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeNativeSave())).record;

    // Both should have the same top-level keys
    var keysA = Object.keys(recA).sort();
    var keysB = Object.keys(recB).sort();
    assertEqual(JSON.stringify(keysA), JSON.stringify(keysB), 'top-level keys match');

    // Both should have the same context keys
    var ctxKeysA = Object.keys(recA.context).sort();
    var ctxKeysB = Object.keys(recB.context).sort();
    assertEqual(JSON.stringify(ctxKeysA), JSON.stringify(ctxKeysB), 'context keys match');

    // Both should have source_data.summary and source_data.prescriptions_played
    assert(recA.source_data.summary != null, 'A has summary');
    assert(recB.source_data.summary != null, 'B has summary');
    assert(Array.isArray(recA.source_data.prescriptions_played), 'A has prescriptions_played');
    assert(Array.isArray(recB.source_data.prescriptions_played), 'B has prescriptions_played');

    // Both should have lightweight raw_import (no time_series)
    assert(recA.raw_import.summary != null, 'A raw_import has summary');
    assert(recB.raw_import.summary != null, 'B raw_import has summary');
    assert(recA.raw_import.time_series == null, 'A time_series stripped');
    assert(recB.raw_import.time_series == null, 'B time_series stripped');
  });
});

describe('computeSessionSummary', function () {

  it('should compute summary from a v2.0 record', function () {
    freshEnv();
    var result = CoherenceLabImport.importCoherenceLabFile(JSON.stringify(makeStructuredExport()));
    var sum = CoherenceLabImport.computeSessionSummary(result.record);

    assertEqual(sum.durationSec, 246);
    assertEqual(sum.peakTCS, 82.7);
    assertEqual(sum.peakBCS, 68.6);
    assertEqual(sum.ptDetected, true);
    assertEqual(sum.harmonicLocks, 13);
    assertEqual(sum.rxPlayed, 5);
    assertEqual(sum.closingType, 'graceful');
  });

  it('should also work with a raw canonical export', function () {
    var exp = makeStructuredExport();
    var sum = CoherenceLabImport.computeSessionSummary(exp);
    assertEqual(sum.peakTCS, 82.7);
    assertEqual(sum.durationSec, 246);
  });
});

describe('formatPtTime', function () {

  it('should return seconds directly for small values', function () {
    assertEqual(CoherenceLabImport.formatPtTime(118, null), 118);
  });

  it('should convert ms timestamps relative to startTime', function () {
    var meta = { startTime: '2026-04-16T13:50:00.000Z' };
    var startMs = new Date(meta.startTime).getTime();
    var result = CoherenceLabImport.formatPtTime(startMs + 118000, meta);
    assertEqual(result, 118);
  });

  it('should return "?" for null', function () {
    assertEqual(CoherenceLabImport.formatPtTime(null, null), '?');
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
