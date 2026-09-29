// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Field Lens Import Tests
// Run:  node src/import/field-lens-import.test.js
//
// fixtures/field-lens-export.json and field-lens-export-later.json
// were made by Aetheria Field Lens's own exporter
// (FieldLens/scripts/core/tagger_export.gd, Session.to_tagger):
//   first export — three sessions: 12 min from the strap's ECG with
//     no note (peak coherence 0.62, so coherence_score 62), 7 min
//     from the strap's rate only with the note "Couch, lights low.",
//     and a 2 min demo (made-up heartbeats, exported on request);
//   later export — the 12 min session again, now with a note, the
//     7 min one unchanged, and a new 15 min session; no demo.
// If Field Lens's export changes, regenerate them the same way.
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
var FieldLensImport = require('./field-lens-import');
var TaggerExport = require('../export/tagger-export');

function freshEnv() {
  TaggerStore._setStorage();
}

// ─── Test data ──────────────────────────────────────────────────

var FIRST = fs.readFileSync(path.join(__dirname, 'fixtures', 'field-lens-export.json'), 'utf8');
var LATER = fs.readFileSync(path.join(__dirname, 'fixtures', 'field-lens-export-later.json'), 'utf8');

var ID_ECG  = 'field_lens_5b1e7f2c-8d3a-4c6e-9f10-2a3b4c5d6e7f';   // 12 min, strap ECG
var ID_RATE = 'field_lens_9c4d2e1f-7a6b-4b5c-8d9e-0f1a2b3c4d5e';   // 7 min, strap rate, a note
var ID_DEMO = 'field_lens_1a2b3c4d-0000-4000-8000-00000000de00';   // 2 min demo
var ID_NEW  = 'field_lens_e7f60a1b-2c3d-4e5f-a6b7-c8d9e0f1a2b3';   // 15 min, later export only

var LATE_NOTE = 'Late night sit; the room was quiet.';

function firstObj() { return JSON.parse(FIRST); }
function laterObj() { return JSON.parse(LATER); }

// Import a file and save what it found, the way the UI does.
function importAndCommit(text) {
  var res = FieldLensImport.importFieldLensFile(text);
  if (res.status !== 'ok') throw new Error('import failed: ' + res.error);
  var saved = FieldLensImport.commitFieldLensImport(res);
  return { res: res, saved: saved };
}

// The first export with one session changed by fn (for malformed cases).
function withSession(index, fn) {
  var obj = firstObj();
  fn(obj.sessions[index], obj);
  return JSON.stringify(obj);
}

function byId(list, id) {
  return list.filter(function (x) { return x.session_id === id; })[0];
}

// Several exports chosen together, combined the way index.html does.
function combine(texts) {
  var env = Object.assign({}, JSON.parse(texts[0]), {
    sessions: [].concat.apply([], texts.map(function (t) { return JSON.parse(t).sessions; }))
  });
  env.session_count = env.sessions.length;
  return JSON.stringify(env);
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
  var res = FieldLensImport.importFieldLensFile(text);
  assertEqual(res.status, 'ok', 'the other sessions still import');
  assertEqual(res.skippedCount, 1, 'one session skipped');
  return res.skipped[0].reason;
}

// ═══════════════════════════════════════════════════════════════

describe('detectFieldLensFormat', function () {

  it('recognises a Field Lens Tagger export', function () {
    assertEqual(FieldLensImport.detectFieldLensFormat(firstObj()), 'tagger_export');
  });

  it("ignores the other apps' formats and the Tagger's own Full JSON", function () {
    var lab = { aetheria_export_version: '1.0', export_type: 'session_summary_for_tagger', metadata: { sessionId: 'x' } };
    var rct = { system: 'Aetheria Resonant Coherence Training', sessions: [], frequencies: [] };
    var sophia = { exportVersion: 2, device: 'MuseS', deviceType: 'athena', timeline: [] };
    var div = { aetheria_export_version: '1.0', export_type: 'divination_for_tagger', app: 'aetheria-divination', schema_version: '2.0', sessions: [] };
    var full = JSON.parse(TaggerExport.exportFullJSON([]));
    [lab, rct, sophia, div, full, null, [], 'text', 42].forEach(function (o) {
      assertEqual(FieldLensImport.detectFieldLensFormat(o), null, JSON.stringify(o));
    });
  });
});

describe('validateFieldLensExport — the envelope', function () {

  it('accepts the real export', function () {
    var v = FieldLensImport.validateFieldLensExport(firstObj());
    assert(v.valid, v.errors.join(', '));
  });

  it('names what is wrong with a bad envelope', function () {
    var V = FieldLensImport.validateFieldLensExport;
    var a = firstObj(); a.export_type = 'divination_for_tagger';
    var b = firstObj(); b.aetheria_export_version = '2.0';
    var c = firstObj(); c.schema_version = '1.0';
    var d = firstObj(); d.app = 'aetheria-divination';
    var e = firstObj(); e.sessions = 'none';
    var f = firstObj(); f.sessions = [];
    var g = firstObj(); g.sessions = new Array(10001);
    assertEqual(V(a).errors[0], 'wrong_export_type');
    assertEqual(V(b).errors[0], 'unsupported_export_version');
    assertEqual(V(c).errors[0], 'unsupported_schema_version');
    assertEqual(V(d).errors[0], 'wrong_app');
    assertEqual(V(e).errors[0], 'missing_sessions');
    assertEqual(V(f).errors[0], 'no_sessions');
    assertEqual(V(g).errors[0], 'too_many_sessions');
    assertEqual(V(null).errors[0], 'wrong_export_type');
  });
});

describe('importFieldLensFile — a real Field Lens export', function () {

  it('finds the three sessions, all new, one of them a demo', function () {
    freshEnv();
    var res = FieldLensImport.importFieldLensFile(FIRST);
    assertEqual(res.status, 'ok');
    assertEqual(res.totalCount, 3);
    assertEqual(res.newCount, 3);
    assertEqual(res.updatedCount, 0);
    assertEqual(res.unchangedCount, 0);
    assertEqual(res.skippedCount, 0);
    assertEqual(res.demoCount, 1);
    assertEqual(res.exportDate, '2026-09-29T19:00:00.000Z');
    assertEqual(res.newSessions.map(function (r) { return r.session_id; }).join(','), [ID_ECG, ID_RATE, ID_DEMO].join(','));
  });

  it("makes records that pass the Tagger's own validation", function () {
    freshEnv();
    var res = FieldLensImport.importFieldLensFile(FIRST);
    res.newSessions.forEach(function (r) {
      var v = TaggerStore.validateRecord(r);
      assert(v.valid, r.session_id + ': ' + v.errors.join(', '));
      assertEqual(r.source, 'field_lens');
      assertEqual(r.schema_version, '2.0');
      assertEqual(r.raw_import, null);
    });
  });

  it("takes the date, duration, peak coherence and note, and the Tagger's defaults for the rest", function () {
    freshEnv();
    var res = FieldLensImport.importFieldLensFile(FIRST);
    var ecg = byId(res.newSessions, ID_ECG);
    var rate = byId(res.newSessions, ID_RATE);
    var demo = byId(res.newSessions, ID_DEMO);
    assertEqual(ecg.session_date, '2026-09-27', "the phone's own date where it started");
    assertEqual(ecg.context.coherence_score, 62);
    assertEqual(ecg.context.duration_minutes, 12);
    assertEqual(ecg.context.notes, '');
    assertEqual(rate.session_date, '2026-09-29');
    assertEqual(rate.context.coherence_score, 40);
    assertEqual(rate.context.duration_minutes, 7);
    assertEqual(rate.context.notes, 'Couch, lights low.');
    assertEqual(demo.context.duration_minutes, 2);
    assertEqual(ecg.context.moon, 'unknown', "the file's empty moon becomes the Tagger's default");
    assertEqual(ecg.context.condition, '');
    assertEqual(ecg.context.walk_type, '');
    assertEqual(ecg.context.dominant_regime, '');
    assertEqual(ecg.context.classification, '');
    ['sleep', 'mood_before', 'mood_after', 'mood_change', 'pain'].forEach(function (k) {
      assertEqual(ecg.context[k], null, k);
    });
    assertEqual(Object.keys(ecg.context).length, 14, 'all 14 context keys');
  });

  it('marks the demo as a demo, and only the demo', function () {
    freshEnv();
    var res = FieldLensImport.importFieldLensFile(FIRST);
    var demo = byId(res.newSessions, ID_DEMO);
    assertEqual(demo.source_data.demo, true);
    assertEqual(demo.source_data.heartbeat_source, 'demo');
    assert(FieldLensImport.isDemo(demo), 'isDemo');
    assertEqual(byId(res.newSessions, ID_ECG).source_data.demo, false);
    assertEqual(byId(res.newSessions, ID_RATE).source_data.heartbeat_source, 'strap_rate');
    assert(!FieldLensImport.isDemo(byId(res.newSessions, ID_RATE)), 'the strap-rate session is real');
  });

  it('keeps the summary and every array, as the file has them', function () {
    freshEnv();
    var file = byId(firstObj().sessions, ID_ECG).source_data;
    var sd = byId(FieldLensImport.importFieldLensFile(FIRST).newSessions, ID_ECG).source_data;
    assertEqual(Object.keys(sd.summary).length, Object.keys(file.summary).length, 'summary keys');
    Object.keys(file.summary).forEach(function (k) {
      assertEqual(sd.summary[k], file.summary[k], 'summary.' + k);
    });
    ['t', 'hr', 'coherence', 'breath', 'room_ut', 'held', 'still', 'rr_ms', 'rr_t', 'ecg_uv'].forEach(function (k) {
      assertEqual(JSON.stringify(sd[k]), JSON.stringify(file[k]), k);
    });
    assertEqual(sd.t.length, 720);
    assertEqual(sd.rr_ms.length, 769);
    assertEqual(sd.summary.peak_coherence, 0.62);
    assertEqual(sd.summary.mean_room_ut, 47.5);
    assertEqual(sd.started_at, '2026-09-28T03:10:00.000Z');
    assertEqual(sd.ended_at, '2026-09-28T03:22:00.000Z');
    assertEqual(sd.utc_offset_minutes, -360);
    assertEqual(sd.entry_version, 1);
    assertEqual(sd.app, 'aetheria-field-lens');
    assertEqual(sd.description, '12 min · peak coherence 0.62 · 64 bpm · strap ECG');
    assertEqual(sd.ecg_dropped, false);
    assertEqual(sd.as_imported.session_date, '2026-09-27');
    assertEqual(sd.as_imported.context.coherence_score, 62);
  });

  it('gives each saved session a History line, the demo marked first', function () {
    freshEnv();
    importAndCommit(FIRST);
    var lines = {};
    TaggerStore.getIndex().sessions.forEach(function (s) { lines[s.session_id] = s.summary_line; });
    assertEqual(lines[ID_ECG], '12 min · Peak coherence 0.62 · 64 bpm · strap ECG');
    assertEqual(lines[ID_RATE], '7 min · Peak coherence 0.40 · 64 bpm · strap rate');
    assertEqual(lines[ID_DEMO], '(demo) · 2 min · Peak coherence 0.19 · 64 bpm · demo heartbeat', 'peak 0.185 rounds as Field Lens rounds it');
  });
});

describe('importFieldLensFile — malformed files', function () {

  it('refuses text that is not JSON', function () {
    var res = FieldLensImport.importFieldLensFile('{ not json');
    assertEqual(res.status, 'error');
    assert(res.error.indexOf("couldn't be read as JSON") !== -1);
  });

  it('refuses another format with a pointer to the right export', function () {
    var res = FieldLensImport.importFieldLensFile(JSON.stringify({ export_type: 'something_else', sessions: [] }));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('Export for the Session Tagger') !== -1, res.error);
  });

  it('refuses a newer schema or export version', function () {
    var a = firstObj(); a.schema_version = '3.0';
    var b = firstObj(); b.aetheria_export_version = '2.0';
    [a, b].forEach(function (o) {
      var res = FieldLensImport.importFieldLensFile(JSON.stringify(o));
      assertEqual(res.status, 'error');
      assert(res.error.indexOf('newer format') !== -1, res.error);
    });
  });

  it('refuses a file that says it comes from another app', function () {
    var a = firstObj(); a.app = 'aetheria-divination';
    var res = FieldLensImport.importFieldLensFile(JSON.stringify(a));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('another app') !== -1, res.error);
  });

  it('refuses an envelope with no sessions list, an empty one, or too many', function () {
    var a = firstObj(); delete a.sessions;
    var b = firstObj(); b.sessions = {};
    var c = firstObj(); c.sessions = [];
    var d = firstObj(); d.sessions = new Array(10001).fill(null);
    assert(FieldLensImport.importFieldLensFile(JSON.stringify(a)).error.indexOf('no sessions list') !== -1);
    assert(FieldLensImport.importFieldLensFile(JSON.stringify(b)).error.indexOf('no sessions list') !== -1);
    assert(FieldLensImport.importFieldLensFile(JSON.stringify(c)).error.indexOf('holds no sessions') !== -1);
    assert(FieldLensImport.importFieldLensFile(JSON.stringify(d)).error.indexOf('more than 10000') !== -1);
  });

  it('refuses a file whose sessions all fail, naming the first problem', function () {
    var obj = firstObj();
    obj.sessions = [null, 7, 'x'];
    var res = FieldLensImport.importFieldLensFile(JSON.stringify(obj));
    assertEqual(res.status, 'error');
    assert(res.error.indexOf('None of the 3 sessions') !== -1 && res.error.indexOf('not an object') !== -1, res.error);
  });

  it('skips a session whose id is unsafe or not a Field Lens id', function () {
    freshEnv();
    var bad = 'session_id is missing or malformed';
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'field_lens_x\');alert(1);//'; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'field_lens_5B1E7F2C-8D3A-4C6E-9F10-2A3B4C5D6E7F'; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'field_lens_5b1e7f2c-8d3a-4c6e-9f10'; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { s.session_id = 'divination_b7d2c9e4-5a31-4f0e-9c6b-2e8a1d4f7a10'; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { delete s.session_id; })), bad);
  });

  it('skips a session with the wrong source or schema, an impossible date, or no context or data', function () {
    freshEnv();
    assertEqual(skipReason(withSession(1, function (s) { s.source = 'divination'; })), 'source must be "field_lens"');
    assertEqual(skipReason(withSession(1, function (s) { s.schema_version = '1.0'; })), 'schema_version must be "2.0"');
    assertEqual(skipReason(withSession(1, function (s) { s.session_date = '2026-02-30'; })), 'session_date must be a real YYYY-MM-DD date');
    assertEqual(skipReason(withSession(1, function (s) { s.session_date = '29/09/2026'; })), 'session_date must be a real YYYY-MM-DD date');
    assertEqual(skipReason(withSession(1, function (s) { s.context = 'none'; })), 'context must be an object');
    assertEqual(skipReason(withSession(1, function (s) { s.source_data = []; })), 'source_data must be an object');
  });

  it('skips a session with no start time, an unknown heartbeat, or a demo flag that disagrees', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.started_at = 'last night'; })), 'started_at is missing');
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.started_at; })), 'started_at is missing');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.heartbeat_source = 'aura'; })), 'heartbeat_source is missing or unknown');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.demo = true; })), 'demo does not match heartbeat_source');
    assertEqual(skipReason(withSession(2, function (s) { s.source_data.demo = false; })), 'demo does not match heartbeat_source');
    assertEqual(skipReason(withSession(2, function (s) { s.source_data.demo = 'yes'; })), 'demo does not match heartbeat_source');
  });

  it('skips a session whose per-second readings are uneven, not numbers, or out of range', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.hr.pop(); })), 'per-second hr is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.still.push(0.5); })), 'per-second still is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.coherence[10] = 'x'; })), 'per-second coherence is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.coherence[10] = 1.5; })), 'per-second coherence is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.coherence[10] = -0.5; })), 'per-second coherence is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.held[3] = 2; })), 'per-second held is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.room_ut[3] = -47; })), 'per-second room_ut is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.hr[3] = null; })), 'per-second hr is malformed');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.breath = {}; })), 'per-second breath is malformed');
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.t; })), 'the per-second readings are missing or too long');
  });

  it('skips a session holding more than a day of seconds', function () {
    freshEnv();
    var text = withSession(1, function (s) {
      var sd = s.source_data;
      var n = 86401;
      ['t', 'hr', 'coherence', 'breath', 'room_ut', 'held', 'still'].forEach(function (k) {
        sd[k] = new Array(n).fill(0);
      });
    });
    assertEqual(skipReason(text), 'the per-second readings are missing or too long');
  });

  it('skips a session whose heartbeats are uneven or not numbers', function () {
    freshEnv();
    var bad = 'the heartbeats (rr_ms, rr_t) are malformed';
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.rr_t.pop(); })), bad);
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.rr_ms[5] = '900'; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.rr_ms[5] = -1; })), bad);
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.rr_ms; })), bad);
  });

  it('skips a session whose summary is missing or out of range', function () {
    freshEnv();
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.summary; })), 'summary is missing');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.peak_coherence = 1.2; })), 'summary.peak_coherence is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.duration_seconds = -1; })), 'summary.duration_seconds is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.duration_seconds = 720.5; })), 'summary.duration_seconds is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.beats = 'many'; })), 'summary.beats is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.mean_hr = '64'; })), 'summary.mean_hr is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { delete s.source_data.summary.room_range_ut; })), 'summary.room_range_ut is missing or out of range');
    assertEqual(skipReason(withSession(0, function (s) { s.source_data.summary.coherent_seconds = 721; })), 'summary counts more seconds than the session holds');
  });

  it('takes a summary whose unknown numbers are null', function () {
    freshEnv();
    var text = withSession(0, function (s) {
      var sm = s.source_data.summary;
      sm.mean_hr = null; sm.mean_coherence = null; sm.peak_coherence = null;
      sm.mean_breaths_per_minute = null; sm.mean_room_ut = null; sm.mean_stillness = null;
      s.context.coherence_score = null;
    });
    var r = byId(FieldLensImport.importFieldLensFile(text).newSessions, ID_ECG);
    assertEqual(r.source_data.summary.peak_coherence, null);
    assertEqual(r.context.coherence_score, null);
    assertEqual(r.source_data.summary.duration_seconds, 720);
  });

  it('drops bad optional fields but keeps the session', function () {
    freshEnv();
    var text = withSession(0, function (s) {
      var sd = s.source_data;
      sd.description = { html: '<b>' };
      sd.entry_version = 0;
      sd.ended_at = 'later';
      sd.utc_offset_minutes = 5000;
      sd.ecg_uv = [12, 'x', 30];
      s.context.coherence_score = 150;
      s.context.duration_minutes = -3;
      s.context.dominant_regime = 'Heart';
      s.context.classification = 'Tuned';
      s.context.moon = '\u{1F315} Full';
      s.context.condition = 'Silent';
      s.context.mood_before = 5;
    });
    var res = FieldLensImport.importFieldLensFile(text);
    assertEqual(res.skippedCount, 0);
    var r = byId(res.newSessions, ID_ECG);
    assertEqual(r.source_data.description, '');
    assertEqual(r.source_data.entry_version, null);
    assertEqual(r.source_data.ended_at, null);
    assertEqual(r.source_data.utc_offset_minutes, null);
    assertEqual(r.source_data.ecg_uv.length, 0);
    assertEqual(r.source_data.ecg_dropped, true, 'an unreadable ECG is left out, and says so');
    assertEqual(r.context.coherence_score, null);
    assertEqual(r.context.duration_minutes, null);
    assertEqual(r.context.dominant_regime, '', "not one of the Tagger's regimes");
    assertEqual(r.context.classification, '', "not one of the Tagger's classifications");
    assertEqual(r.context.moon, 'unknown', "Field Lens doesn't set the moon");
    assertEqual(r.context.condition, '');
    assertEqual(r.context.mood_before, null);
    assertEqual(r.source_data.summary.beats, 769, 'the rest stays');
  });

  it("keeps a regime and classification that are the Tagger's own", function () {
    freshEnv();
    var text = withSession(0, function (s) {
      s.context.dominant_regime = 'HEART';
      s.context.classification = 'Harmonically Aligned';
    });
    var r = byId(FieldLensImport.importFieldLensFile(text).newSessions, ID_ECG);
    assertEqual(r.context.dominant_regime, 'HEART');
    assertEqual(r.context.classification, 'Harmonically Aligned');
  });

  it('drops an end time before the start', function () {
    freshEnv();
    var text = withSession(0, function (s) { s.source_data.ended_at = '2026-09-28T03:00:00Z'; });
    assertEqual(byId(FieldLensImport.importFieldLensFile(text).newSessions, ID_ECG).source_data.ended_at, null);
  });

  it('keeps a raw ECG up to an hour long, and leaves out a longer one', function () {
    freshEnv();
    var short = withSession(0, function (s) { s.source_data.ecg_uv = [-120, 0, 845, 8388607, -8388608]; });
    var r = byId(FieldLensImport.importFieldLensFile(short).newSessions, ID_ECG);
    assertEqual(r.source_data.ecg_uv.join(','), '-120,0,845,8388607,-8388608');
    assertEqual(r.source_data.ecg_dropped, false);
    var long = withSession(0, function (s) { s.source_data.ecg_uv = new Array(FieldLensImport.MAX_ECG + 1).fill(7); });
    r = byId(FieldLensImport.importFieldLensFile(long).newSessions, ID_ECG);
    assertEqual(r.source_data.ecg_uv.length, 0);
    assertEqual(r.source_data.ecg_dropped, true);
    assertEqual(r.source_data.t.length, 720, 'the session itself is kept');
    var frac = withSession(0, function (s) { s.source_data.ecg_uv = [1.5]; });
    assertEqual(byId(FieldLensImport.importFieldLensFile(frac).newSessions, ID_ECG).source_data.ecg_dropped, true, 'whole µV only');
  });

  it('drops unknown and unsafe keys at every level, with no prototype pollution', function () {
    freshEnv();
    var obj = firstObj();
    var s = obj.sessions[0];
    s.extra = 'x';
    s.raw_import = { secret: 1 };
    s.source_data.extra = 'x';
    s.source_data.note = 'dup';
    s.source_data.summary.extra = 3;
    s.context.extra = 'x';
    var text = JSON.stringify(obj)
      .replace('"source_data":{', '"source_data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},')
      .replace('"summary":{', '"summary":{"__proto__":{"polluted":true},')
      .replace('"context":{', '"context":{"__proto__":{"polluted":true},"prototype":1,');
    var r = byId(FieldLensImport.importFieldLensFile(text).newSessions, ID_ECG);
    assert(r, 'the session imports');
    var json = JSON.stringify(r);
    ['extra', 'secret', 'polluted', '__proto__', '"constructor"', '"prototype"', '"note"'].forEach(function (k) {
      assert(json.indexOf(k) === -1, k + ' kept');
    });
    assertEqual(r.raw_import, null);
    assertEqual(Object.keys(r.context).length, 14);
    assertEqual(Object.keys(r.source_data.summary).length, 11);
    assertEqual(({}).polluted, undefined, 'no prototype pollution');
    assertEqual(Object.prototype.hasOwnProperty.call(r.source_data, '__proto__'), false);
  });

  it('keeps hostile text as plain text, without control characters, and cuts overlong notes', function () {
    freshEnv();
    var text = withSession(1, function (s) {
      s.context.notes = '<img src=x onerror=alert(1)>\u0000\u0007ok\n' + new Array(30001).join('n');
      s.source_data.description = '<script>alert(1)</script>';
    });
    var r = byId(FieldLensImport.importFieldLensFile(text).newSessions, ID_RATE);
    assertEqual(r.context.notes.indexOf('<img src=x onerror=alert(1)>ok\n'), 0, 'kept as text; the UI escapes it');
    assertEqual(r.context.notes.length, 20000);
    assertEqual(r.source_data.description, '<script>alert(1)</script>');
  });

  it('counts a session repeated in the file once, keeping the copy from the newest export', function () {
    freshEnv();
    var obj = firstObj();
    var copy = JSON.parse(JSON.stringify(obj.sessions[1]));
    copy.last_edited_at = '2026-09-30T00:00:00Z';
    copy.context.notes = 'Second look.';
    obj.sessions.unshift(copy);
    var res = FieldLensImport.importFieldLensFile(JSON.stringify(obj));
    assertEqual(res.totalCount, 3);
    assertEqual(res.repeatedCount, 1);
    assertEqual(byId(res.newSessions, ID_RATE).context.notes, 'Second look.', 'newer copy wins wherever it sits');
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

  it("a later export updates the first session's note, leaves the second, and adds the new one", function () {
    freshEnv();
    importAndCommit(FIRST);
    var rateBefore = JSON.stringify(TaggerStore.loadSession(ID_RATE));
    var later = importAndCommit(LATER);
    assertEqual(later.res.newCount, 1, 'the 15 min session');
    assertEqual(later.res.updatedCount, 1, 'the 12 min session');
    assertEqual(later.res.unchangedCount, 1, 'the 7 min session');
    assertEqual(later.saved.imported[0].session_id, ID_NEW);
    assertEqual(later.saved.updated[0].session_id, ID_ECG);
    assertEqual(TaggerStore.listAllSessions().length, 4, 'no duplicates (the demo stays)');
    var ids = TaggerStore.getIndex().sessions.map(function (s) { return s.session_id; }).sort();
    assertEqual(ids.join(','), [ID_DEMO, ID_ECG, ID_NEW, ID_RATE].sort().join(','));
    assertEqual(TaggerStore.loadSession(ID_ECG).context.notes, LATE_NOTE);
    assertEqual(TaggerStore.loadSession(ID_ECG).source_data.as_imported.context.notes, LATE_NOTE);
    assertEqual(JSON.stringify(TaggerStore.loadSession(ID_RATE)), rateBefore, 'the 7 min session untouched');
    var nu = TaggerStore.loadSession(ID_NEW);
    assertEqual(nu.context.coherence_score, 78);
    assertEqual(nu.context.duration_minutes, 15);
    assertEqual(nu.context.notes, 'Floor, away from the desk.');
  });

  it('keeps everything the person changed in the Tagger', function () {
    freshEnv();
    importAndCommit(FIRST);
    var before = TaggerStore.loadSession(ID_ECG);
    var firstImportedAt = before.imported_at;
    before.context.notes = 'Felt warm hands.';
    before.context.condition = 'Silent';
    before.context.mood_before = 4;
    before.context.mood_after = 7;
    before.context.mood_change = 3;
    before.context.moon = '\u{1F312} Waxing Crescent';
    before.context.coherence_score = 70;
    before.context.dominant_regime = 'HEART';
    before.session_date = '2026-09-28';
    TaggerStore.saveSession(before);

    importAndCommit(LATER);
    var after = TaggerStore.loadSession(ID_ECG);
    assertEqual(after.context.notes, 'Felt warm hands.\n\n' + LATE_NOTE, "the person's words kept, Field Lens's new note added");
    assertEqual(after.context.condition, 'Silent');
    assertEqual(after.context.mood_before, 4);
    assertEqual(after.context.mood_after, 7);
    assertEqual(after.context.mood_change, 3);
    assertEqual(after.context.moon, '\u{1F312} Waxing Crescent');
    assertEqual(after.context.coherence_score, 70, "the person's score wins");
    assertEqual(after.context.dominant_regime, 'HEART');
    assertEqual(after.context.duration_minutes, 12, 'untouched: from the file');
    assertEqual(after.session_date, '2026-09-28', "the person's date wins");
    assertEqual(after.imported_at, firstImportedAt, 'first import time kept');
    assertEqual(TaggerStore.listAllSessions().length, 4);
  });

  it('a note the person changed survives a re-import, and a third import leaves it alone', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_RATE);
    rec.context.notes = 'Couch, lights low. Felt calm after.';
    TaggerStore.saveSession(rec);
    var later = importAndCommit(LATER);
    assertEqual(later.res.unchangedCount, 1, 'nothing new for it');
    assertEqual(TaggerStore.loadSession(ID_RATE).context.notes, 'Couch, lights low. Felt calm after.');
    rec = TaggerStore.loadSession(ID_RATE);
    rec.context.notes = 'My own words.';
    TaggerStore.saveSession(rec);
    importAndCommit(LATER);
    assertEqual(TaggerStore.loadSession(ID_RATE).context.notes, 'My own words.', 'rewritten: kept');
  });

  it('keeps a note the person cleared clear when the same file is imported again', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rec = TaggerStore.loadSession(ID_RATE);
    rec.context.notes = '';
    TaggerStore.saveSession(rec);
    var again = importAndCommit(FIRST);
    assertEqual(again.res.updatedCount, 0);
    assertEqual(TaggerStore.loadSession(ID_RATE).context.notes, '', 'the note does not come back');
  });

  it("takes Field Lens's newer values where the person changed nothing", function () {
    freshEnv();
    importAndCommit(FIRST);
    var obj = laterObj();
    var s = byId(obj.sessions, ID_RATE);
    s.context.coherence_score = 41;
    s.source_data.summary.peak_coherence = 0.41;
    var res = importAndCommit(JSON.stringify(obj));
    assert(res.saved.updated.some(function (r) { return r.session_id === ID_RATE; }), 'updated');
    var r = TaggerStore.loadSession(ID_RATE);
    assertEqual(r.context.coherence_score, 41);
    assertEqual(r.source_data.summary.peak_coherence, 0.41);
    assertEqual(r.context.notes, 'Couch, lights low.');
  });

  it('several files chosen together import as one, the newest copy of each session winning', function () {
    [[FIRST, LATER], [LATER, FIRST]].forEach(function (pair, i) {
      freshEnv();
      var res = importAndCommit(combine(pair));
      assertEqual(res.res.newCount, 4, 'order ' + i);
      assertEqual(res.res.repeatedCount, 2, 'order ' + i);
      assertEqual(TaggerStore.listAllSessions().length, 4, 'order ' + i);
      assertEqual(TaggerStore.loadSession(ID_ECG).context.notes, LATE_NOTE, 'order ' + i);
    });
  });

  it("never overwrites another source's session that shares the id", function () {
    freshEnv();
    TaggerStore.saveSession({
      schema_version: '2.0', session_id: ID_RATE, source: 'manual',
      imported_at: '2026-09-01T00:00:00.000Z', last_edited_at: '2026-09-01T00:00:00.000Z', session_date: '2026-09-01',
      context: { condition: '', moon: 'unknown', sleep: null, mood_before: null, mood_after: null, mood_change: null, pain: null, activity: '', notes: 'mine' },
      source_data: { description: 'A manual session' }, raw_import: null
    });
    var r = importAndCommit(FIRST);
    assertEqual(r.res.newCount, 2);
    assertEqual(r.res.skippedCount, 1);
    assert(r.res.skipped[0].reason.indexOf('manual') !== -1, r.res.skipped[0].reason);
    assertEqual(TaggerStore.loadSession(ID_RATE).source, 'manual');
    assertEqual(TaggerStore.loadSession(ID_RATE).context.notes, 'mine');
  });

  it('mergeNotes: the cases', function () {
    var N = FieldLensImport.mergeNotes;
    assertEqual(N('', null, 'new'), 'new', 'empty, no record of the last import: takes the import');
    assertEqual(N('', '', 'new'), 'new', 'empty, and the last import wrote nothing: takes the import');
    assertEqual(N('', 'old', 'old'), '', 'cleared by the person: stays clear');
    assertEqual(N('old', 'old', 'new'), 'new', 'untouched takes the import');
    assertEqual(N('old\nmine', 'old', 'new'), 'new\nmine', 'additions kept around the new block');
    assertEqual(N('mine', '', 'new'), 'mine\n\nnew', 'written in the Tagger, then a note in Field Lens: both kept');
    assertEqual(N('mine', 'old', 'old'), 'mine', 'rewritten: nothing new to add');
    assertEqual(N('a $& b', 'a $& b', 'c $1 d'), 'c $1 d', 'replacement text taken literally');
  });
});

describe("the Tagger's own export of imported sessions", function () {

  it('Full JSON carries the whole record, arrays and all', function () {
    freshEnv();
    importAndCommit(FIRST);
    var all = TaggerStore.listAllSessions();
    var parsed = JSON.parse(TaggerExport.exportFullJSON(all));
    assertEqual(parsed.session_count, 3);
    var m = byId(parsed.sessions, ID_ECG);
    assertEqual(JSON.stringify(m), JSON.stringify(TaggerStore.loadSession(ID_ECG)), 'round-trips intact');
    assert(TaggerStore.validateRecord(m).valid, 'still a valid record');
    assertEqual(m.source_data.rr_ms.length, 769);
    assertEqual(m.source_data.coherence.length, 720);
  });

  it('Unified CSV gives each session a row with its context and Field Lens columns', function () {
    freshEnv();
    importAndCommit(FIRST);
    var rows = parseCsv(TaggerExport.exportUnifiedCSV(TaggerStore.listAllSessions()));
    var header = rows[0];
    assertEqual(rows.length, 4, 'header + 3 sessions');
    var ecg = rows.filter(function (r) { return r[0] === ID_ECG; })[0];
    var demo = rows.filter(function (r) { return r[0] === ID_DEMO; })[0];
    assertEqual(ecg.length, header.length, 'full row');
    assertEqual(ecg[header.indexOf('source')], 'field_lens');
    assertEqual(ecg[header.indexOf('coherence_score')], '62');
    assertEqual(ecg[header.indexOf('duration_minutes')], '12');
    assertEqual(ecg[header.indexOf('fl_heartbeat_source')], 'strap_ecg');
    assertEqual(ecg[header.indexOf('fl_demo')], 'false');
    assertEqual(ecg[header.indexOf('fl_peak_coherence')], '0.62');
    assertEqual(ecg[header.indexOf('fl_mean_room_ut')], '47.5');
    assertEqual(ecg[header.indexOf('fl_held_seconds')], '180');
    assertEqual(ecg[header.indexOf('div_present')], '', 'other sources stay empty');
    assertEqual(ecg[header.indexOf('lab_peak_tcs')], '', 'other sources stay empty');
    assertEqual(demo[header.indexOf('fl_demo')], 'true');
  });

  it('the Field Lens CSV has one row per session, the demo marked', function () {
    freshEnv();
    importAndCommit(FIRST);
    importAndCommit(LATER);
    var all = TaggerStore.listAllSessions().filter(function (r) { return r.source === 'field_lens'; });
    var rows = parseCsv(TaggerExport.exportFieldLensCSV(all));
    assertEqual(rows.length, 5, 'header + 4 sessions');
    var header = rows[0];
    var row = rows.filter(function (r) { return r[0] === ID_ECG; })[0];
    assertEqual(row.length, header.length, 'full row');
    assertEqual(row[header.indexOf('notes')], LATE_NOTE, 'notes survive the CSV');
    assertEqual(row[header.indexOf('peak_coherence')], '0.62');
    assertEqual(row[header.indexOf('beats')], '769');
    assertEqual(row[header.indexOf('seconds_recorded')], '720');
    assertEqual(row[header.indexOf('ecg_samples')], '0');
    assertEqual(row[header.indexOf('started_at')], '2026-09-28T03:10:00.000Z');
    var demo = rows.filter(function (r) { return r[0] === ID_DEMO; })[0];
    assertEqual(demo[header.indexOf('demo')], 'true');
    assertEqual(demo[header.indexOf('heartbeat_source')], 'demo');
  });
});

describe('UI helpers', function () {

  it('sparkPoints: at most the points asked for, gaps where nothing was known', function () {
    var S = FieldLensImport.sparkPoints;
    assertEqual(S([], 10).length, 0);
    assertEqual(JSON.stringify(S([-1, -1, 0.2, 0.4], 2)), JSON.stringify([null, 0.30000000000000004]));
    assertEqual(JSON.stringify(S([0.5, -1, 0.7], 10)), JSON.stringify([0.5, null, 0.7]), 'fewer values than points: one each');
    var coh = JSON.parse(FIRST).sessions[0].source_data.coherence;
    var pts = S(coh, 160);
    assertEqual(pts.length, 160);
    assertEqual(pts[0], null, 'coherence is not known in the first seconds');
    assert(pts.every(function (v) { return v === null || (v >= 0 && v <= 1); }), 'within 0..1');
  });

  it('heartbeat labels, demo counts and total time', function () {
    freshEnv();
    var res = FieldLensImport.importFieldLensFile(FIRST);
    assertEqual(FieldLensImport.heartbeatLabel('strap_ecg'), 'Chest strap ECG');
    assertEqual(FieldLensImport.heartbeatLabel('demo'), 'Demo (made-up heartbeats)');
    assertEqual(FieldLensImport.heartbeatLabel('__proto__'), '');
    assertEqual(FieldLensImport.demoCount(res.incoming), 1);
    assertEqual(FieldLensImport.totalSeconds(res.incoming), 720 + 420 + 120);
    var range = FieldLensImport.sessionDateRange(res.incoming);
    assertEqual(range.first, '2026-09-27');
    assertEqual(range.last, '2026-09-29');
    assertEqual(FieldLensImport.isDemo({ source: 'manual', source_data: { demo: true } }), false, 'only Field Lens sessions');
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
