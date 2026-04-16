// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Coherence Lab Import Module
// Handles structured exports (Format A) and native saves (Format B)
// from the Aetheria Coherence Lab.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // Dependency: TaggerStore must be loaded first
  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('CoherenceLabImport: TaggerStore is not available');
    return s;
  }

  // ─── Format Detection ─────────────────────────────────────────

  function detectCoherenceLabFormat(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.aetheria_export_version &&
        obj.export_type === 'session_summary_for_tagger') {
      return 'structured_export';
    }
    if (obj.streams && typeof obj.streams === 'object' &&
        obj.metadata && typeof obj.metadata.sessionId === 'string') {
      return 'native_save';
    }
    return null;
  }

  // ─── Validation ───────────────────────────────────────────────

  function validateStructuredExport(obj) {
    var errors = [];
    if (!obj.metadata || typeof obj.metadata !== 'object' ||
        !obj.metadata.sessionId || typeof obj.metadata.sessionId !== 'string') {
      errors.push('structured_missing_session_id');
    }
    if (!obj.time_series || typeof obj.time_series !== 'object') {
      errors.push('structured_missing_time_series');
    }
    if (!obj.summary || typeof obj.summary !== 'object') {
      errors.push('structured_missing_summary');
    }
    if (!Array.isArray(obj.state_transitions)) {
      errors.push('structured_missing_state_transitions');
    }
    if (!Array.isArray(obj.prescriptions)) {
      errors.push('structured_missing_prescriptions');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function validateNativeSave(obj) {
    var errors = [];
    if (!obj.metadata || typeof obj.metadata !== 'object' ||
        !obj.metadata.sessionId || typeof obj.metadata.sessionId !== 'string') {
      errors.push('native_missing_session_id');
    }
    if (!obj.streams || typeof obj.streams !== 'object') {
      errors.push('native_missing_streams');
    } else if (!Array.isArray(obj.streams.coherence)) {
      errors.push('native_missing_coherence');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Native → Canonical Conversion ────────────────────────────

  function convertNativeToCanonical(nativeObj) {
    var meta = nativeObj.metadata;
    var streams = nativeObj.streams;
    var startMs = meta.startTime ? new Date(meta.startTime).getTime() : null;
    var endMs   = meta.endTime   ? new Date(meta.endTime).getTime()   : null;
    var durationSec = (startMs && endMs) ? Math.round((endMs - startMs) / 1000) : 0;

    var session = {
      sessionId:       meta.sessionId,
      startTime:       meta.startTime,
      endTime:         meta.endTime,
      duration_seconds: durationSec,
      softwareVersion: meta.softwareVersion || '1.0.0'
    };

    var coh    = streams.coherence    || [];
    var bcsArr = streams.bcs          || [];
    var st     = streams.state        || [];
    var rx     = streams.prescription || [];

    // Time series: flatten arrays-of-objects into columnar flat arrays
    var time_series = {
      coherence_t:     coh.map(function (c) { return c.t; }),
      coherence_tcs:   coh.map(function (c) { return c.tcs; }),
      coherence_gut:   coh.map(function (c) { return c.gut; }),
      coherence_heart: coh.map(function (c) { return c.heart; }),
      coherence_head:  coh.map(function (c) { return c.head; }),
      coherence_plv:   coh.map(function (c) { return c.plv; }),
      coherence_harm:  coh.map(function (c) { return c.harm; }),
      bcs_t:               bcsArr.map(function (b) { return b.t; }),
      bcs_value:           bcsArr.map(function (b) { return b.bcs; }),
      bcs_kuramoto:        bcsArr.map(function (b) { return b.kuramoto; }),
      bcs_shared_energy:   bcsArr.map(function (b) { return b.sharedEnergy; }),
      bcs_mutual_info:     bcsArr.map(function (b) { return b.mutualInfo; }),
      bcs_phase_transition: bcsArr.map(function (b) { return b.phaseTransition; })
    };

    // Compute summary from raw streams
    var tcsVals  = coh.map(function (c) { return c.tcs; }).filter(function (v) { return v != null; });
    var peakTCS  = tcsVals.length ? _round1(Math.max.apply(null, tcsVals)) : null;
    var meanTCS  = tcsVals.length ? _round1(_mean(tcsVals)) : null;

    var bcsVals  = bcsArr.map(function (b) { return b.bcs; }).filter(function (v) { return v != null; });
    var peakBCS  = bcsVals.length ? _round1(Math.max.apply(null, bcsVals)) : null;
    var meanBCS  = bcsVals.length ? _round1(_mean(bcsVals)) : null;

    var ptEntry  = null;
    for (var i = 0; i < bcsArr.length; i++) {
      if (bcsArr[i].phaseTransition === true) { ptEntry = bcsArr[i]; break; }
    }

    var harmVals     = coh.map(function (c) { return c.harm; }).filter(function (v) { return v != null; });
    var harmOneCount = 0;
    for (var j = 0; j < coh.length; j++) {
      if (coh[j].harm === 1.0) harmOneCount++;
    }
    var harmMean = harmVals.length ? _round3(_mean(harmVals)) : 0;

    var cascadeFlips = 0;
    for (var k = 0; k < st.length; k++) {
      if (st[k].reason && st[k].reason.toLowerCase().indexOf('flipped') !== -1) cascadeFlips++;
    }

    var rxPlayed = 0;
    for (var m = 0; m < rx.length; m++) {
      if (rx[m].action === 'play') rxPlayed++;
    }

    var closingType = 'user_stopped';
    for (var n = 0; n < st.length; n++) {
      if (st[n].to === 'CLOSING') { closingType = 'graceful'; break; }
    }

    var summary = {
      peak_tcs:                    peakTCS,
      mean_tcs:                    meanTCS,
      peak_bcs:                    peakBCS,
      mean_bcs:                    meanBCS,
      phase_transition_detected:   !!ptEntry,
      phase_transition_time_seconds: ptEntry ? ptEntry.t : null,
      harm_one_count:              harmOneCount,
      harm_mean:                   harmMean,
      cascade_flips:               cascadeFlips,
      prescriptions_count:         rxPlayed,
      closing_type:                closingType
    };

    return {
      aetheria_export_version: '1.0',
      export_type:             'session_summary_for_tagger',
      exported_at:             new Date().toISOString(),
      metadata:                meta,
      session:                 session,
      summary:                 summary,
      time_series:             time_series,
      state_transitions:       st,
      prescriptions:           rx
    };
  }

  // ─── Build Tagger Record ──────────────────────────────────────

  function buildSessionRecord(structuredExport, sourceFormat) {
    var meta      = structuredExport.metadata;
    var summary   = structuredExport.summary || {};
    var rx        = structuredExport.prescriptions || [];
    var now       = new Date().toISOString();

    // Derive session_date from metadata.startTime
    var sessionDate = 'unknown';
    if (meta && meta.startTime) {
      var d = new Date(meta.startTime);
      sessionDate = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }

    // Extract prescriptions_played list
    var prescriptionsPlayed = [];
    for (var i = 0; i < rx.length; i++) {
      if (rx[i].action === 'play') {
        prescriptionsPlayed.push(rx[i]);
      }
    }

    return {
      schema_version: '2.0',
      session_id:     meta.sessionId,
      source:         'coherence_lab',
      imported_at:    now,
      last_edited_at: now,
      session_date:   sessionDate,
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
        summary:              summary,
        prescriptions_played: prescriptionsPlayed
      },
      raw_import: structuredExport
    };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importCoherenceLabFile(fileContent) {
    // 1. Parse JSON
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON.", record: null, isDuplicate: false, existingRecord: null };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON.", record: null, isDuplicate: false, existingRecord: null };
    }

    // 2. Detect format
    var format = detectCoherenceLabFormat(obj);
    if (!format) {
      return { status: 'error', error: "This doesn't look like a Coherence Lab session. Make sure it's exported from the Lab.", record: null, isDuplicate: false, existingRecord: null };
    }

    // 3. Validate per format
    var canonical;
    if (format === 'structured_export') {
      var v = validateStructuredExport(obj);
      if (!v.valid) {
        return { status: 'error', error: _validationErrorMessage(format, v.errors), record: null, isDuplicate: false, existingRecord: null };
      }
      canonical = obj;
    } else {
      var v2 = validateNativeSave(obj);
      if (!v2.valid) {
        return { status: 'error', error: _validationErrorMessage(format, v2.errors), record: null, isDuplicate: false, existingRecord: null };
      }
      // 4. Convert native to canonical
      canonical = convertNativeToCanonical(obj);
    }

    // 5. Build the tagger record
    var record = buildSessionRecord(canonical, format);

    // 6. Check for existing session
    var store = _store();
    var existing = store.loadSession(record.session_id);
    if (existing) {
      return { status: 'duplicate', record: record, isDuplicate: true, existingRecord: existing };
    }

    return { status: 'ok', record: record, isDuplicate: false, existingRecord: null };
  }

  // ─── Summary Helpers (for UI display) ─────────────────────────

  function computeSessionSummary(record) {
    var summary = {};
    var session = null;
    var meta    = null;

    // Support both v2.0 records and raw canonical exports
    if (record.raw_import) {
      summary = record.raw_import.summary || record.source_data && record.source_data.summary || {};
      session = record.raw_import.session;
      meta    = record.raw_import.metadata;
    } else if (record.summary) {
      // Direct canonical export object
      summary = record.summary;
      session = record.session;
      meta    = record.metadata;
    } else if (record.source_data && record.source_data.summary) {
      summary = record.source_data.summary;
    }

    return {
      durationSec:   session ? (session.duration_seconds || 0) : 0,
      peakTCS:       summary.peak_tcs != null ? summary.peak_tcs : null,
      meanTCS:       summary.mean_tcs != null ? summary.mean_tcs : null,
      peakBCS:       summary.peak_bcs != null ? summary.peak_bcs : null,
      meanBCS:       summary.mean_bcs != null ? summary.mean_bcs : null,
      ptDetected:    !!summary.phase_transition_detected,
      ptTime:        summary.phase_transition_time_seconds != null ? summary.phase_transition_time_seconds : null,
      harmonicLocks: summary.harm_one_count || 0,
      cascadeFlips:  summary.cascade_flips || 0,
      rxPlayed:      summary.prescriptions_count || 0,
      closingType:   summary.closing_type || 'user_stopped',
      metadata:      meta
    };
  }

  function formatPtTime(t, meta) {
    if (t == null) return '?';
    if (t > 1e10 && meta && meta.startTime) {
      return Math.round((t - new Date(meta.startTime).getTime()) / 1000);
    }
    return Math.round(t);
  }

  function labSessionDate(meta) {
    if (!meta || !meta.startTime) return 'unknown';
    var d = new Date(meta.startTime);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ─── Internal Helpers ─────────────────────────────────────────

  function _mean(arr) {
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function _round1(v) { return Math.round(v * 10) / 10; }
  function _round3(v) { return Math.round(v * 1000) / 1000; }

  function _validationErrorMessage(format, errors) {
    var first = errors[0];
    if (format === 'structured_export') {
      if (first === 'structured_missing_session_id')
        return 'This file appears to be a tagger export but is missing metadata.sessionId. The file may be corrupted.';
      if (first === 'structured_missing_time_series')
        return 'This file appears to be a tagger export but has no time_series data.';
      if (first === 'structured_missing_summary')
        return 'This file appears to be a tagger export but has no summary data.';
      return 'This file appears to be a tagger export but is missing required fields: ' + errors.join(', ');
    }
    if (first === 'native_missing_session_id')
      return 'This file appears to be a native Lab session but is missing metadata.sessionId. The file may be corrupted.';
    if (first === 'native_missing_streams')
      return 'This file appears to be a native Lab session but has no streams data.';
    if (first === 'native_missing_coherence')
      return 'This file appears to be a native Lab session but has no coherence data in streams.';
    return 'This file appears to be a native Lab session but is missing required fields: ' + errors.join(', ');
  }

  // ─── Public API ───────────────────────────────────────────────

  var CoherenceLabImport = {
    detectCoherenceLabFormat: detectCoherenceLabFormat,
    validateStructuredExport: validateStructuredExport,
    validateNativeSave:       validateNativeSave,
    convertNativeToCanonical: convertNativeToCanonical,
    buildSessionRecord:       buildSessionRecord,
    importCoherenceLabFile:   importCoherenceLabFile,

    // UI helpers
    computeSessionSummary: computeSessionSummary,
    formatPtTime:          formatPtTime,
    labSessionDate:        labSessionDate
  };

  // UMD export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoherenceLabImport;
  } else {
    root.CoherenceLabImport = CoherenceLabImport;
  }

})(typeof window !== 'undefined' ? window : this);
