// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Sophia Import Module
// Handles Sophia oracle exports with append-or-new session flow.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('SophiaImport: TaggerStore is not available');
    return s;
  }

  // ─── Format Detection ─────────────────────────────────────────

  function detectSophiaFormat(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (typeof obj.exportVersion === 'number' &&
            typeof obj.device === 'string' && obj.device !== '' &&
            typeof obj.deviceType === 'string' && obj.deviceType !== '' &&
            Array.isArray(obj.timeline));
  }

  // ─── Validation ───────────────────────────────────────────────

  function validateSophiaExport(obj) {
    var errors = [];

    if (typeof obj.exportVersion !== 'number') {
      errors.push('missing_export_version');
    }
    if (typeof obj.device !== 'string' || obj.device === '') {
      errors.push('missing_device');
    }
    if (typeof obj.deviceType !== 'string' || obj.deviceType === '') {
      errors.push('missing_device_type');
    }
    if (!Array.isArray(obj.timeline)) {
      errors.push('missing_timeline');
    } else {
      for (var i = 0; i < obj.timeline.length; i++) {
        var entry = obj.timeline[i];
        if (!entry || typeof entry.t !== 'string' || entry.t === '') {
          errors.push('timeline[' + i + '] missing timestamp (t)');
          break; // report first bad entry only
        }
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Snapshot Conversion ──────────────────────────────────────

  var BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];

  function _normalizeBand(v) {
    if (v == null) return null;
    // If > 1, treat as percentage and convert to decimal
    return v > 1 ? v / 100 : v;
  }

  function _dominantWave(bandPowers) {
    var best = null;
    var bestVal = -1;
    for (var i = 0; i < BANDS.length; i++) {
      var v = bandPowers[BANDS[i]];
      if (v != null && v > bestVal) {
        bestVal = v;
        best = BANDS[i];
      }
    }
    return best;
  }

  function convertSnapshot(entry) {
    var bp = {};
    for (var i = 0; i < BANDS.length; i++) {
      bp[BANDS[i]] = _normalizeBand(entry[BANDS[i]]);
    }

    return {
      t:            entry.t,
      position:     entry.pos != null ? entry.pos : null,
      frequency_hz: entry.freq != null ? entry.freq : null,
      regime:       entry.regime || null,
      symbolic: {
        geometry:          entry.geo || null,
        state:             entry.state || null,
        keyword:           entry.keyword || null,
        i_ching_hexagram:  entry.hex != null ? entry.hex : null,
        i_ching_name:      entry.hexName || null
      },
      metrics: {
        coherence:     entry.coherence != null ? entry.coherence : null,
        focus:         entry.focus != null ? entry.focus : null,
        meditation:    entry.meditation != null ? entry.meditation : null,
        dominant_wave: _dominantWave(bp)
      },
      band_powers: bp,
      fnirs:       entry.fnirs || null,
      heart_rate:  entry.heartRate != null ? entry.heartRate : null
    };
  }

  // Strip heavy timeline array from export before storing in raw_import
  function _stripTimeline(sophiaExport) {
    var light = {};
    for (var k in sophiaExport) {
      if (sophiaExport.hasOwnProperty(k) && k !== 'timeline' && k !== 'frequencyReference') {
        light[k] = sophiaExport[k];
      }
    }
    light.timeline_count = (sophiaExport.timeline || []).length;
    return light;
  }

  // ─── Summary Computation ──────────────────────────────────────

  function _modeOf(arr) {
    if (!arr.length) return null;
    var counts = {};
    for (var i = 0; i < arr.length; i++) {
      counts[arr[i]] = (counts[arr[i]] || 0) + 1;
    }
    var best = null;
    var bestN = 0;
    for (var k in counts) {
      if (counts.hasOwnProperty(k) && counts[k] > bestN) {
        bestN = counts[k];
        best = k;
      }
    }
    return best;
  }

  function _mean(arr) {
    if (!arr.length) return null;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return Math.round(sum / arr.length * 10) / 10;
  }

  function computeSophiaSummary(snapshots) {
    var regimes = [];
    var geometries = [];
    var hexSet = {};
    var cohVals = [];
    var focVals = [];
    var medVals = [];

    for (var i = 0; i < snapshots.length; i++) {
      var s = snapshots[i];
      if (s.regime) regimes.push(s.regime);
      if (s.symbolic && s.symbolic.geometry) geometries.push(s.symbolic.geometry);
      if (s.symbolic && s.symbolic.i_ching_hexagram != null) {
        hexSet[s.symbolic.i_ching_hexagram] = true;
      }
      if (s.metrics) {
        if (s.metrics.coherence != null) cohVals.push(s.metrics.coherence);
        if (s.metrics.focus != null) focVals.push(s.metrics.focus);
        if (s.metrics.meditation != null) medVals.push(s.metrics.meditation);
      }
    }

    var hexNums = [];
    for (var h in hexSet) {
      if (hexSet.hasOwnProperty(h)) hexNums.push(Number(h));
    }
    hexNums.sort(function (a, b) { return a - b; });

    return {
      dominant_regime:       _modeOf(regimes),
      dominant_geometry:     _modeOf(geometries),
      hexagrams_encountered: hexNums,
      mean_coherence:        _mean(cohVals),
      peak_coherence:        cohVals.length ? Math.max.apply(null, cohVals) : null,
      mean_focus:            _mean(focVals),
      mean_meditation:       _mean(medVals)
    };
  }

  // ─── Merge + Dedup ────────────────────────────────────────────

  function mergeSnapshots(existing, incoming) {
    var byT = {};
    var all = existing.concat(incoming);
    var result = [];
    for (var i = 0; i < all.length; i++) {
      var key = all[i].t;
      if (!byT[key]) {
        byT[key] = true;
        result.push(all[i]);
      }
    }
    result.sort(function (a, b) {
      return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
    });
    return result;
  }

  // ─── Recent Sessions ──────────────────────────────────────────

  function findRecentSophiaSessions(windowHours) {
    if (windowHours == null) windowHours = 48;
    var store = _store();
    var all = store.listAllSessions();
    var cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
    var results = [];

    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r.source !== 'sophia') continue;
      var sd = r.source_data || {};
      var lastSnap = sd.last_snapshot_at || r.imported_at || '';
      if (lastSnap >= cutoff) {
        results.push(r);
      }
    }

    // Sort most recent first
    results.sort(function (a, b) {
      var aLast = (a.source_data || {}).last_snapshot_at || a.imported_at || '';
      var bLast = (b.source_data || {}).last_snapshot_at || b.imported_at || '';
      return bLast > aLast ? 1 : bLast < aLast ? -1 : 0;
    });

    return results;
  }

  // ─── Build New Record ─────────────────────────────────────────

  function _sessionDate(isoStr) {
    if (!isoStr) return 'unknown';
    var d = new Date(isoStr);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function buildNewSophiaRecord(sophiaExport) {
    var now = new Date().toISOString();
    var snapshots = [];
    for (var i = 0; i < sophiaExport.timeline.length; i++) {
      snapshots.push(convertSnapshot(sophiaExport.timeline[i]));
    }

    var firstT = snapshots.length ? snapshots[0].t : now;
    var lastT  = snapshots.length ? snapshots[snapshots.length - 1].t : now;

    // Sanitize device name for use in session_id
    var deviceClean = (sophiaExport.device || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    var sessionId = 'sophia_' + deviceClean + '_' + firstT.replace(/[:.]/g, '-');

    var summary = computeSophiaSummary(snapshots);

    return {
      schema_version: '2.0',
      session_id:     sessionId,
      source:         'sophia',
      imported_at:    now,
      last_edited_at: now,
      session_date:   _sessionDate(firstT),
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
        device:            sophiaExport.device,
        device_type:       sophiaExport.deviceType,
        snapshot_count:    snapshots.length,
        first_snapshot_at: firstT,
        last_snapshot_at:  lastT,
        snapshots:         snapshots,
        summary:           summary
      },
      // Store lightweight raw_import — omit timeline (already converted to snapshots)
      raw_import: [_stripTimeline(sophiaExport)]
    };
  }

  // ─── Append to Existing ───────────────────────────────────────

  function appendToSophiaRecord(existingRecord, sophiaExport) {
    var newSnapshots = [];
    for (var i = 0; i < sophiaExport.timeline.length; i++) {
      newSnapshots.push(convertSnapshot(sophiaExport.timeline[i]));
    }

    var sd = existingRecord.source_data || {};
    var merged = mergeSnapshots(sd.snapshots || [], newSnapshots);
    var summary = computeSophiaSummary(merged);

    var firstT = merged.length ? merged[0].t : sd.first_snapshot_at;
    var lastT  = merged.length ? merged[merged.length - 1].t : sd.last_snapshot_at;

    var rawImport = Array.isArray(existingRecord.raw_import)
      ? existingRecord.raw_import.concat([_stripTimeline(sophiaExport)])
      : [_stripTimeline(sophiaExport)];

    // Build updated record (preserve session_id, imported_at, context)
    return {
      schema_version: '2.0',
      session_id:     existingRecord.session_id,
      source:         'sophia',
      imported_at:    existingRecord.imported_at,
      last_edited_at: new Date().toISOString(),
      session_date:   existingRecord.session_date,
      context:        existingRecord.context,
      source_data: {
        device:            sd.device || sophiaExport.device,
        device_type:       sd.device_type || sophiaExport.deviceType,
        snapshot_count:    merged.length,
        first_snapshot_at: firstT,
        last_snapshot_at:  lastT,
        snapshots:         merged,
        summary:           summary
      },
      raw_import: rawImport
    };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importSophiaFile(fileContent) {
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }

    if (!detectSophiaFormat(obj)) {
      return { status: 'error', error: "This doesn't look like a Sophia export. Make sure it's exported from Sophia." };
    }

    var v = validateSophiaExport(obj);
    if (!v.valid) {
      return { status: 'error', error: _validationErrorMessage(v.errors) };
    }

    var recent = findRecentSophiaSessions(48);

    return {
      status:         'ok',
      parsedExport:   obj,
      recentSessions: recent.slice(0, 5) // at most 5
    };
  }

  // ─── UI Helpers ───────────────────────────────────────────────

  function formatDeviceName(deviceType) {
    if (!deviceType) return '';
    var dt = deviceType.toLowerCase();
    if (dt === 'athena') return 'Muse S Athena';
    if (dt === 'muse2') return 'Muse 2';
    if (dt === 'muses') return 'Muse S';
    return deviceType;
  }

  function sessionSummaryLabel(record) {
    var sd = record.source_data || {};
    var parts = [];
    parts.push((sd.snapshot_count || 0) + ' snapshot' + ((sd.snapshot_count || 0) !== 1 ? 's' : ''));
    var summary = sd.summary || {};
    if (summary.dominant_regime) parts.push(summary.dominant_regime);
    if (summary.dominant_geometry) parts.push(summary.dominant_geometry);
    return parts.join(' \u00b7 ');
  }

  function sessionTimeLabel(record) {
    var sd = record.source_data || {};
    var t = sd.first_snapshot_at || record.imported_at;
    if (!t) return 'Unknown time';
    var d = new Date(t);
    return 'Sophia ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ─── Internal ─────────────────────────────────────────────────

  function _validationErrorMessage(errors) {
    var first = errors[0];
    if (first === 'missing_export_version') return 'Sophia export is missing exportVersion.';
    if (first === 'missing_device') return 'Sophia export is missing device identifier.';
    if (first === 'missing_device_type') return 'Sophia export is missing deviceType.';
    if (first === 'missing_timeline') return 'Sophia export is missing timeline data.';
    if (first && first.indexOf('timeline[') === 0) return 'Sophia export has invalid timeline entry: ' + first;
    return 'Sophia export validation failed: ' + errors.join(', ');
  }

  // ─── Public API ───────────────────────────────────────────────

  var SophiaImport = {
    detectSophiaFormat:       detectSophiaFormat,
    validateSophiaExport:     validateSophiaExport,
    convertSnapshot:          convertSnapshot,
    computeSophiaSummary:     computeSophiaSummary,
    mergeSnapshots:           mergeSnapshots,
    findRecentSophiaSessions: findRecentSophiaSessions,
    buildNewSophiaRecord:     buildNewSophiaRecord,
    appendToSophiaRecord:     appendToSophiaRecord,
    importSophiaFile:         importSophiaFile,

    // UI helpers
    formatDeviceName:    formatDeviceName,
    sessionSummaryLabel: sessionSummaryLabel,
    sessionTimeLabel:    sessionTimeLabel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SophiaImport;
  } else {
    root.SophiaImport = SophiaImport;
  }

})(typeof window !== 'undefined' ? window : this);
