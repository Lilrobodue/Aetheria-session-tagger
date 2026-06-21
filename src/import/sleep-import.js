// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Sleep Import Module
// Handles single-session sleep summaries exported from Aetheria RCT
// (Muse S "Athena" overnight staging). The export reuses the
// `session_summary_for_tagger` envelope but is distinguished by
// `session_type: "sleep"`. One file = one Tagger record.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  function _store() {
    var s = (typeof root !== 'undefined' && root.TaggerStore) ||
            (typeof require === 'function' && require('../storage/tagger-store'));
    if (!s) throw new Error('SleepImport: TaggerStore is not available');
    return s;
  }

  // ─── Format Detection ─────────────────────────────────────────
  // Must be checked BEFORE the Coherence Lab detector, which matches
  // any `session_summary_for_tagger` envelope regardless of type.

  function detectSleepFormat(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return obj.export_type === 'session_summary_for_tagger' &&
           obj.session_type === 'sleep';
  }

  // ─── Validation ───────────────────────────────────────────────

  function validateSleepExport(obj) {
    var errors = [];
    if (obj.session_type !== 'sleep') {
      errors.push('session_type must be "sleep"');
    }
    if (!obj.metadata || typeof obj.metadata !== 'object' ||
        !obj.metadata.sessionId || typeof obj.metadata.sessionId !== 'string') {
      errors.push('metadata.sessionId must be a non-empty string');
    }
    if (!obj.summary || typeof obj.summary !== 'object') {
      errors.push('summary must be an object');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  function sessionIdFor(obj) {
    var meta = obj.metadata || {};
    var id = meta.sessionId ? String(meta.sessionId) : '';
    return 'sleep_' + id.replace(/[:.]/g, '-');
  }

  function _sessionDate(obj) {
    // Prefer the tagger_row date (already local-day formatted by the
    // exporter); fall back to deriving from the session start time.
    var tr = obj.tagger_row || {};
    if (typeof tr.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tr.date)) {
      return tr.date;
    }
    var meta = obj.metadata || {};
    var iso = meta.startTime || (obj.session && obj.session.startTime);
    if (!iso) return 'unknown';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'unknown';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function _round1(n) { return Math.round(n * 10) / 10; }

  // ─── Build Tagger Record ──────────────────────────────────────

  function buildSleepRecord(obj) {
    var now = new Date().toISOString();
    var meta = obj.metadata || {};
    var ses = obj.session || {};
    var summary = obj.summary || {};
    var sleep = obj.sleep || {};

    var durationSeconds = (ses.duration_seconds != null)
      ? ses.duration_seconds
      : (summary.duration_minutes != null ? Math.round(summary.duration_minutes * 60) : null);

    // Pre-fill the context "Sleep (hours)" field from measured sleep time.
    var sleepHours = (typeof summary.total_sleep_minutes === 'number')
      ? _round1(summary.total_sleep_minutes / 60)
      : null;

    return {
      schema_version: '2.0',
      session_id:     sessionIdFor(obj),
      source:         'sleep',
      imported_at:    now,
      last_edited_at: now,
      session_date:   _sessionDate(obj),
      context: {
        condition:   '',
        moon:        'unknown',
        sleep:       sleepHours,
        mood_before: null,
        mood_after:  null,
        mood_change: null,
        pain:        null,
        activity:    '',
        notes:       ''
      },
      source_data: {
        session_type:        'sleep',
        device:              meta.device || ses.device || null,
        software_version:    meta.softwareVersion || ses.softwareVersion || null,
        start_time:          meta.startTime || ses.startTime || null,
        end_time:            meta.endTime || ses.endTime || null,
        duration_seconds:    durationSeconds,
        epoch_seconds:       sleep.epoch_seconds != null ? sleep.epoch_seconds : null,
        staging_note:        sleep.staging_note || null,
        sleep_stages:        sleep.stages || null,
        summary:             summary,
        time_series:         obj.time_series || null,
        tagger_row:          obj.tagger_row || null
      },
      raw_import: obj
    };
  }

  // ─── Top-Level Import Orchestration ───────────────────────────

  function importSleepFile(fileContent) {
    var obj;
    try {
      obj = JSON.parse(fileContent);
    } catch (e) {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!obj || typeof obj !== 'object') {
      return { status: 'error', error: "That file couldn't be read as JSON." };
    }
    if (!detectSleepFormat(obj)) {
      return { status: 'error', error: "This doesn't look like an Aetheria sleep export." };
    }

    var v = validateSleepExport(obj);
    if (!v.valid) {
      return { status: 'error', error: 'Sleep export validation failed: ' + v.errors.join('; ') };
    }

    var record = buildSleepRecord(obj);
    var store = _store();
    var existing = store.loadSession(record.session_id);
    if (existing) {
      return { status: 'duplicate', record: record, existingRecord: existing };
    }
    return { status: 'ok', record: record };
  }

  // ─── Public API ───────────────────────────────────────────────

  var SleepImport = {
    detectSleepFormat:  detectSleepFormat,
    validateSleepExport: validateSleepExport,
    buildSleepRecord:   buildSleepRecord,
    importSleepFile:    importSleepFile,
    sessionIdFor:       sessionIdFor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SleepImport;
  } else {
    root.SleepImport = SleepImport;
  }

})(typeof window !== 'undefined' ? window : this);
