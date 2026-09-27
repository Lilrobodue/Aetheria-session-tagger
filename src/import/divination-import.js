// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Divination Import Module
// Handles "divination_for_tagger" exports from Aetheria Divination
// (I Ching readings). Like RCT, one file holds N sessions and each
// reading becomes its own Tagger record. Only readings answered in
// the Honest Mirror are taken in.
//
// Re-importing a newer export never duplicates a reading: a session
// already in the Tagger is updated from the file (so a newer Mirror
// answer is merged in) and anything the person typed or changed in
// the Tagger is kept. To tell the person's edits from Divination's,
// each record remembers what the import last wrote
// (source_data.as_imported).
//
// The file comes from the user's disk, so every field is checked.
// Optional fields that fail are dropped; a reading whose core (id,
// date, cast, hexagrams, journey, Mirror answer) fails is skipped.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('DivinationImport: TaggerStore is not available');
    return s;
  }

  // ─── Constants ────────────────────────────────────────────────

  var EXPORT_TYPE    = 'divination_for_tagger';
  var APP_ID         = 'aetheria-divination';
  var SCHEMA_VERSION = '2.0';
  var MAX_SESSIONS   = 10000;
  var MAX_RAW_CHARS  = 200000;   // one reading's raw_import, as JSON
  var MAX_NOTES      = 20000;

  // The Tagger's own choice lists (index.html MOON_OPTIONS / WALK_OPTIONS).
  var MOON_VALUES = [
    'unknown', '\u{1F311} New', '\u{1F312} Waxing Crescent', '\u{1F313} First Quarter',
    '\u{1F314} Waxing Gibbous', '\u{1F315} Full', '\u{1F316} Waning Gibbous',
    '\u{1F317} Last Quarter', '\u{1F318} Waning Crescent'
  ];
  var WALK_VALUES = ['', 'Layer Ascent', 'Pillar Walk', 'Flying Star Vortex', 'CAB', 'Ouroboros', 'CABI'];

  var CONTEXT_KEYS = [
    'condition', 'moon', 'sleep', 'mood_before', 'mood_after', 'mood_change',
    'pain', 'activity', 'notes',
    'walk_type', 'dominant_regime', 'duration_minutes', 'coherence_score', 'classification'
  ];

  var TRIGRAMS  = ['qian', 'dui', 'li', 'zhen', 'xun', 'kan', 'gen', 'kun'];
  var RELATIONS = ['harmony', 'support', 'effort', 'drain', 'pressure'];
  var STRENGTHS = ['strong', 'rising', 'resting', 'confined', 'spent'];
  var ELEMENTS  = ['Wood', 'Fire', 'Earth', 'Metal', 'Water'];
  var ROLES     = ['present', 'process', 'outcome'];

  var METHOD_NAMES = {
    'moment': 'The Moment', 'moment-numbers': 'The Moment', 'question': 'The Question',
    'two-voices': 'Two Voices', 'coins': 'Coins', 'yarrow': 'Yarrow',
    'heart-yarrow': 'Heart Yarrow', 'two-hearts': 'Two Hearts'
  };

  // Never kept, at any depth: the Mirror's decoy (the trial stays blind),
  // birth mansions, the place, and a heart cast's beats.
  var PRIVATE_KEYS = ['decoy', 'birthMansions', 'lat', 'lon', 'rrTicks', 'rrTicksA', 'rrTicksB'];
  var UNSAFE_KEYS  = ['__proto__', 'constructor', 'prototype'];

  // ─── Format Detection ─────────────────────────────────────────

  function detectDivinationFormat(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.export_type === EXPORT_TYPE) return 'tagger_export';
    // Divination's own journal backup: recognised so the person can be
    // pointed to the right export instead of a generic error.
    if (obj.app === APP_ID && obj.kind === 'journal') return 'journal_backup';
    return null;
  }

  // ─── Envelope Validation ──────────────────────────────────────

  function validateDivinationExport(obj) {
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

  function _hexRef(v, expected) {
    if (!_isObj(v)) return null;
    var n = _int(v.hexagram, 1, 64);
    if (n === null || (expected != null && n !== expected)) return null;
    return { hexagram: n, hexagram_name: _text(v.hexagram_name, 80) || null };
  }

  // The cast must agree with itself: moving lines are exactly the old
  // lines (6 and 9, counted from the bottom), bits follow the line values,
  // and the changed hexagram differs from the present one only if a line moves.
  function _cleanCast(c) {
    if (!_isObj(c)) return null;
    var lv = c.line_values;
    if (!Array.isArray(lv) || lv.length !== 6) return null;
    var moving = [];
    var bits = '';
    for (var i = 0; i < 6; i++) {
      if (lv[i] !== 6 && lv[i] !== 7 && lv[i] !== 8 && lv[i] !== 9) return null;
      if (lv[i] === 6 || lv[i] === 9) moving.push(i + 1);
      bits += (lv[i] % 2) ? '1' : '0';
    }
    var ml = c.moving_lines;
    if (!Array.isArray(ml) || ml.length !== moving.length) return null;
    for (var j = 0; j < ml.length; j++) {
      if (ml[j] !== moving[j]) return null;
    }
    if (c.bits !== undefined && c.bits !== bits) return null;
    var present = _int(c.present, 1, 64);
    var nuclear = _int(c.nuclear, 1, 64);
    var changed = _int(c.changed, 1, 64);
    if (present === null || nuclear === null || changed === null) return null;
    if (moving.length ? changed === present : changed !== present) return null;

    var out = {
      present:      present,
      nuclear:      nuclear,
      changed:      changed,
      moving_lines: moving,
      line_values:  lv.slice(),
      bits:         bits,
      upper:        _oneOf(c.upper, TRIGRAMS),
      lower:        _oneOf(c.lower, TRIGRAMS)
    };
    if (c.body !== undefined || c.use !== undefined) {
      out.body = _oneOf(c.body, TRIGRAMS);
      out.use  = _oneOf(c.use, TRIGRAMS);
    }
    return out;
  }

  // The tones as played. Each tone's hexagram must be the cast's
  // hexagram for its role (present / nuclear / changed).
  function _cleanJourney(j, cast) {
    if (!Array.isArray(j) || j.length < 1 || j.length > 3) return null;
    var byRole = { present: cast.present, process: cast.nuclear, outcome: cast.changed };
    var out = [];
    for (var i = 0; i < j.length; i++) {
      var t = j[i];
      if (!_isObj(t)) return null;
      var role = _oneOf(t.role, ROLES);
      var hx = _int(t.hexagram, 1, 64);
      var hz = _num(t.frequency_hz, 0.001, 100000);
      if (!role || hx === null || hz === null || hx !== byRole[role]) return null;
      out.push({
        role:          role,
        hexagram:      hx,
        hexagram_name: _text(t.hexagram_name, 80) || null,
        frequency_hz:  hz,
        script:        _text(t.script, 80) || null,
        regime:        _text(t.regime, 20) || null,
        position:      _int(t.position, 0, 999)
      });
    }
    return out;
  }

  function _cleanTone(t) {
    if (!_isObj(t)) return null;
    var hz = _num(t.frequency_hz, 0.001, 100000);
    if (hz === null) return null;
    return { frequency_hz: hz, script: _text(t.script, 80) || null };
  }

  function _cleanVerdict(v) {
    if (!_isObj(v)) return null;
    var body = _oneOf(v.body, TRIGRAMS), use = _oneOf(v.use, TRIGRAMS);
    var now = _oneOf(v.now, RELATIONS), outcome = _oneOf(v.outcome, RELATIONS);
    if (!body || !use || !now || !outcome || !Array.isArray(v.process) || v.process.length !== 2) return null;
    var p0 = _oneOf(v.process[0], RELATIONS), p1 = _oneOf(v.process[1], RELATIONS);
    if (!p0 || !p1) return null;
    var out = { body: body, use: use, now: now, process: [p0, p1], outcome: outcome };
    var tg = v.trigrams;
    if (_isObj(tg) && Array.isArray(tg.process) && tg.process.length === 2 &&
        _oneOf(tg.now, TRIGRAMS) && _oneOf(tg.outcome, TRIGRAMS) &&
        _oneOf(tg.process[0], TRIGRAMS) && _oneOf(tg.process[1], TRIGRAMS)) {
      out.trigrams = { now: tg.now, process: [tg.process[0], tg.process[1]], outcome: tg.outcome };
    }
    var se = v.season;
    if (_isObj(se) && _oneOf(se.element, ELEMENTS) && _oneOf(se.body, STRENGTHS) && _oneOf(se.use, STRENGTHS)) {
      out.season = { element: se.element, body: se.body, use: se.use };
    }
    return out;
  }

  function _cleanSky(s) {
    if (!_isObj(s)) return null;
    var sm = _isObj(s.solar_month) ? s.solar_month : null;
    var tide = _isObj(s.tide) ? s.tide : null;
    var he = _isObj(s.heaven_earth) ? s.heaven_earth : null;
    return {
      mansion:           _int(s.mansion, 1, 28),
      mansion_name:      _text(s.mansion_name, 60),
      pada:              _int(s.pada, 1, 4),
      illumination:      _num(s.illumination, 0, 1),
      elongation_deg:    _num(s.elongation_deg, 0, 360),
      lunar_day:         _int(s.lunar_day, 1, 30),
      waxing:            typeof s.waxing === 'boolean' ? s.waxing : null,
      phase_name:        _text(s.phase_name, 40),
      sky_hexagram:      _int(s.sky_hexagram, 1, 64),
      sky_hexagram_name: _text(s.sky_hexagram_name, 80),
      sky_frequency_hz:  _num(s.sky_frequency_hz, 0.001, 100000),
      sky_script:        _text(s.sky_script, 80),
      sky_regime:        _text(s.sky_regime, 20),
      solar_month: sm ? {
        name:           _text(sm.name, 40),
        number:         _int(sm.number, 1, 12),
        season_element: _oneOf(sm.season_element, ELEMENTS)
      } : null,
      tide: tide ? {
        branch:        _text(tide.branch, 40),
        hexagram:      _int(tide.hexagram, 1, 64),
        hexagram_name: _text(tide.hexagram_name, 80),
        frequency_hz:  _num(tide.frequency_hz, 0.001, 100000),
        script:        _text(tide.script, 80)
      } : null,
      heaven_earth: he ? {
        distance: _num(he.distance, 0, 1000),
        mark:     typeof he.mark === 'boolean' ? he.mark : null
      } : null
    };
  }

  // A cast's inputs: plain values only. Arrays and objects are left out
  // (a heart cast's beats never leave the phone), and so is the place.
  function _cleanInputs(inp) {
    var out = {};
    if (!_isObj(inp)) return out;
    var keys = Object.keys(inp);
    for (var i = 0; i < keys.length && i < 40; i++) {
      var k = keys[i];
      var v = inp[k];
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || UNSAFE_KEYS.indexOf(k) !== -1 || PRIVATE_KEYS.indexOf(k) !== -1) continue;
      if (typeof v === 'string') out[k] = _text(v, 5000);
      else if (typeof v === 'number' && isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean' || v === null) out[k] = v;
    }
    return out;
  }

  // Strip private keys at any depth; false if the object nests too deep to check.
  function _stripPrivate(o, depth) {
    if (!o || typeof o !== 'object') return true;
    if (depth > 12) return false;
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) {
        if (!_stripPrivate(o[i], depth + 1)) return false;
      }
      return true;
    }
    var keys = Object.keys(o);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (PRIVATE_KEYS.indexOf(k) !== -1 || UNSAFE_KEYS.indexOf(k) !== -1) {
        delete o[k];
      } else if (!_stripPrivate(o[k], depth + 1)) {
        return false;
      }
    }
    return true;
  }

  // The native journal entry, kept for the record (never shown as HTML).
  function _cleanRaw(raw) {
    if (!_isObj(raw)) return null;
    var text;
    try { text = JSON.stringify(raw); } catch (e) { return null; }
    if (!text || text.length > MAX_RAW_CHARS) return null;
    var copy = JSON.parse(text);
    return _stripPrivate(copy, 0) ? copy : null;
  }

  // Context as the Tagger stores it. Regime, classification, coherence and
  // duration always stay empty: they drive the Tagger's protocol statistics,
  // which a reading is not part of (Joseph, 27 Sep 2026).
  function _cleanContext(ctx) {
    var c = _isObj(ctx) ? ctx : {};
    var mb = _int(c.mood_before, 1, 10);
    var ma = _int(c.mood_after, 1, 10);
    return {
      condition:        _text(c.condition, 500) || '',
      moon:             _oneOf(c.moon, MOON_VALUES) || 'unknown',
      sleep:            _num(c.sleep, 0, 24),
      mood_before:      mb,
      mood_after:       ma,
      mood_change:      (mb !== null && ma !== null) ? ma - mb : null,
      pain:             _int(c.pain, 0, 10),
      activity:         _text(c.activity, 500) || '',
      notes:            _text(c.notes, MAX_NOTES) || '',
      walk_type:        _oneOf(c.walk_type, WALK_VALUES) || '',
      dominant_regime:  '',
      duration_minutes: null,
      coherence_score:  null,
      classification:   ''
    };
  }

  function _copyContext(ctx) {
    var out = {};
    for (var i = 0; i < CONTEXT_KEYS.length; i++) out[CONTEXT_KEYS[i]] = ctx[CONTEXT_KEYS[i]];
    return out;
  }

  // ─── Build Tagger Record ──────────────────────────────────────

  // One session from the file → { record } or { error }.
  function buildDivinationRecord(s) {
    if (!_isObj(s)) return { error: 'not an object' };
    if (s.source !== 'divination') return { error: 'source must be "divination"' };
    if (s.schema_version !== SCHEMA_VERSION) return { error: 'schema_version must be "2.0"' };
    var sid = s.session_id;
    if (typeof sid !== 'string' || !/^divination_[A-Za-z0-9_-]{1,128}$/.test(sid)) {
      return { error: 'session_id is missing or malformed' };
    }
    if (!isRealDate(s.session_date)) return { error: 'session_date must be a real YYYY-MM-DD date' };
    if (!_isObj(s.context)) return { error: 'context must be an object' };
    var sd = s.source_data;
    if (!_isObj(sd)) return { error: 'source_data must be an object' };

    var readingId = _text(sd.reading_id, 200);
    if (!readingId || sid !== 'divination_' + readingId.replace(/[^A-Za-z0-9_-]/g, '-')) {
      return { error: 'session_id does not match reading_id' };
    }
    var m = sd.mirror;
    if (!_isObj(m) || (m.status !== 'hit' && m.status !== 'miss') || m.picked_real !== (m.status === 'hit')) {
      return { error: 'not answered in the Honest Mirror' };
    }
    var cast = _cleanCast(sd.cast);
    if (!cast) return { error: 'cast is malformed' };
    var hx = _isObj(sd.hexagrams) ? sd.hexagrams : {};
    var hexagrams = {
      present: _hexRef(hx.present, cast.present),
      nuclear: _hexRef(hx.nuclear, cast.nuclear),
      changed: _hexRef(hx.changed, cast.changed)
    };
    if (!hexagrams.present || !hexagrams.nuclear || !hexagrams.changed) {
      return { error: 'hexagrams do not match the cast' };
    }
    var journey = _cleanJourney(sd.journey, cast);
    if (!journey) return { error: 'journey is missing or malformed' };
    var mapVersion = _text(sd.map_version, 80);
    if (!mapVersion) return { error: 'map_version is missing' };
    var askedAt = _iso(sd.asked_at);
    if (!askedAt) return { error: 'asked_at is missing' };
    var method = (typeof sd.method === 'string' && /^[a-z0-9-]{1,40}$/.test(sd.method)) ? sd.method : null;
    if (!method) return { error: 'method is missing' };

    var context = _cleanContext(s.context);
    var now = new Date().toISOString();
    var sourceData = {
      description:          _text(sd.description, 5000) || '',
      app:                  APP_ID,
      entry_version:        _int(sd.entry_version, 1, 1000),
      reading_id:           readingId,
      map_version:          mapVersion,
      asked_at:             askedAt,
      asked_at_ms:          Date.parse(askedAt),
      clock_offset_minutes: _int(sd.clock_offset_minutes, -960, 960),
      question:             _text(sd.question, 5000) || '',
      method:               method,
      method_name:          _text(sd.method_name, 80) || METHOD_NAMES[method] || method,
      inputs:               _cleanInputs(sd.inputs),
      cast:                 cast,
      hexagrams:            hexagrams,
      journey:              journey,
      journey_hz:           journey.map(function (t) { return t.frequency_hz; }),
      source_tone:          _cleanTone(sd.source_tone),
      verdict:              _cleanVerdict(sd.verdict),
      sky:                  _cleanSky(sd.sky),
      mirror: {
        status:      m.status,
        picked_real: m.picked_real,
        answered_at: _iso(m.answered_at),
        note:        _text(m.note, 5000) || ''
      },
      // What this import wrote into the Tagger's own fields, so the next
      // import can tell the person's edits from Divination's.
      as_imported: {
        session_date: s.session_date,
        context:      _copyContext(context)
      }
    };

    var record = {
      schema_version: SCHEMA_VERSION,
      session_id:     sid,
      source:         'divination',
      imported_at:    now,
      last_edited_at: now,
      session_date:   s.session_date,
      context:        context,
      source_data:    sourceData,
      raw_import:     _cleanRaw(s.raw_import)
    };

    var v = _store().validateRecord(record);
    if (!v.valid) return { error: v.errors[0] };
    return { record: record };
  }

  // ─── Merge (re-import) ────────────────────────────────────────

  function _isBlank(v, key) {
    return v === null || v === undefined || v === '' || (key === 'moon' && v === 'unknown');
  }

  // Notes: Divination writes the question, the cast, the Mirror's result and
  // its note; the person may add to them, rewrite them or clear them in the
  // Tagger. Blank notes are filled from the file only when the last import
  // wrote nothing there (or there is no record of it): notes the person
  // cleared stay clear, apart from lines Divination has newly written.
  function mergeNotes(current, prevImported, incoming) {
    var cur = typeof current === 'string' ? current : '';
    var inc = typeof incoming === 'string' ? incoming : '';
    var prev = typeof prevImported === 'string' ? prevImported : null;
    if (!cur.trim() && (prev === null || !prev.trim())) return inc;
    if (cur === inc || !inc) return cur;
    if (prev !== null) {
      // untouched since the last import: take Divination's newer text
      if (cur === prev) return inc;
      // added to: swap the imported block, keep the person's words around it
      if (prev && cur.indexOf(prev) !== -1) {
        return cur.replace(prev, function () { return inc; });
      }
    }
    // rewritten or cleared: keep the person's words, and add only the lines
    // Divination has newly written (such as a Mirror answer or note)
    var prevLines = prev ? prev.split('\n') : [];
    var add = inc.split('\n').filter(function (line) {
      return line.trim() !== '' && prevLines.indexOf(line) === -1 && cur.indexOf(line) === -1;
    });
    if (!add.length) return cur;
    var kept = cur.replace(/\s+$/, '');
    return kept ? kept + '\n\n' + add.join('\n') : add.join('\n');
  }

  // An existing Tagger record updated from a newer export. Divination's data
  // (source_data, raw_import) comes from the file; the Tagger's fields keep
  // whatever the person changed since the last import.
  function mergeDivinationRecord(existing, incoming) {
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
      source:         'divination',
      imported_at:    existing.imported_at || incoming.imported_at,
      last_edited_at: new Date().toISOString(),
      session_date:   date,
      context:        ctx,
      source_data:    incoming.source_data,
      raw_import:     incoming.raw_import != null ? incoming.raw_import : (existing.raw_import || null)
    };
  }

  function _sameRecord(a, b) {
    return a.session_date === b.session_date &&
      _canon(a.context) === _canon(b.context) &&
      _canon(a.source_data) === _canon(b.source_data) &&
      _canon(a.raw_import) === _canon(b.raw_import);
  }

  // Where a clean record from the file goes: new, an update, already up to
  // date, or refused (its id belongs to another app's session).
  function _classify(store, rec) {
    var existing = store.loadSession(rec.session_id);
    if (!existing) return { kind: 'new', record: rec };
    if (existing.source !== 'divination') {
      return { kind: 'conflict', reason: 'its id is taken by a ' + existing.source + ' session' };
    }
    var merged = mergeDivinationRecord(existing, rec);
    if (_sameRecord(existing, merged)) return { kind: 'unchanged', record: existing };
    return { kind: 'update', record: merged };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importDivinationFile(fileContent) {
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }

    var format = detectDivinationFormat(obj);
    if (format === 'journal_backup') {
      return { status: 'error', error: 'This is an Aetheria Divination journal backup, not a Tagger export. In Divination, open the Journal and choose “Export for the Session Tagger”.' };
    }
    if (format !== 'tagger_export') {
      return { status: 'error', error: "This doesn't look like an Aetheria Divination export. In Divination, open the Journal and choose “Export for the Session Tagger”." };
    }

    var v = validateDivinationExport(obj);
    if (!v.valid) {
      return { status: 'error', error: _validationErrorMessage(v.errors, obj) };
    }

    // Check each reading; a reading repeated in the file counts once
    // (the one with the latest Mirror answer wins).
    var skipped = [];
    var order = [];
    var byId = {};
    var repeatedCount = 0;
    for (var i = 0; i < obj.sessions.length; i++) {
      var built = buildDivinationRecord(obj.sessions[i]);
      if (built.error) {
        var s = obj.sessions[i];
        var sid = (s && typeof s.session_id === 'string') ? _text(s.session_id, 160) : null;
        skipped.push({ index: i, session_id: sid, reason: built.error });
        continue;
      }
      var rec = built.record;
      var prior = byId[rec.session_id];
      if (prior) {
        repeatedCount++;
        if ((rec.source_data.mirror.answered_at || '') >= (prior.source_data.mirror.answered_at || '')) {
          byId[rec.session_id] = rec;
        }
      } else {
        byId[rec.session_id] = rec;
        order.push(rec.session_id);
      }
    }

    if (!order.length) {
      var first = skipped.length ? skipped[0].reason : 'no readings';
      return {
        status: 'error',
        error: 'None of the ' + obj.sessions.length + ' reading' + (obj.sessions.length !== 1 ? 's' : '') +
          ' in this Divination export could be read (' + first + ').'
      };
    }

    var store = _store();
    var incoming = [];
    var newRecords = [];
    var updatedRecords = [];
    var unchangedCount = 0;
    for (var j = 0; j < order.length; j++) {
      var r = byId[order[j]];
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
      skipped:         skipped,
      skippedCount:    skipped.length,
      repeatedCount:   repeatedCount,
      exportDate:      _iso(obj.exported_at),
      mapVersion:      _text(obj.map_version, 80)
    };
  }

  // Save what an import found, merging against the store as it is now.
  function commitDivinationImport(result) {
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

  // Unicode's Yijing Hexagram Symbols (U+4DC0–U+4DFF) run in King Wen order.
  function hexagramGlyph(n) {
    var k = _int(n, 1, 64);
    return k === null ? '' : String.fromCharCode(0x4DBF + k);
  }

  // Same form as the RCT prescriptions: ☷ #19 Approach
  function hexagramLabel(ref) {
    if (!ref || typeof ref.hexagram !== 'number') return '';
    return '☷ #' + ref.hexagram + (ref.hexagram_name ? ' ' + ref.hexagram_name : '');
  }

  function mirrorTally(records) {
    var hits = 0, misses = 0;
    for (var i = 0; i < (records || []).length; i++) {
      var m = records[i] && records[i].source_data && records[i].source_data.mirror;
      if (!m) continue;
      if (m.status === 'hit') hits++;
      else if (m.status === 'miss') misses++;
    }
    return { answered: hits + misses, hits: hits, misses: misses };
  }

  function sessionDateRange(records) {
    var dates = [];
    for (var i = 0; i < (records || []).length; i++) {
      if (records[i] && records[i].session_date) dates.push(records[i].session_date);
    }
    dates.sort();
    return { first: dates[0] || null, last: dates[dates.length - 1] || null };
  }

  // ─── Internal ─────────────────────────────────────────────────

  function _validationErrorMessage(errors, obj) {
    var first = errors[0];
    if (first === 'unsupported_export_version' || first === 'unsupported_schema_version') {
      return 'This Divination export was made in a newer format (' +
        _text(String(obj.aetheria_export_version), 20) + ', schema ' + _text(String(obj.schema_version), 20) +
        ') than this Tagger reads. Update the Session Tagger and try again.';
    }
    if (first === 'wrong_app') return "This export says it comes from another app, not Aetheria Divination.";
    if (first === 'missing_sessions') return 'This Divination export has no readings list. The file may be damaged.';
    if (first === 'no_sessions') return 'This Divination export holds no readings. Only readings answered in the Honest Mirror are exported.';
    if (first === 'too_many_sessions') return 'This file holds more than ' + MAX_SESSIONS + ' readings, more than the Tagger takes in at once.';
    return 'Divination export validation failed: ' + errors.join('; ');
  }

  // ─── Public API ───────────────────────────────────────────────

  var DivinationImport = {
    EXPORT_TYPE:               EXPORT_TYPE,
    detectDivinationFormat:    detectDivinationFormat,
    validateDivinationExport:  validateDivinationExport,
    buildDivinationRecord:     buildDivinationRecord,
    mergeDivinationRecord:     mergeDivinationRecord,
    mergeNotes:                mergeNotes,
    importDivinationFile:      importDivinationFile,
    commitDivinationImport:    commitDivinationImport,
    isRealDate:                isRealDate,

    // UI helpers
    hexagramGlyph:    hexagramGlyph,
    hexagramLabel:    hexagramLabel,
    mirrorTally:      mirrorTally,
    sessionDateRange: sessionDateRange
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DivinationImport;
  } else {
    root.DivinationImport = DivinationImport;
  }

})(typeof window !== 'undefined' ? window : this);
