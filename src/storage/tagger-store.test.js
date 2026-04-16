// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Storage Module Tests
// Run:  node src/storage/tagger-store.test.js
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
function assert(condition, msg) { if (!condition) throw new Error(msg || 'Assertion failed in: ' + currentTest); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || 'assertEqual') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

var TaggerStore = require('./tagger-store.js');

function freshStore() {
  TaggerStore._setStorage();
}

function makeRecord(overrides) {
  var base = {
    schema_version: '2.0',
    session_id: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    source: 'manual',
    imported_at: '2026-04-16T12:00:00.000Z',
    last_edited_at: '2026-04-16T12:00:00.000Z',
    session_date: '2026-04-16',
    context: { condition: '', moon: 'unknown', sleep: null, mood_before: null, mood_after: null, mood_change: null, pain: null, activity: '', notes: '' },
    source_data: {},
    raw_import: null
  };
  if (overrides) { for (var k in overrides) { if (overrides.hasOwnProperty(k)) base[k] = overrides[k]; } }
  return base;
}

// ═══════════════════════════════════════════════════════════════

describe('saveSession / loadSession', function () {

  it('should save a record and load it back with structure preserved', function () {
    freshStore();
    var rec = makeRecord({ session_id: 'save-load-1', source: 'manual' });
    rec.context.condition = 'playlist';
    rec.context.mood_before = 5;
    rec.context.mood_after = 8;
    rec.context.mood_change = 3;

    TaggerStore.saveSession(rec);
    var loaded = TaggerStore.loadSession('save-load-1');

    assertEqual(loaded.session_id, 'save-load-1');
    assertEqual(loaded.source, 'manual');
    assertEqual(loaded.schema_version, '2.0');
    assertEqual(loaded.session_date, '2026-04-16');
    assertEqual(loaded.context.condition, 'playlist');
    assertEqual(loaded.context.mood_before, 5);
    assertEqual(loaded.context.mood_after, 8);
    assert(loaded.raw_import === null, 'raw_import should be null');
  });

  it('should update last_edited_at on save', function () {
    freshStore();
    var rec = makeRecord({ session_id: 'ts-1', last_edited_at: '2020-01-01T00:00:00.000Z' });
    TaggerStore.saveSession(rec);
    var loaded = TaggerStore.loadSession('ts-1');
    assert(loaded.last_edited_at !== '2020-01-01T00:00:00.000Z', 'last_edited_at should be updated');
  });

  it('should return null for a non-existent session', function () {
    freshStore();
    assertEqual(TaggerStore.loadSession('does-not-exist'), null);
  });

  it('should throw if record has no session_id', function () {
    freshStore();
    var threw = false;
    try { TaggerStore.saveSession({}); } catch (e) { threw = true; }
    assert(threw, 'should throw for missing session_id');
  });
});

describe('listAllSessions', function () {

  it('should return all saved records', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'list-1', session_date: '2026-04-10' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'list-2', session_date: '2026-04-12' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'list-3', session_date: '2026-04-14' }));

    var all = TaggerStore.listAllSessions();
    assertEqual(all.length, 3, 'count');
    assertEqual(all[0].session_id, 'list-3');
    assertEqual(all[1].session_id, 'list-2');
    assertEqual(all[2].session_id, 'list-1');
  });

  it('should return empty array when no sessions exist', function () {
    freshStore();
    assertEqual(TaggerStore.listAllSessions().length, 0);
  });
});

describe('deleteSession', function () {

  it('should remove the record and update the index', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'del-1' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'del-2' }));

    TaggerStore.deleteSession('del-1');

    assertEqual(TaggerStore.loadSession('del-1'), null, 'record should be gone');
    var idx = TaggerStore.getIndex();
    assertEqual(idx.sessions.length, 1, 'index should have 1 entry');
    assertEqual(idx.sessions[0].session_id, 'del-2');
  });

  it('should be a no-op for a non-existent session', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'del-safe' }));
    TaggerStore.deleteSession('does-not-exist');
    assertEqual(TaggerStore.listAllSessions().length, 1);
  });
});

describe('rebuildIndex', function () {

  it('should regenerate index from all stored records', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'rb-1', session_date: '2026-04-01' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'rb-2', session_date: '2026-04-05' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'rb-3', session_date: '2026-04-03' }));

    var idx = TaggerStore.rebuildIndex();
    assertEqual(idx.sessions.length, 3, 'should find all 3 records');
    assertEqual(idx.schema_version, '2.0');
    assertEqual(idx.sessions[0].session_id, 'rb-2');
    assertEqual(idx.sessions[1].session_id, 'rb-3');
    assertEqual(idx.sessions[2].session_id, 'rb-1');
  });

  it('should produce the same result as the live index', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'cmp-1', session_date: '2026-04-10' }));
    TaggerStore.saveSession(makeRecord({ session_id: 'cmp-2', session_date: '2026-04-15' }));

    var liveIdx = TaggerStore.getIndex();
    var rebuilt = TaggerStore.rebuildIndex();
    assertEqual(liveIdx.sessions.length, rebuilt.sessions.length, 'same count');
    for (var i = 0; i < liveIdx.sessions.length; i++) {
      assertEqual(liveIdx.sessions[i].session_id, rebuilt.sessions[i].session_id, 'same order at ' + i);
    }
  });
});

describe('Index: summary_line generation', function () {

  it('should generate summary for coherence_lab source', function () {
    freshStore();
    var rec = makeRecord({
      session_id: 'sum-lab', source: 'coherence_lab',
      source_data: { summary: { peak_bcs: 68.6, peak_tcs: 42.3, phase_transition_detected: true } }
    });
    TaggerStore.saveSession(rec);
    var idx = TaggerStore.getIndex();
    var entry = idx.sessions[0];
    assert(entry.summary_line.indexOf('Peak BCS 68.6') !== -1, 'should contain BCS');
    assert(entry.summary_line.indexOf('Phase Transition') !== -1, 'should contain phase transition');
  });

  it('should generate summary for manual source with mood delta', function () {
    freshStore();
    var rec = makeRecord({
      session_id: 'sum-manual', source: 'manual',
      context: { condition: 'playlist', moon: 'unknown', sleep: 7, mood_before: 4, mood_after: 8, mood_change: 4, pain: null, activity: '', notes: '' }
    });
    TaggerStore.saveSession(rec);
    var idx = TaggerStore.getIndex();
    var entry = idx.sessions[0];
    assert(entry.summary_line.indexOf('playlist') !== -1, 'should contain condition');
    assert(entry.summary_line.indexOf('Mood +4') !== -1, 'should contain mood delta');
  });
});

describe('migrateIfNeeded', function () {

  it('should return clean_install when no data exists', function () {
    freshStore();
    var result = TaggerStore.migrateIfNeeded();
    assertEqual(result.reason, 'clean_install');
  });

  it('should return already_current when sessions exist', function () {
    freshStore();
    TaggerStore.saveSession(makeRecord({ session_id: 'mig-1' }));
    var result = TaggerStore.migrateIfNeeded();
    assertEqual(result.reason, 'already_current');
  });
});

describe('validateRecord', function () {

  it('should return valid: true for a well-formed record', function () {
    var rec = makeRecord();
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, true, 'should be valid');
    assertEqual(result.errors.length, 0, 'no errors');
  });

  it('should catch missing session_id', function () {
    var rec = makeRecord(); delete rec.session_id;
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, false);
    assert(result.errors.some(function (e) { return e.indexOf('session_id') !== -1; }));
  });

  it('should catch invalid source', function () {
    var rec = makeRecord({ source: 'invalid_source' });
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, false);
    assert(result.errors.some(function (e) { return e.indexOf('source') !== -1; }));
  });

  it('should catch missing context keys', function () {
    var rec = makeRecord(); rec.context = { condition: '' };
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, false);
    assert(result.errors.some(function (e) { return e.indexOf('context.moon') !== -1; }));
  });

  it('should catch missing source_data', function () {
    var rec = makeRecord(); delete rec.source_data;
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, false);
    assert(result.errors.some(function (e) { return e.indexOf('source_data') !== -1; }));
  });

  it('should catch bad session_date format', function () {
    var rec = makeRecord({ session_date: '04-16-2026' });
    var result = TaggerStore.validateRecord(rec);
    assertEqual(result.valid, false);
    assert(result.errors.some(function (e) { return e.indexOf('YYYY-MM-DD') !== -1; }));
  });

  it('should reject null input', function () {
    assertEqual(TaggerStore.validateRecord(null).valid, false);
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
