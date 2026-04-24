// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Storage Module (Schema v2.0)
// Single source of truth for all session data.
// Backend: IndexedDB for persistence, in-memory cache for sync reads.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────

  var SCHEMA_VERSION     = '2.0';
  var SESSION_KEY_PREFIX  = 'aetheria_tagger:session:';
  var INDEX_KEY           = 'aetheria_tagger:index';
  var SCHEMA_VERSION_KEY  = 'aetheria_tagger:schema_version';
  var DB_NAME             = 'aetheria_tagger';
  var DB_VERSION          = 1;

  var ALLOWED_SOURCES = ['coherence_lab', 'sophia', 'rct', 'manual'];

  // ─── Internal State ───────────────────────────────────────────

  var _db = null;           // IDB database handle (null in tests / before init)
  var _records = {};        // session_id → record (in-memory cache)
  var _index = { schema_version: SCHEMA_VERSION, sessions: [] };

  function _now() { return new Date().toISOString(); }

  // ─── IndexedDB persistence (async, fire-and-forget) ───────────

  function _idbPut(record) {
    if (!_db) return;
    try {
      var tx = _db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(record);
    } catch (e) { /* IDB write failed — data is still in memory */ }
  }

  function _idbDelete(sessionId) {
    if (!_db) return;
    try {
      var tx = _db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').delete(sessionId);
    } catch (e) { /* ignore */ }
  }

  // ─── Init (async — call once before first use in browser) ─────

  function init() {
    if (typeof indexedDB === 'undefined') {
      // Node / test environment — pure in-memory mode
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return resolve(); // fall back to in-memory
      }

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'session_id' });
        }
      };

      req.onsuccess = function (e) {
        _db = e.target.result;
        // Load all records from IDB into memory
        try {
          var tx = _db.transaction('sessions', 'readonly');
          var getAll = tx.objectStore('sessions').getAll();
          getAll.onsuccess = function () {
            var rows = getAll.result || [];
            _records = {};
            for (var i = 0; i < rows.length; i++) {
              _records[rows[i].session_id] = rows[i];
            }
            _rebuildIndexFromMemory();
            // Migrate from localStorage if IDB was empty
            _migrateFromLocalStorage();
            resolve();
          };
          getAll.onerror = function () { resolve(); }; // proceed in-memory
        } catch (e2) {
          resolve(); // proceed in-memory
        }
      };

      req.onerror = function () { resolve(); }; // fall back to in-memory
    });
  }

  // ─── localStorage → IDB migration (runs once inside init) ────

  function _migrateFromLocalStorage() {
    if (typeof localStorage === 'undefined') return;
    if (Object.keys(_records).length > 0) return; // IDB already has data

    var ls = localStorage;
    var migrated = 0;

    // Migrate per-session keys from old localStorage schema
    var keysToRemove = [];
    for (var i = 0; i < ls.length; i++) {
      var key = ls.key(i);
      if (key && key.indexOf(SESSION_KEY_PREFIX) === 0) {
        try {
          var rec = JSON.parse(ls.getItem(key));
          if (rec && rec.session_id) {
            _records[rec.session_id] = rec;
            _idbPut(rec);
            migrated++;
          }
        } catch (e) { /* skip corrupted */ }
        keysToRemove.push(key);
      }
    }

    if (migrated > 0) {
      _rebuildIndexFromMemory();
      // Clean up old localStorage keys
      keysToRemove.forEach(function (k) { try { ls.removeItem(k); } catch (e) {} });
      try { ls.removeItem(INDEX_KEY); } catch (e) {}
      try { ls.removeItem(SCHEMA_VERSION_KEY); } catch (e) {}
    }
  }

  // ─── CRUD: Individual Session Records ─────────────────────────

  function saveSession(record) {
    if (!record || !record.session_id) {
      throw new Error('saveSession: record must have a session_id');
    }
    record.schema_version = SCHEMA_VERSION;
    record.last_edited_at = _now();
    _records[record.session_id] = record;
    updateIndexEntry(record.session_id);
    _idbPut(record);
    return record;
  }

  function loadSession(sessionId) {
    return _records[sessionId] || null;
  }

  function deleteSession(sessionId) {
    delete _records[sessionId];
    removeFromIndex(sessionId);
    _idbDelete(sessionId);
  }

  function listAllSessions() {
    var results = [];
    for (var i = 0; i < _index.sessions.length; i++) {
      var rec = _records[_index.sessions[i].session_id];
      if (rec) results.push(rec);
    }
    return results;
  }

  // ─── Index Operations (purely in-memory) ──────────────────────

  function getIndex() {
    return _index;
  }

  function _buildIndexEntry(sessionId) {
    var rec = _records[sessionId];
    if (!rec) return null;
    return {
      session_id:   rec.session_id,
      source:       rec.source,
      session_date: rec.session_date,
      imported_at:  rec.imported_at,
      summary_line: _generateSummaryLine(rec)
    };
  }

  function _generateSummaryLine(record) {
    if (!record) return '';
    var parts = [];

    if (record.source === 'coherence_lab') {
      var sd = record.source_data || {};
      var summary = sd.summary || {};
      if (typeof summary.peak_bcs === 'number') {
        parts.push('Peak BCS ' + summary.peak_bcs.toFixed(1));
      }
      if (summary.phase_transition_detected) {
        parts.push('Phase Transition \u2713');
      }
      if (typeof summary.peak_tcs === 'number' && !summary.phase_transition_detected) {
        parts.push('TCS ' + summary.peak_tcs.toFixed(1));
      }
      var deficit = summary.deficit_majority || (sd.baseline && sd.baseline.deficit_majority);
      if (deficit) {
        parts.push(deficit + ' deficit');
      }
      if (typeof summary.duration_seconds === 'number' && summary.duration_seconds > 0) {
        parts.push(Math.round(summary.duration_seconds / 60) + ' min');
      }
    } else if (record.source === 'sophia') {
      var src = record.source_data || {};
      var sophSummary = src.summary || {};
      if (sophSummary.dominant_regime) {
        parts.push(sophSummary.dominant_regime);
      }
      if (sophSummary.dominant_geometry) {
        parts.push(sophSummary.dominant_geometry);
      }
      if (src.snapshot_count) {
        parts.push(src.snapshot_count + ' snapshot' + (src.snapshot_count !== 1 ? 's' : ''));
      }
      if (sophSummary.hexagrams_encountered && sophSummary.hexagrams_encountered.length) {
        parts.push('\u2637 #' + sophSummary.hexagrams_encountered[0]);
      }
    } else if (record.source === 'rct') {
      var rsd = record.source_data || {};
      var rParts = [];
      if (typeof rsd.peak_coherence === 'number') rParts.push('Peak ' + rsd.peak_coherence);
      if (typeof rsd.avg_coherence === 'number')  rParts.push('Avg ' + rsd.avg_coherence);
      if (typeof rsd.duration_seconds === 'number') rParts.push(Math.round(rsd.duration_seconds / 60) + ' min');
      var bg = rsd.baseline && rsd.baseline.geometry;
      var eg = rsd.endstate && rsd.endstate.geometry;
      if (bg && eg) {
        var pm = rsd.positions_moved;
        var pmStr = (typeof pm === 'number') ? (' (' + (pm > 0 ? '+' : '') + pm + ')') : '';
        rParts.push(bg + ' \u2192 ' + eg + pmStr);
      }
      return rParts.join(' \u00b7 ');
    } else if (record.source === 'manual') {
      var ctx = record.context || {};
      var msd = record.source_data || {};
      if (ctx.condition) parts.push(ctx.condition);
      if (typeof ctx.mood_before === 'number' && typeof ctx.mood_after === 'number') {
        var delta = ctx.mood_after - ctx.mood_before;
        parts.push('Mood ' + (delta >= 0 ? '+' : '') + delta);
      }
      if (!parts.length) {
        var text = ctx.notes || msd.description || '';
        if (text) parts.push(text.length > 60 ? text.slice(0, 60) + '\u2026' : text);
        if (!parts.length) parts.push('Manual entry');
      }
    }

    return parts.length > 0 ? parts.join(' \u00b7 ') : '';
  }

  function _sortSessions(sessions) {
    sessions.sort(function (a, b) {
      if (a.session_date && b.session_date && a.session_date !== b.session_date) {
        return a.session_date > b.session_date ? -1 : 1;
      }
      return (b.imported_at || '') > (a.imported_at || '') ? 1 : -1;
    });
  }

  function _rebuildIndexFromMemory() {
    var sessions = [];
    for (var id in _records) {
      if (_records.hasOwnProperty(id)) {
        var entry = _buildIndexEntry(id);
        if (entry) sessions.push(entry);
      }
    }
    _sortSessions(sessions);
    _index = { schema_version: SCHEMA_VERSION, sessions: sessions };
  }

  function rebuildIndex() {
    _rebuildIndexFromMemory();
    return _index;
  }

  function updateIndexEntry(sessionId) {
    var entry = _buildIndexEntry(sessionId);
    if (!entry) return;
    var filtered = [];
    for (var i = 0; i < _index.sessions.length; i++) {
      if (_index.sessions[i].session_id !== sessionId) {
        filtered.push(_index.sessions[i]);
      }
    }
    var inserted = false;
    var result = [];
    for (var j = 0; j < filtered.length; j++) {
      if (!inserted) {
        if ((entry.session_date || '') >= (filtered[j].session_date || '')) {
          result.push(entry);
          inserted = true;
        }
      }
      result.push(filtered[j]);
    }
    if (!inserted) result.push(entry);
    _index.sessions = result;
  }

  function removeFromIndex(sessionId) {
    var filtered = [];
    for (var i = 0; i < _index.sessions.length; i++) {
      if (_index.sessions[i].session_id !== sessionId) {
        filtered.push(_index.sessions[i]);
      }
    }
    _index.sessions = filtered;
  }

  // ─── Schema Version + Migration ──────────────────────────────

  function getCurrentSchemaVersion() {
    return SCHEMA_VERSION;
  }

  function migrateIfNeeded() {
    // With IDB backend, migration from localStorage happens in init().
    // This function is kept for API compatibility.
    if (Object.keys(_records).length > 0) {
      return { migrated: false, reason: 'already_current' };
    }
    return { migrated: false, reason: 'clean_install' };
  }

  // ─── Validation ───────────────────────────────────────────────

  function validateRecord(record) {
    var errors = [];

    if (!record || typeof record !== 'object') {
      return { valid: false, errors: ['record must be a non-null object'] };
    }

    var requiredStrings = ['schema_version', 'session_id', 'source', 'imported_at', 'last_edited_at', 'session_date'];
    for (var i = 0; i < requiredStrings.length; i++) {
      var field = requiredStrings[i];
      if (typeof record[field] !== 'string' || record[field] === '') {
        errors.push(field + ' must be a non-empty string');
      }
    }

    if (typeof record.source === 'string' && ALLOWED_SOURCES.indexOf(record.source) === -1) {
      errors.push('source must be one of: ' + ALLOWED_SOURCES.join(', '));
    }

    if (typeof record.session_date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(record.session_date)) {
      errors.push('session_date must be in YYYY-MM-DD format');
    }

    if (!record.context || typeof record.context !== 'object') {
      errors.push('context must be an object');
    } else {
      var contextKeys = ['condition', 'moon', 'sleep', 'mood_before', 'mood_after', 'mood_change', 'pain', 'activity', 'notes'];
      for (var j = 0; j < contextKeys.length; j++) {
        if (!(contextKeys[j] in record.context)) {
          errors.push('context.' + contextKeys[j] + ' is missing');
        }
      }
    }

    if (!record.source_data || typeof record.source_data !== 'object') {
      errors.push('source_data must be an object');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ─── Public API ───────────────────────────────────────────────

  var TaggerStore = {
    // Constants
    SCHEMA_VERSION:     SCHEMA_VERSION,
    SESSION_KEY_PREFIX:  SESSION_KEY_PREFIX,
    INDEX_KEY:           INDEX_KEY,
    SCHEMA_VERSION_KEY:  SCHEMA_VERSION_KEY,
    ALLOWED_SOURCES:     ALLOWED_SOURCES,

    // Async init (call once in browser before first use)
    init: init,

    // CRUD (sync — reads from in-memory cache)
    saveSession:    saveSession,
    loadSession:    loadSession,
    deleteSession:  deleteSession,
    listAllSessions: listAllSessions,

    // Index (sync — in-memory)
    getIndex:         getIndex,
    rebuildIndex:     rebuildIndex,
    updateIndexEntry: updateIndexEntry,
    removeFromIndex:  removeFromIndex,

    // Migration
    getCurrentSchemaVersion: getCurrentSchemaVersion,
    migrateIfNeeded:         migrateIfNeeded,

    // Validation
    validateRecord: validateRecord,

    // Test helper: reset all internal state
    _setStorage: function () {
      _records = {};
      _index = { schema_version: SCHEMA_VERSION, sessions: [] };
      _db = null;
    }
  };

  // UMD export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaggerStore;
  } else {
    root.TaggerStore = TaggerStore;
  }

})(typeof window !== 'undefined' ? window : this);
