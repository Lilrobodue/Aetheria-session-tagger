// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Field Lens Import Module
// Handles "field_lens_for_tagger" exports from Aetheria Field Lens
// (the Android app: a chest strap's heartbeat and the phone's own
// sensors). Like Divination, one file holds N sessions and each
// session becomes its own Tagger record.
//
// Re-importing a newer export never duplicates a session: a session
// already in the Tagger is updated from the file (so a note written
// later in Field Lens is merged in) and anything the person typed or
// changed in the Tagger is kept. To tell the person's edits from
// Field Lens's, each record remembers what the import last wrote
// (source_data.as_imported).
//
// The file comes from the user's disk, so every field is checked.
// Optional fields that fail are dropped; a session whose core (id,
// date, start time, heartbeat source, summary, the per-second and
// per-beat arrays) fails is skipped.
//
// Demo sessions (made-up heartbeats from Field Lens's demo mode) come
// in only when the person chose to export them, and are marked as
// demos wherever they appear.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('FieldLensImport: TaggerStore is not available');
    return s;
  }

  // ─── Constants ────────────────────────────────────────────────

  var EXPORT_TYPE    = 'field_lens_for_tagger';
  var APP_ID         = 'aetheria-field-lens';
  var SCHEMA_VERSION = '2.0';
  var MAX_SESSIONS   = 10000;
  var MAX_NOTES      = 20000;
  // A session is at most a day long: at most a day of once-a-second
  // readings, and no time in it past a day.
  var MAX_SECONDS    = 86400;
  // Heartbeats in a session (a day at 140 bpm is about 200 000).
  var MAX_BEATS      = 200000;
  // The raw ECG (130 samples a second) is kept for up to an hour:
  // 468 000 samples, a few MB of JSON. The Tagger holds every record in
  // memory and its Full JSON export carries them, so a longer ECG is
  // left out (ecg_dropped says so) and the rest of the session is kept.
  var ECG_HZ         = 130;
  var MAX_ECG        = ECG_HZ * 3600;
  // A Polar ECG sample is a 24-bit signed value in µV.
  var ECG_LIMIT_UV   = 8388607;
  // A phone's magnetometer reads up to about 4900 µT; the Earth's field is 25–65.
  var MAX_UT         = 10000;

  var HEARTBEAT_SOURCES = ['strap_ecg', 'strap_rate', 'demo'];

  // The Tagger's own choice lists (index.html REGIME_OPTIONS / CLASSIFICATION_OPTIONS).
  var REGIME_VALUES = ['GUT', 'HEART', 'HEAD', 'Mixed'];
  var CLASSIFICATION_VALUES = ['Aetheria Tuned', 'Harmonically Aligned', 'Partially Aligned', 'Unstructured'];

  var CONTEXT_KEYS = [
    'condition', 'moon', 'sleep', 'mood_before', 'mood_after', 'mood_change',
    'pain', 'activity', 'notes',
    'walk_type', 'dominant_regime', 'duration_minutes', 'coherence_score', 'classification'
  ];

  var UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

  var SESSION_ID_RE = /^field_lens_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // The session's summary, in Field Lens's order: [key, kind, lo, hi].
  // 'int' and 'num' must be there; 'num?' may be null (never known).
  var SUMMARY_FIELDS = [
    ['duration_seconds',        'int',  0, MAX_SECONDS],
    ['beats',                   'int',  0, MAX_BEATS],
    ['mean_hr',                 'num?', 0, 300],
    ['mean_coherence',          'num?', 0, 1],
    ['peak_coherence',          'num?', 0, 1],
    ['coherent_seconds',        'int',  0, MAX_SECONDS],
    ['mean_breaths_per_minute', 'num?', 0, 100],
    ['mean_room_ut',            'num?', 0, MAX_UT],
    ['room_range_ut',           'num',  0, MAX_UT],
    ['held_seconds',            'int',  0, MAX_SECONDS],
    ['mean_stillness',          'num?', 0, 1]
  ];

  // The once-a-second readings: [key, what a value may be].
  // hr, breath and room_ut use 0 for "not known"; coherence and still use -1.
  var SECOND_FIELDS = [
    ['t',         function (v) { return v >= 0 && v <= MAX_SECONDS; }],
    ['hr',        function (v) { return v >= 0 && v <= 300; }],
    ['coherence', function (v) { return v === -1 || (v >= 0 && v <= 1); }],
    ['breath',    function (v) { return v >= 0 && v <= 100; }],
    ['room_ut',   function (v) { return v >= 0 && v <= MAX_UT; }],
    ['held',      function (v) { return v === 0 || v === 1; }],
    ['still',     function (v) { return v === -1 || (v >= 0 && v <= 1); }]
  ];

  // ─── Format Detection ─────────────────────────────────────────

  function detectFieldLensFormat(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.export_type === EXPORT_TYPE) return 'tagger_export';
    return null;
  }

  // ─── Envelope Validation ──────────────────────────────────────

  function validateFieldLensExport(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || obj.export_type !== EXPORT_TYPE) {
      errors.push('wrong_export_type');
      return { valid: false, errors: errors };
    }
    if (typeof obj.aetheria_export_version !== 'string' || !/^1(\.\d+)*$/.test(obj.aetheria_export_version)) {
      errors.push('unsupported_export_version');
    }
    if (obj.schema_version !== SCHEMA_VERSION) {
      errors.push('unsupported_schema_version');
    }
    if (obj.app !== undefined && obj.app !== APP_ID) {
      errors.push('wrong_app');
    }
    if (!Array.isArray(obj.sessions)) {
      errors.push('missing_sessions');
    } else if (obj.sessions.length === 0) {
      errors.push('no_sessions');
    } else if (obj.sessions.length > MAX_SESSIONS) {
      errors.push('too_many_sessions');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Value Helpers ────────────────────────────────────────────

  function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function _int(v, lo, hi) {
    return (typeof v === 'number' && v === Math.floor(v) && v >= lo && v <= hi) ? v : null;
  }

  function _num(v, lo, hi) {
    return (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) ? v : null;
  }

  function _oneOf(v, list) { return list.indexOf(v) !== -1 ? v : null; }

  // Text with control characters removed (newlines and tabs stay), cut to max.
  function _text(v, max) {
    if (typeof v !== 'string') return null;
    var s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (s.length > max) {
      s = s.slice(0, max);
      // don't leave half of a surrogate pair at the cut
      var last = s.charCodeAt(s.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) s = s.slice(0, -1);
    }
    return s;
  }

  function _iso(v) {
    if (typeof v !== 'string' || v.length > 40) return null;
    var t = Date.parse(v);
    return isNaN(t) ? null : new Date(t).toISOString();
  }

  function isRealDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || y > 2200) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Key-order-independent JSON, for telling whether anything changed.
  function _canon(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(_canon).join(',') + ']';
    var keys = Object.keys(v).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      if (v[keys[i]] === undefined) continue;
      parts.push(JSON.stringify(keys[i]) + ':' + _canon(v[keys[i]]));
    }
    return '{' + parts.join(',') + '}';
  }

  // ─── Field Cleaners ───────────────────────────────────────────

  // A list of readings: every value a finite number that ok() accepts.
  // A copy, or null.
  function _series(a, maxLen, ok) {
    if (!Array.isArray(a) || a.length > maxLen) return null;
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) {
      var v = a[i];
      if (typeof v !== 'number' || !isFinite(v) || !ok(v)) return null;
      out[i] = v;
    }
    return out;
  }

  // The summary, checked against the per-second readings (n of them):
  // { summary } or { error }.
  function _cleanSummary(sm, n) {
    if (!_isObj(sm)) return { error: 'summary is missing' };
    var out = {};
    for (var i = 0; i < SUMMARY_FIELDS.length; i++) {
      var f = SUMMARY_FIELDS[i], k = f[0], kind = f[1], v = sm[k];
      var clean;
      if (kind === 'int') clean = _int(v, f[2], f[3]);
      else if (kind === 'num') clean = _num(v, f[2], f[3]);
      else if (v === null || v === undefined) { out[k] = null; continue; }
      else clean = _num(v, f[2], f[3]);
      if (clean === null) return { error: 'summary.' + k + ' is missing or out of range' };
      out[k] = clean;
    }
    // counted over the once-a-second readings
    if (out.coherent_seconds > n || out.held_seconds > n) {
      return { error: 'summary counts more seconds than the session holds' };
    }
    return { summary: out };
  }

  // The raw ECG, if kept: whole µV values, at most an hour of them.
  // { ecg, dropped }: an ECG over the cap, or one that fails, is left out.
  function _cleanEcg(a) {
    if (!Array.isArray(a) || a.length > MAX_ECG) return { ecg: [], dropped: Array.isArray(a) && a.length > 0 };
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) {
      if (_int(a[i], -ECG_LIMIT_UV - 1, ECG_LIMIT_UV) === null) return { ecg: [], dropped: true };
      out[i] = a[i];
    }
    return { ecg: out, dropped: false };
  }

  // Context as the Tagger stores it. Field Lens knows the duration, the
  // peak coherence (as a 0–100 score) and the person's note; regime and
  // classification only if they are the Tagger's own values (Field Lens
  // leaves them empty); everything else starts at the Tagger's defaults.
  function _cleanContext(ctx) {
    var c = _isObj(ctx) ? ctx : {};
    return {
      condition:        '',
      moon:             'unknown',
      sleep:            null,
      mood_before:      null,
      mood_after:       null,
      mood_change:      null,
      pain:             null,
      activity:         '',
      notes:            _text(c.notes, MAX_NOTES) || '',
      walk_type:        '',
      dominant_regime:  _oneOf(c.dominant_regime, REGIME_VALUES) || '',
      duration_minutes: _int(c.duration_minutes, 0, MAX_SECONDS / 60),
      coherence_score:  _int(c.coherence_score, 0, 100),
      classification:   _oneOf(c.classification, CLASSIFICATION_VALUES) || ''
    };
  }

  function _copyContext(ctx) {
    var out = {};
    for (var i = 0; i < CONTEXT_KEYS.length; i++) out[CONTEXT_KEYS[i]] = ctx[CONTEXT_KEYS[i]];
    return out;
  }

  // ─── Build Tagger Record ──────────────────────────────────────

  // One session from the file → { record, fileTime } or { error }.
  // fileTime is when the file says the record was written (its export),
  // used only to pick the newest copy of a session seen twice.
  function buildFieldLensRecord(s) {
    if (!_isObj(s)) return { error: 'not an object' };
    if (s.source !== 'field_lens') return { error: 'source must be "field_lens"' };
    if (s.schema_version !== SCHEMA_VERSION) return { error: 'schema_version must be "2.0"' };
    var sid = s.session_id;
    if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) {
      return { error: 'session_id is missing or malformed' };
    }
    if (!isRealDate(s.session_date)) return { error: 'session_date must be a real YYYY-MM-DD date' };
    if (!_isObj(s.context)) return { error: 'context must be an object' };
    var sd = s.source_data;
    if (!_isObj(sd)) return { error: 'source_data must be an object' };

    var startedAt = _iso(sd.started_at);
    if (!startedAt) return { error: 'started_at is missing' };
    var hbSource = _oneOf(sd.heartbeat_source, HEARTBEAT_SOURCES);
    if (!hbSource) return { error: 'heartbeat_source is missing or unknown' };
    // A demo flag that disagrees with the heartbeat's source leaves it
    // unclear whether the beats were real, so the session is not taken.
    var demo = hbSource === 'demo';
    if (sd.demo !== undefined && sd.demo !== demo) {
      return { error: 'demo does not match heartbeat_source' };
    }

    // Once-a-second readings: all the same length, every value in range.
    var n = Array.isArray(sd.t) ? sd.t.length : -1;
    if (n < 0 || n > MAX_SECONDS) return { error: 'the per-second readings are missing or too long' };
    var seconds = {};
    for (var i = 0; i < SECOND_FIELDS.length; i++) {
      var key = SECOND_FIELDS[i][0];
      var arr = _series(sd[key], MAX_SECONDS, SECOND_FIELDS[i][1]);
      if (!arr || arr.length !== n) return { error: 'per-second ' + key + ' is malformed' };
      seconds[key] = arr;
    }

    // Each heartbeat: its R-R interval (ms; a strap reads up to 64 s) and
    // when it came (s from the start).
    var rrMs = _series(sd.rr_ms, MAX_BEATS, function (v) { return v >= 0 && v <= 65536; });
    var rrT = _series(sd.rr_t, MAX_BEATS, function (v) { return v >= 0 && v <= MAX_SECONDS; });
    if (!rrMs || !rrT || rrMs.length !== rrT.length) return { error: 'the heartbeats (rr_ms, rr_t) are malformed' };

    var sm = _cleanSummary(sd.summary, n);
    if (sm.error) return { error: sm.error };

    var endedAt = _iso(sd.ended_at);
    if (endedAt && endedAt < startedAt) endedAt = null;
    var ecg = _cleanEcg(sd.ecg_uv);

    var context = _cleanContext(s.context);
    var now = new Date().toISOString();
    var sourceData = {
      description:        _text(sd.description, 500) || '',
      app:                APP_ID,
      entry_version:      _int(sd.entry_version, 1, 1000),
      heartbeat_source:   hbSource,
      demo:               demo,
      started_at:         startedAt,
      ended_at:           endedAt,
      utc_offset_minutes: _int(sd.utc_offset_minutes, -960, 960),
      summary:            sm.summary,
      t:                  seconds.t,
      hr:                 seconds.hr,
      coherence:          seconds.coherence,
      breath:             seconds.breath,
      room_ut:            seconds.room_ut,
      held:               seconds.held,
      still:              seconds.still,
      rr_ms:              rrMs,
      rr_t:               rrT,
      ecg_uv:             ecg.ecg,
      ecg_dropped:        ecg.dropped,
      // What this import wrote into the Tagger's own fields, so the next
      // import can tell the person's edits from Field Lens's.
      as_imported: {
        session_date: s.session_date,
        context:      _copyContext(context)
      }
    };

    var record = {
      schema_version: SCHEMA_VERSION,
      session_id:     sid,
      source:         'field_lens',
      imported_at:    now,
      last_edited_at: now,
      session_date:   s.session_date,
      context:        context,
      source_data:    sourceData,
      raw_import:     null
    };

    var v = _store().validateRecord(record);
    if (!v.valid) return { error: v.errors[0] };
    return { record: record, fileTime: _iso(s.last_edited_at) || _iso(s.imported_at) || '' };
  }

  // ─── Merge (re-import) ────────────────────────────────────────

  function _isBlank(v, key) {
    return v === null || v === undefined || v === '' || (key === 'moon' && v === 'unknown');
  }

  // Notes: Field Lens writes the note the person typed there; they may add
  // to it, rewrite it or clear it in the Tagger. Blank notes are filled
  // from the file only when the last import wrote nothing there (or there
  // is no record of it): notes the person cleared stay clear, apart from
  // lines Field Lens has newly written. (The same rule as Divination.)
  function mergeNotes(current, prevImported, incoming) {
    var cur = typeof current === 'string' ? current : '';
    var inc = typeof incoming === 'string' ? incoming : '';
    var prev = typeof prevImported === 'string' ? prevImported : null;
    if (!cur.trim() && (prev === null || !prev.trim())) return inc;
    if (cur === inc || !inc) return cur;
    if (prev !== null) {
      // untouched since the last import: take Field Lens's newer text
      if (cur === prev) return inc;
      // added to: swap the imported block, keep the person's words around it
      if (prev && cur.indexOf(prev) !== -1) {
        return cur.replace(prev, function () { return inc; });
      }
    }
    // rewritten or cleared: keep the person's words, and add only the lines
    // Field Lens has newly written
    var prevLines = prev ? prev.split('\n') : [];
    var add = inc.split('\n').filter(function (line) {
      return line.trim() !== '' && prevLines.indexOf(line) === -1 && cur.indexOf(line) === -1;
    });
    if (!add.length) return cur;
    var kept = cur.replace(/\s+$/, '');
    return kept ? kept + '\n\n' + add.join('\n') : add.join('\n');
  }

  // An existing Tagger record updated from a newer export. Field Lens's data
  // (source_data) comes from the file; the Tagger's fields keep whatever the
  // person changed since the last import.
  function mergeFieldLensRecord(existing, incoming) {
    var prev = (existing.source_data && _isObj(existing.source_data.as_imported)) ? existing.source_data.as_imported : null;
    var prevCtx = (prev && _isObj(prev.context)) ? prev.context : null;
    var cur = _isObj(existing.context) ? existing.context : {};
    var inc = incoming.context;
    var ctx = {};

    for (var i = 0; i < CONTEXT_KEYS.length; i++) {
      var k = CONTEXT_KEYS[i];
      if (k === 'notes') {
        ctx.notes = mergeNotes(cur.notes, prevCtx ? prevCtx.notes : null, inc.notes);
      } else if (!(k in cur)) {
        ctx[k] = inc[k];
      } else if (prevCtx && (k in prevCtx)) {
        ctx[k] = _canon(cur[k]) === _canon(prevCtx[k]) ? inc[k] : cur[k];
      } else {
        ctx[k] = _isBlank(cur[k], k) ? inc[k] : cur[k];
      }
    }
    if (typeof ctx.mood_before === 'number' && typeof ctx.mood_after === 'number') {
      ctx.mood_change = ctx.mood_after - ctx.mood_before;
    }
    // keep any other context the Tagger holds for this session
    for (var ck in cur) {
      if (cur.hasOwnProperty(ck) && CONTEXT_KEYS.indexOf(ck) === -1 && UNSAFE_KEYS.indexOf(ck) === -1) ctx[ck] = cur[ck];
    }

    var date;
    if (prev && typeof prev.session_date === 'string') {
      date = existing.session_date === prev.session_date ? incoming.session_date : existing.session_date;
    } else {
      date = isRealDate(existing.session_date) ? existing.session_date : incoming.session_date;
    }

    return {
      schema_version: SCHEMA_VERSION,
      session_id:     existing.session_id,
      source:         'field_lens',
      imported_at:    existing.imported_at || incoming.imported_at,
      last_edited_at: new Date().toISOString(),
      session_date:   date,
      context:        ctx,
      source_data:    incoming.source_data,
      raw_import:     null
    };
  }

  function _sameRecord(a, b) {
    return a.session_date === b.session_date &&
      _canon(a.context) === _canon(b.context) &&
      _canon(a.source_data) === _canon(b.source_data);
  }

  // Where a clean record from the file goes: new, an update, already up to
  // date, or refused (its id belongs to another app's session).
  function _classify(store, rec) {
    var existing = store.loadSession(rec.session_id);
    if (!existing) return { kind: 'new', record: rec };
    if (existing.source !== 'field_lens') {
      return { kind: 'conflict', reason: 'its id is taken by a ' + existing.source + ' session' };
    }
    var merged = mergeFieldLensRecord(existing, rec);
    if (_sameRecord(existing, merged)) return { kind: 'unchanged', record: existing };
    return { kind: 'update', record: merged };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importFieldLensFile(fileContent) {
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }

    if (detectFieldLensFormat(obj) !== 'tagger_export') {
      return { status: 'error', error: "This doesn't look like an Aetheria Field Lens export. In Field Lens, open Sessions and choose “Export for the Session Tagger”." };
    }

    var v = validateFieldLensExport(obj);
    if (!v.valid) {
      return { status: 'error', error: _validationErrorMessage(v.errors, obj) };
    }

    // Check each session; a session repeated in the file counts once
    // (the copy from the newest export wins; on a tie, the later one).
    var skipped = [];
    var order = [];
    var byId = {};
    var repeatedCount = 0;
    for (var i = 0; i < obj.sessions.length; i++) {
      var built = buildFieldLensRecord(obj.sessions[i]);
      if (built.error) {
        var s = obj.sessions[i];
        var sid = (s && typeof s.session_id === 'string') ? _text(s.session_id, 160) : null;
        skipped.push({ index: i, session_id: sid, reason: built.error });
        continue;
      }
      var id = built.record.session_id;
      var prior = byId[id];
      if (prior) {
        repeatedCount++;
        if (built.fileTime >= prior.fileTime) byId[id] = built;
      } else {
        byId[id] = built;
        order.push(id);
      }
    }

    if (!order.length) {
      var first = skipped.length ? skipped[0].reason : 'no sessions';
      return {
        status: 'error',
        error: 'None of the ' + obj.sessions.length + ' session' + (obj.sessions.length !== 1 ? 's' : '') +
          ' in this Field Lens export could be read (' + first + ').'
      };
    }

    var store = _store();
    var incoming = [];
    var newRecords = [];
    var updatedRecords = [];
    var unchangedCount = 0;
    for (var j = 0; j < order.length; j++) {
      var r = byId[order[j]].record;
      var c = _classify(store, r);
      if (c.kind === 'conflict') {
        skipped.push({ index: null, session_id: r.session_id, reason: c.reason });
        continue;
      }
      incoming.push(r);
      if (c.kind === 'new') newRecords.push(c.record);
      else if (c.kind === 'update') updatedRecords.push(c.record);
      else unchangedCount++;
    }

    return {
      status:          'ok',
      incoming:        incoming,
      newSessions:     newRecords,
      updatedSessions: updatedRecords,
      newCount:        newRecords.length,
      updatedCount:    updatedRecords.length,
      unchangedCount:  unchangedCount,
      totalCount:      incoming.length,
      demoCount:       demoCount(incoming),
      skipped:         skipped,
      skippedCount:    skipped.length,
      repeatedCount:   repeatedCount,
      exportDate:      _iso(obj.exported_at)
    };
  }

  // Save what an import found, merging against the store as it is now.
  function commitFieldLensImport(result) {
    var store = _store();
    var imported = [];
    var updated = [];
    var failed = [];
    var unchangedCount = 0;
    var list = (result && result.incoming) || [];
    for (var i = 0; i < list.length; i++) {
      var c = _classify(store, list[i]);
      if (c.kind === 'unchanged') { unchangedCount++; continue; }
      if (c.kind === 'conflict') { failed.push({ session_id: list[i].session_id, reason: c.reason }); continue; }
      try {
        store.saveSession(c.record);
        (c.kind === 'new' ? imported : updated).push(c.record);
      } catch (e) {
        failed.push({ session_id: list[i].session_id, reason: e.message });
      }
    }
    return { imported: imported, updated: updated, unchangedCount: unchangedCount, failed: failed };
  }

  // ─── UI / Summary Helpers ─────────────────────────────────────

  function isDemo(rec) {
    var sd = rec && rec.source_data;
    return !!(rec && rec.source === 'field_lens' && sd && (sd.demo === true || sd.heartbeat_source === 'demo'));
  }

  function heartbeatLabel(src) {
    if (src === 'strap_ecg') return 'Chest strap ECG';
    if (src === 'strap_rate') return 'Chest strap heart rate';
    if (src === 'demo') return 'Demo (made-up heartbeats)';
    return '';
  }

  function demoCount(records) {
    var n = 0;
    for (var i = 0; i < (records || []).length; i++) if (isDemo(records[i])) n++;
    return n;
  }

  function totalSeconds(records) {
    var s = 0;
    for (var i = 0; i < (records || []).length; i++) {
      var sm = records[i] && records[i].source_data && records[i].source_data.summary;
      if (sm && typeof sm.duration_seconds === 'number') s += sm.duration_seconds;
    }
    return s;
  }

  function sessionDateRange(records) {
    var dates = [];
    for (var i = 0; i < (records || []).length; i++) {
      if (records[i] && records[i].session_date) dates.push(records[i].session_date);
    }
    dates.sort();
    return { first: dates[0] || null, last: dates[dates.length - 1] || null };
  }

  // At most maxPoints points from a per-second series, for a sparkline:
  // each the mean of the known values (0 and up) in its stretch of the
  // session, or null where none was known (coherence is -1 until the
  // rhythm has been read).
  function sparkPoints(values, maxPoints) {
    var vals = Array.isArray(values) ? values : [];
    var n = vals.length;
    var out = [];
    if (!n) return out;
    var m = Math.max(1, Math.min(maxPoints || 120, n));
    for (var p = 0; p < m; p++) {
      var a = Math.floor(p * n / m), b = Math.floor((p + 1) * n / m);
      var sum = 0, cnt = 0;
      for (var i = a; i < b; i++) {
        var v = vals[i];
        if (typeof v === 'number' && v >= 0) { sum += v; cnt++; }
      }
      out.push(cnt ? sum / cnt : null);
    }
    return out;
  }

  // ─── Internal ─────────────────────────────────────────────────

  function _validationErrorMessage(errors, obj) {
    var first = errors[0];
    if (first === 'unsupported_export_version' || first === 'unsupported_schema_version') {
      return 'This Field Lens export was made in a newer format (' +
        _text(String(obj.aetheria_export_version), 20) + ', schema ' + _text(String(obj.schema_version), 20) +
        ') than this Tagger reads. Update the Session Tagger and try again.';
    }
    if (first === 'wrong_app') return 'This export says it comes from another app, not Aetheria Field Lens.';
    if (first === 'missing_sessions') return 'This Field Lens export has no sessions list. The file may be damaged.';
    if (first === 'no_sessions') return 'This Field Lens export holds no sessions.';
    if (first === 'too_many_sessions') return 'This file holds more than ' + MAX_SESSIONS + ' sessions, more than the Tagger takes in at once.';
    return 'Field Lens export validation failed: ' + errors.join('; ');
  }

  // ─── Public API ───────────────────────────────────────────────

  var FieldLensImport = {
    EXPORT_TYPE:              EXPORT_TYPE,
    MAX_ECG:                  MAX_ECG,
    detectFieldLensFormat:    detectFieldLensFormat,
    validateFieldLensExport:  validateFieldLensExport,
    buildFieldLensRecord:     buildFieldLensRecord,
    mergeFieldLensRecord:     mergeFieldLensRecord,
    mergeNotes:               mergeNotes,
    importFieldLensFile:      importFieldLensFile,
    commitFieldLensImport:    commitFieldLensImport,
    isRealDate:               isRealDate,

    // UI helpers
    isDemo:           isDemo,
    heartbeatLabel:   heartbeatLabel,
    demoCount:        demoCount,
    totalSeconds:     totalSeconds,
    sessionDateRange: sessionDateRange,
    sparkPoints:      sparkPoints
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FieldLensImport;
  } else {
    root.FieldLensImport = FieldLensImport;
  }

})(typeof window !== 'undefined' ? window : this);
