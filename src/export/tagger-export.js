// ═══════════════════════════════════════════════════════════════
// AETHERIA SESSION TAGGER — Export Module
// CSV and JSON export for all session sources.
// ═══════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ─── CSV Helpers ──────────────────────────────────────────────

  function _csvVal(v) {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return _csvVal(v.join(';'));
    var s = String(v);
    if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function _csvRow(vals) {
    return vals.map(_csvVal).join(',');
  }

  function _buildCsv(headers, rows) {
    var lines = [_csvRow(headers)];
    for (var i = 0; i < rows.length; i++) {
      lines.push(_csvRow(rows[i]));
    }
    return lines.join('\n');
  }

  function _ctx(rec, key) {
    return rec.context ? rec.context[key] : null;
  }

  function _ctxRow(rec) {
    return [
      _ctx(rec, 'condition'),
      _ctx(rec, 'moon'),
      _ctx(rec, 'sleep'),
      _ctx(rec, 'mood_before'),
      _ctx(rec, 'mood_after'),
      _ctx(rec, 'mood_change'),
      _ctx(rec, 'pain'),
      _ctx(rec, 'activity'),
      _ctx(rec, 'notes'),
      _ctx(rec, 'walk_type'),
      _ctx(rec, 'dominant_regime'),
      _ctx(rec, 'duration_minutes'),
      _ctx(rec, 'coherence_score'),
      _ctx(rec, 'classification')
    ];
  }

  var CTX_HEADERS = [
    'condition', 'moon', 'sleep',
    'mood_before', 'mood_after', 'mood_change',
    'pain', 'activity', 'notes',
    'walk_type', 'dominant_regime', 'duration_minutes', 'coherence_score', 'classification'
  ];

  // ─── Coherence Lab CSV ────────────────────────────────────────

  var LAB_HEADERS = [
    'session_id', 'session_date', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    'duration_sec', 'peak_tcs', 'mean_tcs', 'peak_bcs', 'mean_bcs',
    'phase_transition', 'phase_transition_time_sec',
    'harm_one_count', 'harm_mean', 'cascade_flips',
    'prescriptions_count', 'closing_type', 'closing_reason',
    'deficit_majority', 'classification',
    'breath_rate_bpm', 'iaf_hz', 'signal_quality'
  ]);

  function _labDuration(r, sum, ses) {
    if (sum && sum.duration_seconds != null) return sum.duration_seconds;
    if (ses && ses.duration_seconds != null) return ses.duration_seconds;
    return null;
  }

  function exportCoherenceLabCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var ri = r.raw_import || {};
      var sum = sd.summary || ri.summary || {};
      var ses = ri.session || {};
      var bl = sd.baseline || null;
      rows.push([
        r.session_id, r.session_date, r.imported_at
      ].concat(_ctxRow(r)).concat([
        _labDuration(r, sum, ses),
        sum.peak_tcs, sum.mean_tcs, sum.peak_bcs, sum.mean_bcs,
        sum.phase_transition_detected,
        sum.phase_transition_time_seconds,
        sum.harm_one_count, sum.harm_mean, sum.cascade_flips,
        sum.prescriptions_count, sum.closing_type, sum.closing_reason,
        sum.deficit_majority != null ? sum.deficit_majority : (bl && bl.deficit_majority),
        sum.classification != null ? sum.classification : (bl && bl.classification),
        bl && bl.breath_rate_bpm, bl && bl.iaf_hz, bl && bl.signal_quality
      ]));
    }
    return _buildCsv(LAB_HEADERS, rows);
  }

  // ─── Sophia Sessions CSV ──────────────────────────────────────

  var SOPHIA_HEADERS = [
    'session_id', 'session_date', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    'device', 'device_type', 'snapshot_count',
    'dominant_regime', 'dominant_geometry', 'hexagrams',
    'mean_coherence', 'peak_coherence', 'mean_focus', 'mean_meditation',
    'spiral_mean_hcr_theta', 'spiral_mean_hcr_alpha',
    'spiral_mean_hcr_beta', 'spiral_mean_hcr_gamma',
    'spiral_dominant_dir', 'spiral_mean_symmetry', 'spiral_samples',
    'tw_dominant_direction', 'tw_mean_angle_deg', 'tw_mean_speed_mps', 'tw_mean_planarity'
  ]);

  // Flatten a summary.spiral block into CSV cell values (11 columns).
  function _spiralSummaryRow(sum) {
    var spi = (sum && sum.spiral) || {};
    var mh = spi.mean_hcr || {};
    var tw = spi.traveling_wave || {};
    return [
      mh.theta, mh.alpha, mh.beta, mh.gamma,
      spi.dominant_dir, spi.mean_symmetry, spi.samples,
      tw.dominant_direction, tw.mean_angle_deg, tw.mean_speed_mps, tw.mean_planarity
    ];
  }

  function exportSophiaCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var sum = sd.summary || {};
      rows.push([
        r.session_id, r.session_date, r.imported_at
      ].concat(_ctxRow(r)).concat([
        sd.device, sd.device_type, sd.snapshot_count,
        sum.dominant_regime, sum.dominant_geometry,
        sum.hexagrams_encountered,
        sum.mean_coherence, sum.peak_coherence,
        sum.mean_focus, sum.mean_meditation
      ]).concat(_spiralSummaryRow(sum)));
    }
    return _buildCsv(SOPHIA_HEADERS, rows);
  }

  // ─── Sophia Snapshots CSV (long format) ───────────────────────

  // Spiral-wave detection (v2 exports): 6 channel pairs × 4 bands.
  var PLV_PAIRS = ['AF7_AF8', 'TP9_TP10', 'AF7_TP9', 'AF8_TP10', 'AF7_TP10', 'AF8_TP9'];
  var SPIRAL_BANDS = ['theta', 'alpha', 'beta', 'gamma'];

  // plv_<pair>_<band> headers, e.g. plv_AF7_AF8_theta
  var PLV_HEADERS = [];
  for (var _p = 0; _p < PLV_PAIRS.length; _p++) {
    for (var _b = 0; _b < SPIRAL_BANDS.length; _b++) {
      PLV_HEADERS.push('plv_' + PLV_PAIRS[_p] + '_' + SPIRAL_BANDS[_b]);
    }
  }

  var SNAP_HEADERS = [
    'session_id', 'session_date', 'snapshot_t',
    'position', 'frequency_hz', 'regime',
    'geometry', 'state', 'keyword',
    'i_ching_hex', 'i_ching_name',
    'coherence', 'focus', 'meditation', 'dominant_wave',
    'delta', 'theta', 'alpha', 'beta', 'gamma',
    'heart_rate',
    // Spiral-wave metrics
    'spiral_dominant_band',
    'pl_left_lag_ms', 'pl_left_direction', 'pl_left_strength', 'pl_left_band',
    'pl_right_lag_ms', 'pl_right_direction', 'pl_right_strength',
    'pl_bilateral_lag_ms', 'pl_bilateral_direction', 'pl_bilateral_symmetry',
    'hcr_theta', 'hcr_alpha', 'hcr_beta', 'hcr_gamma',
    // Traveling-wave vector (v2.1 exports)
    'tw_band', 'tw_angle_deg', 'tw_direction', 'tw_speed_mps',
    'tw_planarity', 'tw_strength', 'tw_rotation_deg_per_sec',
    'artifact_movement_score', 'artifact_delta_likely'
  ].concat(PLV_HEADERS);

  function _hcrVal(hcr, band) {
    return (hcr && hcr[band] && hcr[band].hcr != null) ? hcr[band].hcr : null;
  }

  function _plvRow(plv) {
    var out = [];
    for (var p = 0; p < PLV_PAIRS.length; p++) {
      var cell = plv[PLV_PAIRS[p]] || {};
      for (var b = 0; b < SPIRAL_BANDS.length; b++) {
        out.push(cell[SPIRAL_BANDS[b]]);
      }
    }
    return out;
  }

  function exportSophiaSnapshotsCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var snaps = sd.snapshots || [];
      for (var j = 0; j < snaps.length; j++) {
        var s = snaps[j];
        var sym = s.symbolic || {};
        var met = s.metrics || {};
        var bp = s.band_powers || {};
        var sp = s.spiral || {};
        var pll = sp.phase_lag_left || {};
        var plr = sp.phase_lag_right || {};
        var plb = sp.phase_lag_bilateral || {};
        var hcr = sp.hcr || {};
        var tw = sp.traveling_wave || {};
        var art = s.artifact || {};
        rows.push([
          r.session_id, r.session_date, s.t,
          s.position, s.frequency_hz, s.regime,
          sym.geometry, sym.state, sym.keyword,
          sym.i_ching_hexagram, sym.i_ching_name,
          met.coherence, met.focus, met.meditation, met.dominant_wave,
          bp.delta, bp.theta, bp.alpha, bp.beta, bp.gamma,
          s.heart_rate,
          sp.dominant_band,
          pll.lagMs, pll.direction, pll.strength, pll.band,
          plr.lagMs, plr.direction, plr.strength,
          plb.lagMs, plb.direction, plb.symmetry,
          _hcrVal(hcr, 'theta'), _hcrVal(hcr, 'alpha'), _hcrVal(hcr, 'beta'), _hcrVal(hcr, 'gamma'),
          tw.band, tw.angleDeg, tw.direction, tw.speedMps,
          tw.planarity, tw.strength, tw.rotationDegPerSec,
          art.movementScore, art.deltaArtifactLikely
        ].concat(_plvRow(sp.plv_matrix || {})));
      }
    }
    return _buildCsv(SNAP_HEADERS, rows);
  }

  // ─── RCT CSV ──────────────────────────────────────────────────

  var RCT_HEADERS = [
    'session_id', 'session_date', 'source', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    'avg_coherence', 'peak_coherence', 'duration_seconds',
    'baseline_position', 'baseline_dominant_wave', 'baseline_coherence',
    'baseline_freq', 'baseline_geometry',
    'endstate_position', 'endstate_dominant_wave', 'endstate_coherence',
    'endstate_freq', 'endstate_geometry',
    'positions_moved', 'prescriptions_count', 'prescriptions_freqs'
  ]);

  function exportRCTCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var bl = sd.baseline || {};
      var es = sd.endstate || {};
      var rx = sd.prescriptions_played || [];
      rows.push([
        r.session_id, r.session_date, r.source, r.imported_at
      ].concat(_ctxRow(r)).concat([
        sd.avg_coherence, sd.peak_coherence, sd.duration_seconds,
        bl.position, bl.dominant_wave, bl.coherence,
        bl.frequency_hz, bl.geometry,
        es.position, es.dominant_wave, es.coherence,
        es.frequency_hz, es.geometry,
        sd.positions_moved, sd.prescriptions_count,
        rx.join(';')
      ]));
    }
    return _buildCsv(RCT_HEADERS, rows);
  }

  // ─── Divination CSV ───────────────────────────────────────────

  var DIVINATION_HEADERS = [
    'session_id', 'session_date', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    'reading_id', 'asked_at', 'method', 'question',
    'present', 'present_name', 'moving_lines', 'nuclear', 'nuclear_name', 'changed', 'changed_name',
    'mirror', 'mirror_answered_at', 'mirror_note',
    'journey_hz', 'map_version',
    'moon_phase', 'moon_illumination', 'lunar_day', 'mansion', 'mansion_name',
    'sky_hexagram', 'sky_hexagram_name', 'sky_frequency_hz',
    'tide_hexagram', 'tide_frequency_hz', 'season_element',
    'verdict_now', 'verdict_outcome'
  ]);

  function exportDivinationCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var hx = sd.hexagrams || {};
      var pr = hx.present || {};
      var nu = hx.nuclear || {};
      var ch = hx.changed || {};
      var cast = sd.cast || {};
      var mir = sd.mirror || {};
      var sky = sd.sky || {};
      var tide = sky.tide || {};
      var sm = sky.solar_month || {};
      var vd = sd.verdict || {};
      rows.push([
        r.session_id, r.session_date, r.imported_at
      ].concat(_ctxRow(r)).concat([
        sd.reading_id, sd.asked_at, sd.method, sd.question,
        pr.hexagram, pr.hexagram_name, cast.moving_lines, nu.hexagram, nu.hexagram_name, ch.hexagram, ch.hexagram_name,
        mir.status, mir.answered_at, mir.note,
        sd.journey_hz, sd.map_version,
        sky.phase_name, sky.illumination, sky.lunar_day, sky.mansion, sky.mansion_name,
        sky.sky_hexagram, sky.sky_hexagram_name, sky.sky_frequency_hz,
        tide.hexagram, tide.frequency_hz, sm.season_element,
        vd.now, vd.outcome
      ]));
    }
    return _buildCsv(DIVINATION_HEADERS, rows);
  }

  // ─── Field Lens CSV ───────────────────────────────────────────
  // One row per session: its summary. The once-a-second readings and the
  // heartbeats themselves are in the Full JSON.

  var FIELD_LENS_HEADERS = [
    'session_id', 'session_date', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    'heartbeat_source', 'demo', 'started_at', 'ended_at', 'utc_offset_minutes',
    'duration_seconds', 'beats', 'mean_hr',
    'mean_coherence', 'peak_coherence', 'coherent_seconds',
    'mean_breaths_per_minute', 'mean_room_ut', 'room_range_ut',
    'held_seconds', 'mean_stillness', 'tone_seconds',
    'seconds_recorded', 'ecg_samples', 'description'
  ]);

  function exportFieldLensCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      var sum = sd.summary || {};
      rows.push([
        r.session_id, r.session_date, r.imported_at
      ].concat(_ctxRow(r)).concat([
        sd.heartbeat_source, sd.demo, sd.started_at, sd.ended_at, sd.utc_offset_minutes,
        sum.duration_seconds, sum.beats, sum.mean_hr,
        sum.mean_coherence, sum.peak_coherence, sum.coherent_seconds,
        sum.mean_breaths_per_minute, sum.mean_room_ut, sum.room_range_ut,
        sum.held_seconds, sum.mean_stillness, sum.tone_seconds,
        Array.isArray(sd.t) ? sd.t.length : null,
        Array.isArray(sd.ecg_uv) ? sd.ecg_uv.length : null,
        sd.description
      ]));
    }
    return _buildCsv(FIELD_LENS_HEADERS, rows);
  }

  // ─── Manual CSV ───────────────────────────────────────────────

  var MANUAL_HEADERS = [
    'session_id', 'session_date', 'imported_at'
  ].concat(CTX_HEADERS).concat(['description']);

  function exportManualCSV(sessions) {
    var rows = [];
    for (var i = 0; i < sessions.length; i++) {
      var r = sessions[i];
      var sd = r.source_data || {};
      rows.push([
        r.session_id, r.session_date, r.imported_at
      ].concat(_ctxRow(r)).concat([
        sd.description
      ]));
    }
    return _buildCsv(MANUAL_HEADERS, rows);
  }

  // ─── Unified CSV ──────────────────────────────────────────────

  var UNIFIED_HEADERS = [
    'session_id', 'session_date', 'source', 'imported_at'
  ].concat(CTX_HEADERS).concat([
    // Coherence Lab columns
    'lab_duration_sec', 'lab_peak_tcs', 'lab_mean_tcs',
    'lab_peak_bcs', 'lab_mean_bcs',
    'lab_phase_transition', 'lab_phase_transition_time_sec',
    'lab_harm_one_count', 'lab_harm_mean', 'lab_cascade_flips',
    'lab_prescriptions_count', 'lab_closing_type', 'lab_closing_reason',
    'lab_deficit_majority', 'lab_classification',
    'lab_breath_rate_bpm', 'lab_iaf_hz', 'lab_signal_quality',
    // Sophia columns
    'sophia_device', 'sophia_device_type', 'sophia_snapshot_count',
    'sophia_dominant_regime', 'sophia_dominant_geometry', 'sophia_hexagrams',
    'sophia_mean_coherence', 'sophia_peak_coherence',
    'sophia_mean_focus', 'sophia_mean_meditation',
    'sophia_spiral_mean_hcr_theta', 'sophia_spiral_mean_hcr_alpha',
    'sophia_spiral_mean_hcr_beta', 'sophia_spiral_mean_hcr_gamma',
    'sophia_spiral_dominant_dir', 'sophia_spiral_mean_symmetry', 'sophia_spiral_samples',
    'sophia_tw_dominant_direction', 'sophia_tw_mean_angle_deg',
    'sophia_tw_mean_speed_mps', 'sophia_tw_mean_planarity',
    // RCT columns
    'rct_avg_coherence', 'rct_peak_coherence', 'rct_duration_seconds',
    'rct_baseline_position', 'rct_baseline_dominant_wave', 'rct_baseline_coherence',
    'rct_baseline_freq', 'rct_baseline_geometry',
    'rct_endstate_position', 'rct_endstate_dominant_wave', 'rct_endstate_coherence',
    'rct_endstate_freq', 'rct_endstate_geometry',
    'rct_positions_moved', 'rct_prescriptions_count', 'rct_prescriptions_freqs',
    // Manual columns
    'manual_description',
    // Divination columns
    'div_method', 'div_present', 'div_present_name', 'div_changed', 'div_changed_name',
    'div_moving_lines', 'div_mirror', 'div_journey_hz', 'div_map_version',
    // Field Lens columns
    'fl_heartbeat_source', 'fl_demo', 'fl_started_at', 'fl_duration_seconds', 'fl_beats', 'fl_mean_hr',
    'fl_peak_coherence', 'fl_mean_coherence', 'fl_coherent_seconds', 'fl_mean_breaths_per_minute',
    'fl_mean_room_ut', 'fl_room_range_ut', 'fl_held_seconds', 'fl_mean_stillness'
  ]);

  function exportUnifiedCSV(allSessions) {
    var rows = [];
    for (var i = 0; i < allSessions.length; i++) {
      var r = allSessions[i];
      var ri = r.raw_import || {};
      var sd = r.source_data || {};

      // Lab fields
      var isLab = r.source === 'coherence_lab';
      var labSum = isLab ? ((sd && sd.summary) || ri.summary || {}) : {};
      var labSes = isLab ? (ri.session || {}) : {};
      var labBl  = isLab ? (sd && sd.baseline) || null : null;

      // Sophia fields
      var sophSum = (r.source === 'sophia') ? (sd.summary || {}) : {};

      // RCT fields
      var isRct = r.source === 'rct';
      var rctBl = isRct ? (sd.baseline || {}) : {};
      var rctEs = isRct ? (sd.endstate || {}) : {};
      var rctRx = isRct ? (sd.prescriptions_played || []) : [];

      // Divination fields
      var isDiv = r.source === 'divination';
      var divHx = isDiv ? (sd.hexagrams || {}) : {};
      var divPr = divHx.present || {};
      var divCh = divHx.changed || {};

      // Field Lens fields
      var isFl = r.source === 'field_lens';
      var flSum = isFl ? (sd.summary || {}) : {};

      rows.push([
        r.session_id, r.session_date, r.source, r.imported_at
      ].concat(_ctxRow(r)).concat([
        isLab ? _labDuration(r, labSum, labSes) : null,
        labSum.peak_tcs, labSum.mean_tcs, labSum.peak_bcs, labSum.mean_bcs,
        isLab ? labSum.phase_transition_detected : null,
        labSum.phase_transition_time_seconds,
        labSum.harm_one_count, labSum.harm_mean, labSum.cascade_flips,
        labSum.prescriptions_count, labSum.closing_type, labSum.closing_reason,
        isLab ? (labSum.deficit_majority != null ? labSum.deficit_majority : (labBl && labBl.deficit_majority)) : null,
        isLab ? (labSum.classification   != null ? labSum.classification   : (labBl && labBl.classification))   : null,
        labBl && labBl.breath_rate_bpm, labBl && labBl.iaf_hz, labBl && labBl.signal_quality,
        r.source === 'sophia' ? sd.device : null,
        r.source === 'sophia' ? sd.device_type : null,
        r.source === 'sophia' ? sd.snapshot_count : null,
        sophSum.dominant_regime, sophSum.dominant_geometry,
        r.source === 'sophia' ? sophSum.hexagrams_encountered : null,
        sophSum.mean_coherence, sophSum.peak_coherence,
        sophSum.mean_focus, sophSum.mean_meditation,
        (sophSum.spiral && sophSum.spiral.mean_hcr) ? sophSum.spiral.mean_hcr.theta : null,
        (sophSum.spiral && sophSum.spiral.mean_hcr) ? sophSum.spiral.mean_hcr.alpha : null,
        (sophSum.spiral && sophSum.spiral.mean_hcr) ? sophSum.spiral.mean_hcr.beta : null,
        (sophSum.spiral && sophSum.spiral.mean_hcr) ? sophSum.spiral.mean_hcr.gamma : null,
        sophSum.spiral ? sophSum.spiral.dominant_dir : null,
        sophSum.spiral ? sophSum.spiral.mean_symmetry : null,
        sophSum.spiral ? sophSum.spiral.samples : null,
        (sophSum.spiral && sophSum.spiral.traveling_wave) ? sophSum.spiral.traveling_wave.dominant_direction : null,
        (sophSum.spiral && sophSum.spiral.traveling_wave) ? sophSum.spiral.traveling_wave.mean_angle_deg : null,
        (sophSum.spiral && sophSum.spiral.traveling_wave) ? sophSum.spiral.traveling_wave.mean_speed_mps : null,
        (sophSum.spiral && sophSum.spiral.traveling_wave) ? sophSum.spiral.traveling_wave.mean_planarity : null,
        isRct ? sd.avg_coherence : null,
        isRct ? sd.peak_coherence : null,
        isRct ? sd.duration_seconds : null,
        rctBl.position, rctBl.dominant_wave, rctBl.coherence,
        rctBl.frequency_hz, rctBl.geometry,
        rctEs.position, rctEs.dominant_wave, rctEs.coherence,
        rctEs.frequency_hz, rctEs.geometry,
        isRct ? sd.positions_moved : null,
        isRct ? sd.prescriptions_count : null,
        isRct ? rctRx.join(';') : null,
        r.source === 'manual' ? (sd.description || null) : null,
        isDiv ? sd.method : null,
        divPr.hexagram, divPr.hexagram_name, divCh.hexagram, divCh.hexagram_name,
        isDiv && sd.cast ? sd.cast.moving_lines : null,
        isDiv && sd.mirror ? sd.mirror.status : null,
        isDiv ? sd.journey_hz : null,
        isDiv ? sd.map_version : null,
        isFl ? sd.heartbeat_source : null,
        isFl ? sd.demo : null,
        isFl ? sd.started_at : null,
        flSum.duration_seconds, flSum.beats, flSum.mean_hr,
        flSum.peak_coherence, flSum.mean_coherence, flSum.coherent_seconds, flSum.mean_breaths_per_minute,
        flSum.mean_room_ut, flSum.room_range_ut, flSum.held_seconds, flSum.mean_stillness
      ]));
    }
    return _buildCsv(UNIFIED_HEADERS, rows);
  }

  // ─── Full JSON ────────────────────────────────────────────────

  function exportFullJSON(allSessions) {
    return JSON.stringify({
      schema_version: '2.0',
      exported_at: new Date().toISOString(),
      session_count: allSessions.length,
      sessions: allSessions
    }, null, 2);
  }

  // ─── Download helper ──────────────────────────────────────────

  function downloadAsFile(content, filename, mimeType) {
    var type = mimeType || 'text/plain';
    // Prepend a UTF-8 BOM for CSVs so spreadsheet apps (Excel, Numbers) detect
    // UTF-8 and render em-dashes / accents correctly instead of mojibake.
    // Never for JSON — a leading BOM makes JSON.parse throw on re-import.
    var parts = (type.indexOf('csv') !== -1) ? [String.fromCharCode(0xFEFF), content] : [content];
    if (type.indexOf('charset') === -1) type += ';charset=utf-8';
    var blob = new Blob(parts, { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Public API ───────────────────────────────────────────────

  var TaggerExport = {
    exportCoherenceLabCSV:    exportCoherenceLabCSV,
    exportSophiaCSV:          exportSophiaCSV,
    exportSophiaSnapshotsCSV: exportSophiaSnapshotsCSV,
    exportRCTCSV:             exportRCTCSV,
    exportDivinationCSV:      exportDivinationCSV,
    exportFieldLensCSV:       exportFieldLensCSV,
    exportManualCSV:         exportManualCSV,
    exportUnifiedCSV:         exportUnifiedCSV,
    exportFullJSON:           exportFullJSON,
    downloadAsFile:           downloadAsFile,

    // Exposed for testing
    _csvVal: _csvVal,
    _csvRow: _csvRow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaggerExport;
  } else {
    root.TaggerExport = TaggerExport;
  }

})(typeof window !== 'undefined' ? window : this);
