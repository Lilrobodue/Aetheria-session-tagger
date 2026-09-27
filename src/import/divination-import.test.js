// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Divination Import Tests
// Run:  node src/import/divination-import.test.js
//
// fixtures/divination-export.json and divination-export-later.json
// are real exports, made by running Aetheria Divination's own
// taggerExport (src/store/tagger.js) under Node on 27 Sep 2026:
//   first export — three readings answered in the Honest Mirror
//     (The Moment: hit; Coins: miss; Heart Yarrow: hit with a note),
//     one pending and one left out (neither is exported);
//   later export — the pending reading answered (The Question: miss
//     with a note), and the Moment reading's Mirror now carries a note.
// If Divination's export changes, regenerate them the same way.
// ═══════════════════════════════════════════════════════════════

var fs = require('fs');
var path = require('path');

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
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (e) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + name);
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
var DivinationImport = require('./divination-import');
var TaggerExport = require('../export/tagger-export');

function freshEnv() {
  TaggerStore._setStorage();
}

// ─── Test data ──────────────────────────────────────────────────

var FIRST = fs.readFileSync(path.join(__dirname, 'fixtures', 'divination-export.json'), 'utf8');
var LATER = fs.readFileSync(path.join(__dirname, 'fixtures', 'divination-export-later.json'), 'utf8');

var ID_MOMENT = 'divination_b7d2c9e4-5a31-4f0e-9c6b-2e8a1d4f7a10';
var ID_COINS  = 'divination_0f3a9b21-8c44-4d7e-a1f5-6b2c9e8d3a47';
var ID_HEART  = 'divination_5e8d1c77-2b90-4a36-8f14-c3a7e0b92d58';
var ID_QUEST  = 'divination_a41c6f08-93d2-47b5-b8e0-7d15f2c4e9a3';

function firstObj() { return JSON.parse(FIRST); }

// Import a file and save what it found, the way the UI does.
function importAndCommit(text) {
  var res = DivinationImport.importDivinationFile(text);
  if (res.status !== 'ok') throw new Error('import failed: ' + res.error);
  var saved = DivinationImport.commitDivinationImport(res);
  return { res: res, saved: saved };
}

// The first export with one session changed by fn (for malformed cases).
function withSession(index, fn) {
  var obj = firstObj();
  fn(obj.sessions[index], obj);
  return JSON.stringify(obj);
}

// Quote-aware CSV reader (notes hold newlines inside quoted cells).
function parseCsv(text) {
  var rows = [], row = [], cell = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function skipReason(text) {
  var res = DivinationImport.importDivinationFile(text);
  assertEqual(res.status, 'ok', 'the other readings still import');
  assertEqual(res.skippedCount, 1, 'one reading skipped');
  return res.skipped[0].reason;
}

// ═══════════════════════════════════════════════════════════════

describe('detectDivinationFormat', function () {

  it('recognises a Divination Tagger export', function () {
    assertEqual(DivinationImport.detectDivinationFormat(firstObj()), 'tagger_export');
  });

  it("recognises Divination's journal backup so the person can be pointed to the right export", function () {
    var backup = { app: 'aetheria-divination', kind: 'journal', version: 1, exportedAt: '2026-09-27T16:00:00.000Z', count: 0, entries: [] };
    assertEqual(DivinationImport.detectDivinationFormat(backup), 'journal_backup');
  });

  it("ignores the other apps' formats and the Tagger's own Full JSON", function () {
    var lab = { aetheria_export_version: '1.0', export_type: 'session_summary_for_tagger', metadata: { sessionId: 'x' } };
    var rct = { system: 'Aetheria Resonant Coherence Training', sessions: [], frequencies: [] };
    var sophia = { exportVersion: 2, device: 'MuseS', deviceType: 'athena', timeline: [] };
    var full = JSON.parse(TaggerExport.exportFullJSON([]));
    [lab, rct, sophia, full, null, [], 'text', 42].forEach(function (o) {
      assertEqual(DivinationImport.detectDivinationFormat(o), null, JSON.stringify(o));
    });
  });
});

describe('importDivinationFile — a real Divination export', function () {

  it('finds the three answered readings, all new', function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    assertEqual(res.status, 'ok');
    assertEqual(res.totalCount, 3);
    assertEqual(res.newCount, 3);
    assertEqual(res.updatedCount, 0);
    assertEqual(res.unchangedCount, 0);
    assertEqual(res.skippedCount, 0);
    assertEqual(res.exportDate, '2026-09-27T16:00:00.000Z');
    assert(typeof res.mapVersion === 'string' && res.mapVersion.length > 0, 'map version');
  });

  it("makes records that pass the Tagger's own validation", function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    res.newSessions.forEach(function (r) {
      var v = TaggerStore.validateRecord(r);
      assert(v.valid, r.session_id + ': ' + v.errors.join(', '));
      assertEqual(r.source, 'divination');
      assertEqual(r.schema_version, '2.0');
    });
  });

  it('keeps the clock date, the Moon and the notes, and leaves the protocol fields empty', function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    var r = res.newSessions.filter(function (x) { return x.session_id === ID_MOMENT; })[0];
    assertEqual(r.session_date, '2026-09-11', 'device clock date at 20:40 MDT');
    assertEqual(r.context.moon, '\u{1F311} New');
    assert(r.context.notes.indexOf('Should we build the web prototype first?') !== -1, 'question in notes');
    assert(r.context.notes.indexOf('Honest Mirror: the reading fit what happened.') !== -1, 'Mirror in notes');
    assertEqual(r.context.dominant_regime, '');
    assertEqual(r.context.classification, '');
    assertEqual(r.context.coherence_score, null);
    assertEqual(r.context.duration_minutes, null);
  });

  it('keeps the reading in RCT-style fields: hexagram, hexagram_name, frequency_hz', function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    var sd = res.newSessions.filter(function (x) { return x.session_id === ID_MOMENT; })[0].source_data;
    assertEqual(sd.hexagrams.present.hexagram, 36);
    assertEqual(sd.hexagrams.present.hexagram_name, 'Darkening of the Light');
    assertEqual(sd.hexagrams.changed.hexagram_name, 'Return');
    assertEqual(sd.journey.length, 3);
    assertEqual(sd.journey[0].frequency_hz, 2178);
    assertEqual(sd.journey_hz.join(';'), '2178;396;639');
    assertEqual(sd.cast.moving_lines.join(','), '3');
    assertEqual(sd.mirror.status, 'hit');
    assertEqual(sd.method_name, 'The Moment');
    assert(sd.map_version, 'frequencies carry their map version');
    assertEqual(sd.sky.mansion_name, 'Uttara Phalguni');
    assertEqual(sd.verdict.now, 'support');
    assertEqual(sd.as_imported.session_date, '2026-09-11');
    assertEqual(sd.as_imported.context.notes, res.newSessions.filter(function (x) { return x.session_id === ID_MOMENT; })[0].context.notes);
  });

  it('takes a miss and a heart reading (no Body and Use) too', function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    var coins = res.newSessions.filter(function (x) { return x.session_id === ID_COINS; })[0];
    var heart = res.newSessions.filter(function (x) { return x.session_id === ID_HEART; })[0];
    assertEqual(coins.source_data.mirror.status, 'miss');
    assertEqual(coins.source_data.question, '');
    assertEqual(heart.source_data.method, 'heart-yarrow');
    assertEqual(heart.source_data.verdict, null);
    assertEqual(heart.source_data.mirror.note, 'Quiet and steady, as it said.');
  });

  it('keeps nothing private: no decoy, no place, no birth mansions, no heartbeats', function () {
    freshEnv();
    var res = DivinationImport.importDivinationFile(FIRST);
    var text = JSON.stringify(res.newSessions);
    assert(text.indexOf('decoy') === -1, 'no decoy');
    assert(text.indexOf('birthMansions') === -1, 'no birth mansions');
    assert(text.indexOf('"lat"') === -1 && text.indexOf('"lon"') === -1, 'no place');
    assert(text.indexOf('rrTicks') === -1, 'no heartbeats');
  });

  it('gives each saved reading a History line like the RCT hexagrams', function () {
    freshEnv();
    importAndCommit(FIRST);
    var lines = TaggerStore.getIndex().sessions.map(function (s) { return s.summary_line; });
    assertEqual(lines.length, 3);
    assert(lines.indexOf('☷ #36 Darkening of the Light → #24 Return · Mirror hit · “Should we build the web prototype first?”') !== -1, lines.join(' | '));
    assert(lines.indexOf('☷ #29 The Abysmal · Mirror miss') !== -1, lines.join(' | '));
  });
});

describe('importDivinationFile — malformed files', function () {

  it('refuses text that is not JSON', function () {
    var res = DivinationImport.importDivinationFile('{ not json');
    assertEqual(res.status, 'error');
    assert(res.error.indexOf("couldn't be read as JSON") !== -1);
  });

  it('refuses another format with a pointer to the right export', function () {
    var res = DivinationImport.importDivinationFile(JSON.stringify({ export_type: 'something_else', sessions: [] }));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('Export for the Session Tagger') !== -1, res.error);
  });

  it('refuses a Divination journal backup, saying which export to use', function () {
    var res = DivinationImport.importDivinationFile(JSON.stringify({ app: 'aetheria-divination', kind: 'journal', version: 1, entries: [] }));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('journal backup') !== -1 && res.error.indexOf('Export for the Session Tagger') !== -1, res.error);
  });

  it('refuses a newer schema or export version', function () {
    var a = firstObj(); a.schema_version = '3.0';
    var b = firstObj(); b.aetheria_export_version = '2.0';
    [a, b].forEach(function (o) {
      var res = DivinationImport.importDivinationFile(JSON.stringify(o));
      assertEqual(res.status, 'error');
      assert(res.error.indexOf('newer format') !== -1, res.error);
    });
  });

  it('refuses an envelope with no readings list, or an empty one', function () {
    var a = firstObj(); delete a.sessions;
    var b = firstObj(); b.sessions = {};
    var c = firstObj(); c.sessions = [];
    assert(DivinationImport.importDivinationFile(JSON.stringify(a)).error.indexOf('no readings list') !== -1);
    assert(DivinationImport.importDivinationFile(JSON.stringify(b)).error.indexOf('no readings list') !== -1);
    assert(DivinationImport.importDivinationFile(JSON.stringify(c)).error.indexOf('Honest Mirror') !== -1);
  });

  it('refuses a file whose readings all fail, naming the first problem', function () {
    var obj = firstObj();
    obj.sessions = [null, 7, 'x'];
    var res = DivinationImport.importDivinationFile(JSON.stringify(obj));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('None of the 3 readings') !== -1 && res.error.indexOf('not an object') !== -1, res.error);
  });

  it('skips a reading not answered in the Honest Mirror (pending, left out, or inconsistent)', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.mirror; })), 'not answered in the Honest Mirror');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.mirror.status = 'skipped'; s.source_data.mirror.picked_real = null; })), 'not answered in the Honest Mirror');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.mirror.picked_real = false; })), 'not answered in the Honest Mirror');
  });

  it('skips a reading whose id is unsafe or does not match its reading', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'divination_x\');alert(1);//'; })), 'session_id is missing or malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'rct_2026-04-05T01-43-11-083Z'; })), 'session_id is missing or malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.reading_id = 'someone-else'; })), 'session_id does not match reading_id');
  });

  it('skips a reading with an impossible date, the wrong source or no context', function () {
    freshEnv();
    assertEqual(skipReason(withSession(1, function (s) { s.session_date = '2026-02-30'; })), 'session_date must be a real YYYY-MM-DD date');
    assertEqual(skipReason(withSession(1, function (s) { s.source = 'manual'; })), 'source must be "divination"');
    assertEqual(skipReason(withSession(1, function (s) { s.context = 'none'; })), 'context must be an object');
    assertEqual(skipReason(withSession(1, function (s) { s.source_data = []; })), 'source_data must be an object');
  });

  it('skips a reading whose cast does not agree with itself', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.cast.moving_lines = [4]; })), 'cast is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.cast.line_values[0] = 5; })), 'cast is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.cast.present = 65; })), 'cast is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.cast.changed = 36; })), 'cast is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.cast.bits = '111111'; })), 'cast is malformed');
  });

  it('skips a reading whose hexagrams or tones do not match the cast', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.hexagrams.present.hexagram = 1; })), 'hexagrams do not match the cast');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.journey[2].hexagram = 1; })), 'journey is missing or malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.journey[0].frequency_hz = 'loud'; })), 'journey is missing or malformed');
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.journey; })), 'journey is missing or malformed');
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.map_version; })), 'map_version is missing');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.asked_at = 'yesterday'; })), 'asked_at is missing');
  });

  it('drops bad optional fields but keeps the reading', function () {
    freshEnv();
    var text = withSession(0, function (s) {
      s.context.moon = 'Blood Moon';
      s.context.dominant_regime = 'HEART';
      s.context.coherence_score = 99;
      s.context.sleep = -4;
      s.source_data.sky.mansion = 99;
      s.source_data.sky.tide = 'high';
      s.source_data.verdict = { body: 'fire', use: 'water' };
      s.source_data.inputs = { utcMs: 1, lat: 43.1, lon: -115.7, rrTicks: [800, 810], nested: { a: 1 }, '__proto__': { polluted: true } };
      s.raw_import.decoy = { present: 1 };
      s.raw_import.birthMansions = [26];
      s.raw_import.inputs.lat = 43.1;
    });
    var res = DivinationImport.importDivinationFile(text);
    assertEqual(res.skippedCount, 0);
    var r = res.newSessions.filter(function (x) { return x.session_id === ID_MOMENT; })[0];
    assertEqual(r.context.moon, 'unknown');
    assertEqual(r.context.dominant_regime, '', 'protocol fields stay empty');
    assertEqual(r.context.coherence_score, null, 'protocol fields stay empty');
    assertEqual(r.context.sleep, null);
    assertEqual(r.source_data.sky.mansion, null);
    assertEqual(r.source_data.sky.mansion_name, 'Uttara Phalguni', 'the rest of the sky stays');
    assertEqual(r.source_data.sky.tide, null);
    assertEqual(r.source_data.verdict, null);
    assertEqual(JSON.stringify(r.source_data.inputs), '{"utcMs":1}');
    assert(!('decoy' in r.raw_import) && !('birthMansions' in r.raw_import) && !('lat' in r.raw_import.inputs), 'raw import stripped');
    assertEqual(({}).polluted, undefined, 'no prototype pollution');
  });

  it('keeps hostile text as plain text, without control characters, and cuts overlong notes', function () {
    freshEnv();
    var text = withSession(1, function (s) {
      s.context.notes = '<img src=x onerror=alert(1)>\u0000\u0007ok\n' + new Array(30001).join('n');
      s.source_data.question = '<script>alert(1)</script>';
    });
    var r = DivinationImport.importDivinationFile(text).newSessions.filter(function (x) { return x.session_id === ID_COINS; })[0];
    assertEqual(r.context.notes.indexOf('<img src=x onerror=alert(1)>ok\n'), 0, 'kept as text; the UI escapes it');
    assertEqual(r.context.notes.length, 20000);
    assertEqual(r.source_data.question, '<script>alert(1)</script>');
  });

  it('counts a reading repeated in the file once, keeping the latest Mirror answer', function () {
    freshEnv();
    var obj = firstObj();
    var copy = JSON.parse(JSON.stringify(obj.sessions[1]));
    copy.source_data.mirror.answered_at = '2026-09-30T00:00:00.000Z';
    copy.source_data.mirror.note = 'Second look.';
    obj.sessions.push(copy);
    var res = DivinationImport.importDivinationFile(JSON.stringify(obj));
    assertEqual(res.totalCount, 3);
    assertEqual(res.repeatedCount, 1);
    var r = res.newSessions.filter(function (x) { return x.session_id === ID_COINS; })[0];
    assertEqual(r.source_data.mirror.note, 'Second look.');
  });
});

describe('re-import — merge, never duplicate', function () {

  it('importing the same file twice changes nothing', function () {
    freshEnv();
    importAndCommit(FIRST);
    var again = importAndCommit(FIRST);
    assertEqual(again.res.newCount, 0);
    assertEqual(again.res.updatedCount, 0);
    assertEqual(again.res.unchangedCount, 3);
    assertEqual(again.saved.imported.length + again.saved.updated.length, 0);
    assertEqual(TaggerStore.listAllSessions().length, 3);
  });

  it('a later export adds the newly answered reading and updates the one whose Mirror changed', function () {
    freshEnv();
    importAndCommit(FIRST);
    var later = importAndCommit(LATER);
    assertEqual(later.res.newCount, 1, 'the Question reading');
    assertEqual(later.res.updatedCount, 1, 'the Moment reading');
    assertEqual(later.res.unchangedCount, 2);
    assertEqual(later.saved.imported[0].session_id, ID_QUEST);
    assertEqual(later.saved.updated[0].session_id, ID_MOMENT);
    assertEqual(TaggerStore.listAllSessions().length, 4, 'no duplicates');
    var ids = TaggerStore.getIndex().sessions.map(function (s) { return s.session_id; }).sort();
    assertEqual(ids.join(','), [ID_COINS, ID_HEART, ID_MOMENT, ID_QUEST].sort().join(','));
    var m = TaggerStore.loadSession(ID_MOMENT);
    assertEqual(m.source_data.mirror.note, 'We waited, and it came right.');
    assert(m.context.notes.indexOf('Note: We waited, and it came right.') !== -1, 'Mirror note merged into the notes');
  });

  it('keeps everything the person typed in the Tagger', function () {
    freshEnv();
    importAndCommit(FIRST);
    var before = TaggerStore.loadSession(ID_MOMENT);
    var firstImportedAt = before.imported_at;
    before.context.notes += '\nFelt calm after.';
    before.context.condition = 'Silent';
    before.context.mood_before = 4;
    before.context.mood_after = 7;
    before.context.mood_change = 3;
    before.context.moon = '\u{1F312} Waxing Crescent';
    before.context.walk_type = 'Pillar Walk';
    before.session_date = '2026-09-12';
    TaggerStore.saveSession(before);

    importAndCommit(LATER);
    var after = TaggerStore.loadSession(ID_MOMENT);
    assertEqual(after.context.condition, 'Silent');
    assertEqual(after.context.mood_before, 4);
    assertEqual(after.context.mood_after, 7);
    assertEqual(after.context.mood_change, 3);
    assertEqual(after.context.moon, '\u{1F312} Waxing Crescent', "the person's Moon wins");
    assertEqual(after.context.walk_type, 'Pillar Walk');
    assertEqual(after.session_date, '2026-09-12', "the person's date wins");
    assertEqual(after.imported_at, firstImportedAt, 'first import time kept');
    assertEqual(after.context.notes,
      'Question: “Should we build the web prototype first?”\n' +
      'The Moment: 36 Darkening of the Light → 24 Return.\n' +
      'Honest Mirror: the reading fit what happened.\n' +
      'Note: We waited, and it came right.\n' +
      'Felt calm after.');
  });

  it("keeps notes the person rewrote, adding only Divination's new lines", function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_MOMENT);
    rec.context.notes = 'My own words about this one.';
    TaggerStore.saveSession(rec);
    importAndCommit(LATER);
    assertEqual(TaggerStore.loadSession(ID_MOMENT).context.notes,
      'My own words about this one.\n\nNote: We waited, and it came right.');
    // and a third import of the same file leaves them alone
    var third = importAndCommit(LATER);
    assertEqual(third.res.updatedCount, 0);
    assertEqual(TaggerStore.loadSession(ID_MOMENT).context.notes,
      'My own words about this one.\n\nNote: We waited, and it came right.');
  });

  it('keeps notes the person cleared clear when the same file is imported again', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_MOMENT);
    rec.context.notes = '';
    TaggerStore.saveSession(rec);
    var again = importAndCommit(FIRST);
    assertEqual(again.res.updatedCount, 0, 'nothing to update');
    assertEqual(again.res.unchangedCount, 3, 'Nothing new to import');
    assertEqual(again.saved.updated.length, 0);
    assertEqual(TaggerStore.loadSession(ID_MOMENT).context.notes, '', 'the question does not come back');
  });

  it('adds only the new Mirror note to notes the person cleared', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_MOMENT);
    rec.context.notes = '';
    TaggerStore.saveSession(rec);
    var later = importAndCommit(LATER);
    assertEqual(later.res.updatedCount, 1, 'the Moment reading has a new Mirror note');
    var notes = TaggerStore.loadSession(ID_MOMENT).context.notes;
    assertEqual(notes, 'Note: We waited, and it came right.');
    assert(notes.indexOf('Question:') === -1, 'the question does not come back');
    var third = importAndCommit(LATER);
    assertEqual(third.res.updatedCount, 0, 'and a third import leaves them alone');
    assertEqual(TaggerStore.loadSession(ID_MOMENT).context.notes, 'Note: We waited, and it came right.');
  });

  it('merges a Mirror answer into a record that had none', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_COINS);
    delete rec.source_data.mirror;
    delete rec.source_data.as_imported;
    rec.context.notes = 'Coins, before the Mirror.';
    TaggerStore.saveSession(rec);
    var res = importAndCommit(FIRST);
    assertEqual(res.res.updatedCount, 1);
    var after = TaggerStore.loadSession(ID_COINS);
    assertEqual(after.source_data.mirror.status, 'miss');
    assert(after.context.notes.indexOf('Coins, before the Mirror.') === 0, 'their words first');
    assert(after.context.notes.indexOf('Honest Mirror: the other reading fit better.') !== -1, 'Mirror answer added');
    assertEqual(TaggerStore.listAllSessions().length, 3);
  });

  it("never overwrites another source's session that shares the id", function () {
    freshEnv();
    TaggerStore.saveSession({
      schema_version: '2.0', session_id: ID_COINS, source: 'manual',
      imported_at: '2026-09-01T00:00:00.000Z', last_edited_at: '2026-09-01T00:00:00.000Z', session_date: '2026-09-01',
      context: { condition: '', moon: 'unknown', sleep: null, mood_before: null, mood_after: null, mood_change: null, pain: null, activity: '', notes: 'mine' },
      source_data: { description: 'A manual session' }, raw_import: null
    });
    var r = importAndCommit(FIRST);
    assertEqual(r.res.newCount, 2);
    assertEqual(r.res.skippedCount, 1);
    assert(r.res.skipped[0].reason.indexOf('manual') !== -1, r.res.skipped[0].reason);
    assertEqual(TaggerStore.loadSession(ID_COINS).source, 'manual');
    assertEqual(TaggerStore.loadSession(ID_COINS).context.notes, 'mine');
  });

  it('mergeNotes: the cases', function () {
    var N = DivinationImport.mergeNotes;
    assertEqual(N('', null, 'new'), 'new', 'empty, no record of the last import: takes the import');
    assertEqual(N('', '', 'new'), 'new', 'empty, and the last import wrote nothing: takes the import');
    assertEqual(N('', 'old', 'old'), '', 'cleared by the person: stays clear');
    assertEqual(N('  \n', 'old', 'old'), '  \n', 'cleared to whitespace: left alone');
    assertEqual(N('', 'old', 'old\nnew'), 'new', 'cleared: only newly written lines, no leading blank lines');
    assertEqual(N('\n\n', 'old', 'old\nnew'), 'new', 'cleared to blank lines: only newly written lines');
    assertEqual(N('old', 'old', 'new'), 'new', 'untouched takes the import');
    assertEqual(N('old\nmine', 'old', 'new'), 'new\nmine', 'additions kept around the new block');
    assertEqual(N('mine', 'a\nb', 'a\nb\nc'), 'mine\n\nc', 'rewritten: only new lines added');
    assertEqual(N('mine', null, 'x\ny'), 'mine\n\nx\ny', 'no record of the last import: missing lines added');
    assertEqual(N('mine\nx\ny', null, 'x\ny'), 'mine\nx\ny', 'nothing missing, nothing added');
    assertEqual(N('a $& b', 'a $& b', 'c $1 d'), 'c $1 d', 'replacement text taken literally');
  });
});

describe("the Tagger's own export of an imported reading", function () {

  it('Full JSON carries the whole record, and nothing private', function () {
    freshEnv();
    importAndCommit(LATER);
    var all = TaggerStore.listAllSessions();
    var parsed = JSON.parse(TaggerExport.exportFullJSON(all));
    assertEqual(parsed.session_count, 4);
    var m = parsed.sessions.filter(function (s) { return s.session_id === ID_MOMENT; })[0];
    assertEqual(JSON.stringify(m), JSON.stringify(TaggerStore.loadSession(ID_MOMENT)), 'round-trips intact');
    assert(TaggerStore.validateRecord(m).valid, 'still a valid record');
    var text = JSON.stringify(parsed);
    assert(text.indexOf('decoy') === -1 && text.indexOf('birthMansions') === -1, 'nothing private');
  });

  it('Unified CSV gives each reading a row with its context and Divination columns', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rows = parseCsv(TaggerExport.exportUnifiedCSV(TaggerStore.listAllSessions()));
    var header = rows[0];
    assertEqual(rows.length, 4, 'header + 3 readings');
    var cols = rows.filter(function (r) { return r[0] === ID_COINS; })[0];
    assert(cols, 'coins row present');
    assertEqual(cols.length, header.length, 'full row');
    assertEqual(cols[header.indexOf('source')], 'divination');
    assertEqual(cols[header.indexOf('moon')], '\u{1F312} Waxing Crescent');
    assertEqual(cols[header.indexOf('div_present')], '29');
    assertEqual(cols[header.indexOf('div_present_name')], 'The Abysmal');
    assertEqual(cols[header.indexOf('div_mirror')], 'miss');
    assertEqual(cols[header.indexOf('lab_peak_tcs')], '', 'other sources stay empty');
  });

  it('the Divination CSV has one row per reading', function () {
    freshEnv();
    importAndCommit(LATER);
    var all = TaggerStore.listAllSessions().filter(function (r) { return r.source === 'divination'; });
    var rows = parseCsv(TaggerExport.exportDivinationCSV(all));
    assertEqual(rows.length, 5, 'header + 4 readings');
    var header = rows[0];
    var row = rows.filter(function (r) { return r[0] === ID_MOMENT; })[0];
    assertEqual(row.length, header.length, 'full row');
    assertEqual(row[header.indexOf('present_name')], 'Darkening of the Light');
    assertEqual(row[header.indexOf('journey_hz')], '2178;396;639');
    assertEqual(row[header.indexOf('mirror')], 'hit');
    assertEqual(row[header.indexOf('mirror_note')], 'We waited, and it came right.');
    assert(row[header.indexOf('map_version')], 'map version');
    assert(row[header.indexOf('notes')].indexOf('Honest Mirror:') !== -1, 'notes survive the CSV');
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
