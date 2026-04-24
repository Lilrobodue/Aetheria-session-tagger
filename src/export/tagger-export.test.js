// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Export Module Tests
// Run:  node src/export/tagger-export.test.js
// ═══════════════════════════════════════════════════════════════

var passed = 0;
var failed = 0;
var currentTest = '';

function describe(name, fn) { console.log('\n\x1b[1m' + name + '\x1b[0m'); fn(); }
function it(name, fn) {
  currentTest = name;
  try { fn(); passed++; console.log('  \x1b[32m\u2713\x1b[0m ' + name); }
  catch (e) { failed++; console.log('  \x1b[31m\u2717\x1b[0m ' + name); console.log('    \x1b[31m' + e.message + '\x1b[0m'); }
}
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed in: ' + currentTest); }
function assertEqual(a, b, m) { if (a !== b) throw new Error((m || 'assertEqual') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

var TaggerExport = require('./tagger-export');

// ─── Test data ──────────────────────────────────────────────────

function makeLabRecord() {
  return {
    schema_version: '2.0', session_id: 'lab-001', source: 'coherence_lab',
    imported_at: '2026-04-16T14:00:00Z', last_edited_at: '2026-04-16T14:00:00Z',
    session_date: '2026-04-16',
    context: { condition: 'playlist', moon: '\u{1F315} Full', sleep: 7.5, mood_before: 4, mood_after: 8, mood_change: 4, pain: 2, activity: 'Relaxing', notes: 'Great session' },
    source_data: { summary: { peak_tcs: 82.7, mean_tcs: 55.2, peak_bcs: 68.6, mean_bcs: 34.2, phase_transition_detected: true, phase_transition_time_seconds: 118, harm_one_count: 13, harm_mean: 0.672, cascade_flips: 0, prescriptions_count: 5, closing_type: 'graceful' }, prescriptions_played: [{ t: 10, action: 'play', frequency: 432 }] },
    raw_import: { summary: { peak_tcs: 82.7, mean_tcs: 55.2, peak_bcs: 68.6, mean_bcs: 34.2, phase_transition_detected: true, phase_transition_time_seconds: 118, harm_one_count: 13, harm_mean: 0.672, cascade_flips: 0, prescriptions_count: 5, closing_type: 'graceful' }, session: { duration_seconds: 246 }, metadata: { softwareVersion: '1.0.0' } }
  };
}

function makeSophiaRecord() {
  return {
    schema_version: '2.0', session_id: 'sophia-001', source: 'sophia',
    imported_at: '2026-04-16T11:00:00Z', last_edited_at: '2026-04-16T11:00:00Z',
    session_date: '2026-04-16',
    context: { condition: '', moon: 'unknown', sleep: null, mood_before: null, mood_after: null, mood_change: null, pain: null, activity: '', notes: '' },
    source_data: {
      device: 'MuseS-F0D4', device_type: 'athena', snapshot_count: 2,
      first_snapshot_at: '2026-04-16T10:57:07Z', last_snapshot_at: '2026-04-16T11:05:00Z',
      snapshots: [
        { t: '2026-04-16T10:57:07Z', position: 1, frequency_hz: 174, regime: 'GUT',
          symbolic: { geometry: 'Seed of Life', state: 'SCATTERED FIELD', keyword: 'Foundation', i_ching_hexagram: 24, i_ching_name: 'Return' },
          metrics: { coherence: 10, focus: 80, meditation: 26, dominant_wave: 'gamma' },
          band_powers: { delta: 0.25, theta: 0.10, alpha: 0.11, beta: 0.25, gamma: 0.29 },
          fnirs: null, heart_rate: 62 },
        { t: '2026-04-16T11:05:00Z', position: 3, frequency_hz: 258, regime: 'HEART',
          symbolic: { geometry: 'Torus Knot', state: 'EMERGING', keyword: 'Harmony', i_ching_hexagram: 19, i_ching_name: 'Approach' },
          metrics: { coherence: 18, focus: 65, meditation: 55, dominant_wave: 'alpha' },
          band_powers: { delta: 0.15, theta: 0.20, alpha: 0.30, beta: 0.20, gamma: 0.15 },
          fnirs: null, heart_rate: 58 }
      ],
      summary: { dominant_regime: 'GUT', dominant_geometry: 'Seed of Life', hexagrams_encountered: [19, 24], mean_coherence: 14, peak_coherence: 18, mean_focus: 72.5, mean_meditation: 40.5 }
    },
    raw_import: [{}]
  };
}

function makeManualRecord() {
  return {
    schema_version: '2.0', session_id: 'manual-001', source: 'manual',
    imported_at: '2026-04-16T09:00:00Z', last_edited_at: '2026-04-16T09:00:00Z',
    session_date: '2026-04-16',
    context: { condition: 'silent', moon: '\u{1F311} New', sleep: 6, mood_before: 3, mood_after: 7, mood_change: 4, pain: 5, activity: 'Working', notes: 'Felt calm after' },
    source_data: { description: 'Morning meditation, 20 minutes' },
    raw_import: null
  };
}

// ═══════════════════════════════════════════════════════════════

describe('CSV value escaping', function () {

  it('should pass through simple strings', function () {
    assertEqual(TaggerExport._csvVal('hello'), 'hello');
  });

  it('should escape strings with commas', function () {
    assertEqual(TaggerExport._csvVal('a,b'), '"a,b"');
  });

  it('should escape strings with quotes', function () {
    assertEqual(TaggerExport._csvVal('say "hi"'), '"say ""hi"""');
  });

  it('should escape strings with newlines', function () {
    assertEqual(TaggerExport._csvVal('line1\nline2'), '"line1\nline2"');
  });

  it('should convert null to empty string', function () {
    assertEqual(TaggerExport._csvVal(null), '');
    assertEqual(TaggerExport._csvVal(undefined), '');
  });

  it('should convert booleans', function () {
    assertEqual(TaggerExport._csvVal(true), 'true');
    assertEqual(TaggerExport._csvVal(false), 'false');
  });

  it('should join arrays with semicolons', function () {
    assertEqual(TaggerExport._csvVal([1, 2, 3]), '1;2;3');
  });

  it('should handle numbers', function () {
    assertEqual(TaggerExport._csvVal(42), '42');
    assertEqual(TaggerExport._csvVal(3.14), '3.14');
  });
});

describe('exportCoherenceLabCSV', function () {

  it('should produce correct header count', function () {
    var csv = TaggerExport.exportCoherenceLabCSV([makeLabRecord()]);
    var header = csv.split('\n')[0];
    var cols = header.split(',');
    assertEqual(cols.length, 30, 'header columns');
    assert(cols[0] === 'session_id');
    assert(cols[cols.length - 1] === 'signal_quality');
  });

  it('should produce one data row per record', function () {
    var csv = TaggerExport.exportCoherenceLabCSV([makeLabRecord(), makeLabRecord()]);
    var lines = csv.split('\n');
    assertEqual(lines.length, 3, 'header + 2 data rows');
  });

  it('should include context and lab-specific fields', function () {
    var csv = TaggerExport.exportCoherenceLabCSV([makeLabRecord()]);
    var row = csv.split('\n')[1];
    assert(row.indexOf('lab-001') !== -1, 'session_id');
    assert(row.indexOf('playlist') !== -1, 'condition');
    assert(row.indexOf('82.7') !== -1, 'peak_tcs');
    assert(row.indexOf('graceful') !== -1, 'closing_type');
    assert(row.indexOf('246') !== -1, 'duration');
  });

  it('should handle empty array', function () {
    var csv = TaggerExport.exportCoherenceLabCSV([]);
    var lines = csv.split('\n');
    assertEqual(lines.length, 1, 'header only');
  });
});

describe('exportSophiaCSV', function () {

  it('should produce correct header count', function () {
    var csv = TaggerExport.exportSophiaCSV([makeSophiaRecord()]);
    var cols = csv.split('\n')[0].split(',');
    assertEqual(cols.length, 22, 'header columns');
  });

  it('should include sophia-specific fields', function () {
    var csv = TaggerExport.exportSophiaCSV([makeSophiaRecord()]);
    var row = csv.split('\n')[1];
    assert(row.indexOf('MuseS-F0D4') !== -1, 'device');
    assert(row.indexOf('GUT') !== -1, 'regime');
    assert(row.indexOf('19;24') !== -1, 'hexagrams as semicolon-joined');
  });
});

describe('exportSophiaSnapshotsCSV', function () {

  it('should produce one row per snapshot', function () {
    var csv = TaggerExport.exportSophiaSnapshotsCSV([makeSophiaRecord()]);
    var lines = csv.split('\n');
    assertEqual(lines.length, 3, 'header + 2 snapshots');
  });

  it('should include snapshot-level fields', function () {
    var csv = TaggerExport.exportSophiaSnapshotsCSV([makeSophiaRecord()]);
    var header = csv.split('\n')[0];
    assert(header.indexOf('snapshot_t') !== -1);
    assert(header.indexOf('geometry') !== -1);
    assert(header.indexOf('heart_rate') !== -1);
    var row1 = csv.split('\n')[1];
    assert(row1.indexOf('Seed of Life') !== -1, 'geometry value');
    assert(row1.indexOf('Foundation') !== -1, 'keyword');
    assert(row1.indexOf('62') !== -1, 'heart_rate');
  });

  it('should produce correct header count', function () {
    var csv = TaggerExport.exportSophiaSnapshotsCSV([makeSophiaRecord()]);
    var cols = csv.split('\n')[0].split(',');
    assertEqual(cols.length, 21, 'header columns');
  });

  it('should include band powers as decimals', function () {
    var csv = TaggerExport.exportSophiaSnapshotsCSV([makeSophiaRecord()]);
    var row1 = csv.split('\n')[1];
    assert(row1.indexOf('0.25') !== -1, 'delta band power');
    assert(row1.indexOf('0.29') !== -1, 'gamma band power');
  });
});

describe('exportManualCSV', function () {

  it('should produce correct header count', function () {
    var csv = TaggerExport.exportManualCSV([makeManualRecord()]);
    var cols = csv.split('\n')[0].split(',');
    assertEqual(cols.length, 13, 'header columns');
    assert(cols[cols.length - 1] === 'description');
  });

  it('should include context and description', function () {
    var csv = TaggerExport.exportManualCSV([makeManualRecord()]);
    var row = csv.split('\n')[1];
    assert(row.indexOf('silent') !== -1, 'condition');
    assert(row.indexOf('Morning meditation') !== -1, 'description');
  });
});

describe('exportUnifiedCSV', function () {

  it('should produce correct header count', function () {
    var all = [makeLabRecord(), makeSophiaRecord(), makeManualRecord()];
    var csv = TaggerExport.exportUnifiedCSV(all);
    var cols = csv.split('\n')[0].split(',');
    assertEqual(cols.length, 58, 'header columns');
  });

  it('should produce one row per session regardless of source', function () {
    var all = [makeLabRecord(), makeSophiaRecord(), makeManualRecord()];
    var csv = TaggerExport.exportUnifiedCSV(all);
    var lines = csv.split('\n');
    assertEqual(lines.length, 4, 'header + 3 data rows');
  });

  it('should have lab fields filled for lab record and empty for others', function () {
    var all = [makeLabRecord(), makeManualRecord()];
    var csv = TaggerExport.exportUnifiedCSV(all);
    var lines = csv.split('\n');
    // Lab row should have peak_tcs
    assert(lines[1].indexOf('82.7') !== -1, 'lab row has peak_tcs');
    // Manual row should not have lab data (columns are empty)
    var manualCols = lines[2].split(',');
    // Find lab_peak_tcs column index
    var headerCols = lines[0].split(',');
    var labPeakIdx = headerCols.indexOf('lab_peak_tcs');
    assertEqual(manualCols[labPeakIdx], '', 'manual row has empty lab_peak_tcs');
  });

  it('should include source column', function () {
    var csv = TaggerExport.exportUnifiedCSV([makeLabRecord()]);
    var header = csv.split('\n')[0];
    assert(header.indexOf('source') !== -1);
    var row = csv.split('\n')[1];
    assert(row.indexOf('coherence_lab') !== -1);
  });
});

describe('exportFullJSON', function () {

  it('should produce valid JSON with schema_version and session_count', function () {
    var all = [makeLabRecord(), makeSophiaRecord()];
    var json = TaggerExport.exportFullJSON(all);
    var parsed = JSON.parse(json);
    assertEqual(parsed.schema_version, '2.0');
    assertEqual(parsed.session_count, 2);
    assert(typeof parsed.exported_at === 'string');
    assertEqual(parsed.sessions.length, 2);
  });

  it('should include full records with raw_import', function () {
    var all = [makeLabRecord()];
    var json = TaggerExport.exportFullJSON(all);
    var parsed = JSON.parse(json);
    assertEqual(parsed.sessions[0].session_id, 'lab-001');
    assert(parsed.sessions[0].raw_import != null, 'raw_import preserved');
  });

  it('should handle empty array', function () {
    var json = TaggerExport.exportFullJSON([]);
    var parsed = JSON.parse(json);
    assertEqual(parsed.session_count, 0);
    assertEqual(parsed.sessions.length, 0);
  });
});

describe('CSV escaping edge cases', function () {

  it('should handle notes with commas and quotes', function () {
    var rec = makeLabRecord();
    rec.context.notes = 'He said, "wow" and I felt great';
    var csv = TaggerExport.exportCoherenceLabCSV([rec]);
    // The notes should be wrapped in quotes with internal quotes doubled
    assert(csv.indexOf('""wow""') !== -1, 'doubled quotes');
  });

  it('should handle null context gracefully', function () {
    var rec = makeLabRecord();
    rec.context = null;
    var csv = TaggerExport.exportCoherenceLabCSV([rec]);
    var lines = csv.split('\n');
    assertEqual(lines.length, 2, 'still produces a data row');
  });

  it('should handle missing source_data gracefully', function () {
    var rec = makeSophiaRecord();
    rec.source_data = null;
    var csv = TaggerExport.exportSophiaCSV([rec]);
    var lines = csv.split('\n');
    assertEqual(lines.length, 2, 'still produces a data row');
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
