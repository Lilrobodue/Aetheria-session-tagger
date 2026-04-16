// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — RCT Import Module
// Handles bulk exports from Aetheria Resonant Coherence Training.
// Unlike Coherence Lab / Sophia, one file contains N sessions;
// each becomes its own Tagger record.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('RCTImport: TaggerStore is not available');
    return s;
  }

  // ─── Format Detection ─────────────────────────────────────────

  function detectRCTFormat(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (obj.system === 'Aetheria Resonant Coherence Training' &&
            Array.isArray(obj.sessions) &&
            Array.isArray(obj.frequencies));
  }

  // ─── Validation ───────────────────────────────────────────────

  function validateRCTExport(obj) {
    var errors = [];

    if (obj.system !== 'Aetheria Resonant Coherence Training') {
      errors.push('system must be "Aetheria Resonant Coherence Training"');
    }
    if (!Array.isArray(obj.sessions)) {
      errors.push('sessions must be an array');
    } else if (obj.sessions.length === 0) {
      errors.push('sessions array must have at least 1 entry');
    } else {
      for (var i = 0; i < obj.sessions.length; i++) {
        var s = obj.sessions[i];
        if (!s || typeof s !== 'object') {
          errors.push('sessions[' + i + '] is not an object');
          break;
        }
        if (typeof s.date !== 'string' || s.date === '') {
          errors.push('sessions[' + i + '].date must be a non-empty string');
          break;
        }
        if (typeof s.avgCoh !== 'number') {
          errors.push('sessions[' + i + '].avgCoh must be a number');
          break;
        }
        if (typeof s.peakCoh !== 'number') {
          errors.push('sessions[' + i + '].peakCoh must be a number');
          break;
        }
        if (typeof s.duration !== 'number') {
          errors.push('sessions[' + i + '].duration must be a number');
          break;
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  function sessionIdFor(rctSession) {
    // "2026-04-05T01:43:11.083Z" → "rct_2026-04-05T01-43-11-083Z"
    var d = rctSession && rctSession.date ? String(rctSession.date) : '';
    return 'rct_' + d.replace(/[:.]/g, '-');
  }

  function _sessionDate(isoStr) {
    if (!isoStr) return 'unknown';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'unknown';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function _findFreq(frequencyTable, freq) {
    if (!Array.isArray(frequencyTable)) return null;
    for (var i = 0; i < frequencyTable.length; i++) {
      if (frequencyTable[i] && frequencyTable[i].freq === freq) return frequencyTable[i];
    }
    return null;
  }

  // ─── Build Tagger Record ──────────────────────────────────────

  function buildRCTSessionRecord(rctSession, frequencyTable) {
    var now = new Date().toISOString();
    var baseline = rctSession.baseline || {};
    var endstate = rctSession.endstate || {};
    var rxFreqs = Array.isArray(rctSession.rxFreqs) ? rctSession.rxFreqs : [];

    var prescriptionsDetail = rxFreqs.map(function (freq) {
      var entry = _findFreq(frequencyTable, freq);
      if (!entry) return { freq: freq };
      return {
        freq: freq,
        position: entry.position,
        keyword: entry.keyword,
        script: entry.script,
        geometry: entry.geometry,
        hexagram: entry.hexagram,
        hexagram_name: entry.hexagram_name
      };
    });

    return {
      schema_version: '2.0',
      session_id:     sessionIdFor(rctSession),
      source:         'rct',
      imported_at:    now,
      last_edited_at: now,
      session_date:   _sessionDate(rctSession.date),
      context: {
        condition:   '',
        moon:        'unknown',
        sleep:       null,
        mood_before: null,
        mood_after:  null,
        mood_change: null,
        pain:        null,
        activity:    '',
        notes:       ''
      },
      source_data: {
        avg_coherence:    rctSession.avgCoh,
        peak_coherence:   rctSession.peakCoh,
        duration_seconds: rctSession.duration,
        baseline: {
          position:      baseline.pos,
          dominant_wave: baseline.dom,
          coherence:     baseline.coh,
          frequency_hz:  rctSession.baseline_freq,
          geometry:      rctSession.baseline_geo
        },
        endstate: {
          position:      endstate.pos,
          dominant_wave: endstate.dom,
          coherence:     endstate.coh,
          frequency_hz:  rctSession.endstate_freq,
          geometry:      rctSession.endstate_geo
        },
        positions_moved:       rctSession.positions_moved,
        prescriptions_played:  rxFreqs,
        prescriptions_count:   rxFreqs.length,
        prescriptions_detail:  prescriptionsDetail
      },
      raw_import: rctSession
    };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importRCTFile(fileContent) {
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }

    if (!detectRCTFormat(obj)) {
      return { status: 'error', error: "This doesn't look like an RCT export. Make sure it's exported from Aetheria RCT." };
    }

    var v = validateRCTExport(obj);
    if (!v.valid) {
      return { status: 'error', error: _validationErrorMessage(v.errors) };
    }

    var store = _store();
    var frequencyTable = obj.frequencies || [];
    var allRecords = [];
    var newRecords = [];
    var duplicateCount = 0;

    for (var i = 0; i < obj.sessions.length; i++) {
      var rec = buildRCTSessionRecord(obj.sessions[i], frequencyTable);
      allRecords.push(rec);
      if (store.loadSession(rec.session_id)) {
        duplicateCount++;
      } else {
        newRecords.push(rec);
      }
    }

    return {
      status:         'ok',
      sessions:       allRecords,
      newSessions:    newRecords,
      duplicateCount: duplicateCount,
      newCount:       newRecords.length,
      totalCount:     allRecords.length,
      frequencyTable: frequencyTable,
      exportDate:     obj.export_date || null,
      version:        obj.version || null
    };
  }

  // ─── UI / Summary Helpers ─────────────────────────────────────

  function sessionDateRange(sessions) {
    if (!sessions || !sessions.length) return { first: null, last: null };
    var dates = [];
    for (var i = 0; i < sessions.length; i++) {
      var d = sessions[i].session_date || (sessions[i].raw_import && sessions[i].raw_import.date);
      if (d) dates.push(sessions[i].session_date || _sessionDate(sessions[i].raw_import.date));
    }
    dates.sort();
    return { first: dates[0] || null, last: dates[dates.length - 1] || null };
  }

  function aggregateStats(records) {
    if (!records || !records.length) {
      return { count: 0, totalSeconds: 0, peakCoherence: null, peakRecord: null, avgPositionsMoved: 0 };
    }
    var total = 0;
    var peak = -Infinity;
    var peakRec = null;
    var posSum = 0;
    var posN = 0;
    for (var i = 0; i < records.length; i++) {
      var sd = records[i].source_data || {};
      if (typeof sd.duration_seconds === 'number') total += sd.duration_seconds;
      if (typeof sd.peak_coherence === 'number' && sd.peak_coherence > peak) {
        peak = sd.peak_coherence;
        peakRec = records[i];
      }
      if (typeof sd.positions_moved === 'number') {
        posSum += sd.positions_moved;
        posN++;
      }
    }
    return {
      count:             records.length,
      totalSeconds:      total,
      peakCoherence:     peak === -Infinity ? null : peak,
      peakRecord:        peakRec,
      avgPositionsMoved: posN ? (posSum / posN) : 0
    };
  }

  // ─── Internal ─────────────────────────────────────────────────

  function _validationErrorMessage(errors) {
    return 'RCT export validation failed: ' + errors.join('; ');
  }

  // ─── Public API ───────────────────────────────────────────────

  var RCTImport = {
    detectRCTFormat:       detectRCTFormat,
    validateRCTExport:     validateRCTExport,
    buildRCTSessionRecord: buildRCTSessionRecord,
    importRCTFile:         importRCTFile,
    sessionIdFor:          sessionIdFor,
    sessionDateRange:      sessionDateRange,
    aggregateStats:        aggregateStats
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RCTImport;
  } else {
    root.RCTImport = RCTImport;
  }

})(typeof window !== 'undefined' ? window : this);
