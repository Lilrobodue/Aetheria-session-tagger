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
      heart_rate:  entry.heartRate != null ? entry.heartRate : null,
      // Spiral-wave detection metrics (v2 exports). Passed through as-is —
      // values are already 0-1 ratios / ms, no normalization needed.
      spiral:      entry.spiral || null,
      artifact:    entry.artifact || null
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

  // Mean rounded to N decimal places (spiral PLV/HCR/symmetry need finer
  // resolution than the 1-decimal _mean used for percentage metrics).
  function _meanP(arr, places) {
    if (!arr.length) return null;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    var f = Math.pow(10, places);
    return Math.round(sum / arr.length * f) / f;
  }

  var SPIRAL_BANDS = ['theta', 'alpha', 'beta', 'gamma'];
  var PLV_PAIRS = ['AF7_AF8', 'TP9_TP10', 'AF7_TP9', 'AF8_TP10', 'AF7_TP10', 'AF8_TP9'];

  // Pick the most frequent key from a {key: count} object, honoring a
  // preference order for ties.
  function _dominantKey(counts, order) {
    var best = null;
    var bestN = -1;
    for (var i = 0; i < order.length; i++) {
      if (counts[order[i]] > bestN) {
        bestN = counts[order[i]];
        best = order[i];
      }
    }
    return bestN > 0 ? best : null;
  }

  var DIR_ORDER = ['front-to-back', 'back-to-front', 'indeterminate'];

  // Circular mean of a list of angles in degrees (handles wrap-around at ±180).
  function _circularMeanDeg(anglesDeg) {
    if (!anglesDeg.length) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < anglesDeg.length; i++) {
      var r = anglesDeg[i] * Math.PI / 180;
      sx += Math.cos(r);
      sy += Math.sin(r);
    }
    return Math.round(Math.atan2(sy, sx) * 180 / Math.PI);
  }

  // Aggregate the per-snapshot spiral.traveling_wave vectors (v2.1 exports).
  // Returns null when no snapshot carries a traveling_wave block.
  function _travelingWaveSummary(snapshots) {
    var angles = [], speeds = [], planar = [], strengths = [], dirs = [];
    var cw = 0, ccw = 0, none = 0, absRot = [];
    var n = 0;
    for (var i = 0; i < snapshots.length; i++) {
      var sp = snapshots[i].spiral;
      var tw = sp && sp.traveling_wave;
      if (!tw) continue;
      n++;
      if (tw.angleDeg != null) angles.push(tw.angleDeg);
      if (tw.speedMps != null) speeds.push(tw.speedMps);
      if (tw.planarity != null) planar.push(tw.planarity);
      if (tw.strength != null) strengths.push(tw.strength);
      if (tw.direction) dirs.push(tw.direction);
      var rot = tw.rotationDegPerSec;
      // sign convention: positive = counter-clockwise, negative = clockwise
      if (rot == null || rot === 0) { none++; }
      else { if (rot > 0) ccw++; else cw++; absRot.push(Math.abs(rot)); }
    }
    if (n === 0) return null;
    return {
      mean_angle_deg:     _circularMeanDeg(angles),
      dominant_direction: _modeOf(dirs),
      mean_speed_mps:     _meanP(speeds, 2),
      mean_planarity:     _meanP(planar, 2),
      mean_strength:      _meanP(strengths, 2),
      rotation: {
        cw: cw, ccw: ccw, none: none,
        mean_abs_deg_per_sec: _meanP(absRot, 0)
      },
      samples: n
    };
  }

  function _pathwaySummary(snapshots, key) {
    var counts = { 'front-to-back': 0, 'back-to-front': 0, 'indeterminate': 0 };
    var strengths = [];
    for (var i = 0; i < snapshots.length; i++) {
      var sp = snapshots[i].spiral;
      var pl = sp && sp[key];
      if (!pl) continue;
      if (pl.direction && counts[pl.direction] != null) counts[pl.direction]++;
      if (pl.strength != null) strengths.push(pl.strength);
    }
    return { direction: _dominantKey(counts, DIR_ORDER), strength: _meanP(strengths, 2) };
  }

  // Aggregate per-snapshot spiral metrics into a session-level summary.
  // Returns null when no snapshot carries spiral data (pre-v2 exports).
  function _computeSpiralSummary(snapshots) {
    var hcr = { theta: [], alpha: [], beta: [], gamma: [] };
    var dirCounts = { 'front-to-back': 0, 'back-to-front': 0, 'indeterminate': 0 };
    var symVals = [];
    var samples = 0;

    // Running sums for the session-mean PLV matrix (pair × band).
    var plvSum = {}, plvN = {};
    for (var pi = 0; pi < PLV_PAIRS.length; pi++) {
      plvSum[PLV_PAIRS[pi]] = { theta: 0, alpha: 0, beta: 0, gamma: 0 };
      plvN[PLV_PAIRS[pi]]   = { theta: 0, alpha: 0, beta: 0, gamma: 0 };
    }

    for (var i = 0; i < snapshots.length; i++) {
      var sp = snapshots[i].spiral;
      if (!sp) continue;
      samples++;
      if (sp.hcr) {
        for (var b = 0; b < SPIRAL_BANDS.length; b++) {
          var band = SPIRAL_BANDS[b];
          if (sp.hcr[band] && sp.hcr[band].hcr != null) hcr[band].push(sp.hcr[band].hcr);
        }
      }
      var plb = sp.phase_lag_bilateral;
      if (plb) {
        if (plb.direction && dirCounts[plb.direction] != null) dirCounts[plb.direction]++;
        if (plb.symmetry != null) symVals.push(plb.symmetry);
      }
      var plv = sp.plv_matrix;
      if (plv) {
        for (var p = 0; p < PLV_PAIRS.length; p++) {
          var cell = plv[PLV_PAIRS[p]];
          if (!cell) continue;
          for (var c = 0; c < SPIRAL_BANDS.length; c++) {
            var bnd = SPIRAL_BANDS[c];
            if (cell[bnd] != null) { plvSum[PLV_PAIRS[p]][bnd] += cell[bnd]; plvN[PLV_PAIRS[p]][bnd]++; }
          }
        }
      }
    }

    if (samples === 0) return null;

    var meanPlv = {};
    for (var pp = 0; pp < PLV_PAIRS.length; pp++) {
      var pr = PLV_PAIRS[pp];
      meanPlv[pr] = {};
      for (var cc = 0; cc < SPIRAL_BANDS.length; cc++) {
        var bb = SPIRAL_BANDS[cc];
        meanPlv[pr][bb] = plvN[pr][bb] ? Math.round(plvSum[pr][bb] / plvN[pr][bb] * 100) / 100 : null;
      }
    }

    return {
      mean_hcr: {
        theta: _meanP(hcr.theta, 2),
        alpha: _meanP(hcr.alpha, 2),
        beta:  _meanP(hcr.beta, 2),
        gamma: _meanP(hcr.gamma, 2)
      },
      mean_plv_matrix:      meanPlv,
      phase_lag_dir_counts: dirCounts,
      dominant_dir:         _dominantKey(dirCounts, DIR_ORDER),
      mean_symmetry:        _meanP(symVals, 2),
      left_pathway:         _pathwaySummary(snapshots, 'phase_lag_left'),
      right_pathway:        _pathwaySummary(snapshots, 'phase_lag_right'),
      traveling_wave:       _travelingWaveSummary(snapshots),
      samples:              samples
    };
  }

  // ─── Actionable Insights ──────────────────────────────────────
  // Derive plain-language, actionable observations from the aggregated
  // metrics. Each insight is { kind: 'good'|'watch'|'tip', text }.
  // kind drives UI color; the text tells the user what to do next.

  function _coherenceTrend(snapshots) {
    var vals = [];
    for (var i = 0; i < snapshots.length; i++) {
      var c = snapshots[i].metrics && snapshots[i].metrics.coherence;
      if (c != null) vals.push(c);
    }
    if (vals.length < 2) return null;
    return { start: vals[0], end: vals[vals.length - 1] };
  }

  function _artifactCleanliness(snapshots) {
    var total = 0, flagged = 0;
    for (var i = 0; i < snapshots.length; i++) {
      var a = snapshots[i].artifact;
      if (!a) continue;
      total++;
      if (a.deltaArtifactLikely || (a.movementScore != null && a.movementScore > 0.3)) flagged++;
    }
    if (total === 0) return null;
    return { total: total, flagged: flagged, pct: Math.round(flagged / total * 100) };
  }

  function generateSophiaInsights(summary, snapshots, diagnostics) {
    var out = [];

    // ── Coherence level + trend ──
    var mc = summary.mean_coherence;
    if (mc != null) {
      if (mc >= 30) {
        out.push({ kind: 'good', text: 'Strong mean coherence (' + mc + '%) - the field locked in well. A great session to repeat the conditions of.' });
      } else if (mc >= 15) {
        out.push({ kind: 'tip', text: 'Coherence averaged ' + mc + '% - a workable base. Longer holds at each position tend to push it higher.' });
      } else {
        out.push({ kind: 'watch', text: 'Mean coherence held at ' + mc + '% - still finding its floor. Build it with longer, settled GUT-regime sessions before climbing.' });
      }
    }
    var tr = _coherenceTrend(snapshots);
    if (tr) {
      if (tr.end - tr.start >= 3) {
        out.push({ kind: 'good', text: 'Coherence rose from ' + tr.start + '% to ' + tr.end + '% across the session - you were building toward lock. Extending the session could consolidate it.' });
      } else if (tr.start - tr.end >= 3) {
        out.push({ kind: 'watch', text: 'Coherence drifted down from ' + tr.start + '% to ' + tr.end + '% - fatigue or distraction may have crept in. A shorter session or a reset at the GUT base can help.' });
      }
    }

    // ── Spiral wave direction + symmetry ──
    var spi = summary.spiral;
    if (spi) {
      var sym = spi.mean_symmetry;
      if (spi.dominant_dir && spi.dominant_dir !== 'indeterminate' && sym != null && sym >= 0.7) {
        out.push({ kind: 'good', text: 'Traveling-wave direction held ' + spi.dominant_dir + ' with ' + sym + ' bilateral symmetry - a consistent, mirrored flow consistent with entrainment.' });
      } else if (spi.dominant_dir === 'indeterminate' || (sym != null && sym < 0.5)) {
        out.push({ kind: 'tip', text: 'Wave direction was variable' + (sym != null ? ' (symmetry ' + sym + ')' : '') + ' - typical of an unentrained baseline. A steady carrier tone tends to organize it over time.' });
      }

      // ── HCR — which band shows inter-hemispheric dominance ──
      var mh = spi.mean_hcr || {};
      var bestBand = null, bestHcr = -1;
      ['theta', 'alpha', 'beta', 'gamma'].forEach(function (b) {
        if (mh[b] != null && mh[b] > bestHcr) { bestHcr = mh[b]; bestBand = b; }
      });
      if (bestBand && bestHcr >= 1.2) {
        out.push({ kind: 'good', text: 'Inter-hemispheric coherence peaked in ' + bestBand + ' (HCR ' + bestHcr + ') - strong cross-hemisphere binding, the spiral-mirroring signature. Note which regime was playing.' });
      } else if (bestBand && bestHcr < 0.8) {
        out.push({ kind: 'tip', text: 'Coherence leaned ipsilateral (front-to-back) across bands - flow was more within-hemisphere than mirrored. HEAD-regime work tends to lift inter-hemispheric coupling.' });
      }

      // ── Traveling wave (spiral rotation) ──
      var tw = spi.traveling_wave;
      if (tw) {
        var rot = tw.rotation || {};
        var rotating = (rot.cw || 0) + (rot.ccw || 0);
        if (tw.samples && rotating / tw.samples >= 0.5) {
          var sense = rot.ccw > rot.cw ? 'counter-clockwise' : rot.cw > rot.ccw ? 'clockwise' : 'mixed';
          out.push({ kind: 'good', text: 'Rotating waves detected in ' + rotating + ' of ' + tw.samples + ' epochs (mostly ' + sense + ', ~' + rot.mean_abs_deg_per_sec + ' deg/s) - the rotating-wave signature the spiral hypothesis predicts.' });
        } else if (tw.mean_planarity != null && tw.mean_planarity >= 0.7) {
          out.push({ kind: 'tip', text: 'Traveling waves were mostly planar (planarity ' + tw.mean_planarity + ', heading ' + (tw.dominant_direction || 'mixed') + ') rather than rotating - a directional sweep rather than a spiral.' });
        }
      }
    }

    // ── Regime guidance ──
    if (summary.dominant_regime === 'GUT') {
      out.push({ kind: 'tip', text: 'Session anchored in the GUT regime (grounding/body). To progress toward HEART (emotion/flow), let theta and alpha rise together while staying relaxed.' });
    } else if (summary.dominant_regime) {
      out.push({ kind: 'tip', text: 'Time was spent mostly in the ' + summary.dominant_regime + ' regime - compare its spiral signature against your GUT baseline sessions.' });
    }

    // ── Data quality ──
    var art = _artifactCleanliness(snapshots);
    if (art) {
      if (art.pct <= 10) {
        out.push({ kind: 'good', text: 'Clean data - movement artifact flagged in only ' + art.pct + '% of epochs, so these readings are trustworthy.' });
      } else if (art.pct >= 30) {
        out.push({ kind: 'watch', text: 'Movement artifact flagged in ' + art.pct + '% of epochs - interpret cautiously. Settling more still next time will sharpen the data.' });
      }
    }

    // ── Neurodynamics: signal complexity (v2.1 exports) ──
    var nd = diagnostics && diagnostics.neurodynamics;
    if (nd && nd.mean) {
      var fd = nd.mean.higuchiFD, se = nd.mean.sampleEntropy, rr = nd.mean.recurrenceRate;
      if (fd != null) {
        if (fd < 1.4) {
          out.push({ kind: 'tip', text: 'Signal complexity was low (Higuchi FD ' + fd.toFixed(2) + ') - an ordered, regular state, the kind seen in calm or deeply settled stretches.' });
        } else if (fd > 1.85) {
          out.push({ kind: 'tip', text: 'Signal complexity ran high (Higuchi FD ' + fd.toFixed(2) + ') - an active, less predictable state. If it stays high at rest, double-check electrode contact.' });
        } else {
          out.push({ kind: 'good', text: 'Signal complexity sat in the typical waking-EEG range (Higuchi FD ' + fd.toFixed(2) + (se != null ? ', sample entropy ' + se.toFixed(2) : '') + ') - a healthy, well-formed signal.' });
        }
      }
      if (rr != null && rr >= 0.02) {
        out.push({ kind: 'good', text: 'Elevated recurrence rate (' + rr.toFixed(3) + ') - the signal carried repeating, periodic structure, consistent with rhythmic entrainment.' });
      }
      if (nd.perChannel) {
        var fds = [];
        for (var ch in nd.perChannel) {
          if (nd.perChannel.hasOwnProperty(ch) && nd.perChannel[ch] && nd.perChannel[ch].higuchiFD != null) {
            fds.push({ c: ch, v: nd.perChannel[ch].higuchiFD });
          }
        }
        if (fds.length >= 2) {
          fds.sort(function (a, b) { return a.v - b.v; });
          var lo = fds[0], hi = fds[fds.length - 1];
          if (hi.v - lo.v >= 0.25) {
            out.push({ kind: 'watch', text: 'Complexity varied across channels (' + lo.c + ' lowest at ' + lo.v.toFixed(2) + ', ' + hi.c + ' highest at ' + hi.v.toFixed(2) + ') - a wide gap can mean uneven electrode contact.' });
          }
        }
      }
    }

    // ── Channel quality caveat (v2.1 exports) ──
    var cd = diagnostics && diagnostics.channelDiagnostic;
    if (cd && cd.stats) {
      var noisy = [];
      var scalp = ['TP9', 'AF7', 'AF8', 'TP10'];
      for (var si = 0; si < scalp.length; si++) {
        var st = cd.stats[scalp[si]];
        if (st && st.spectrum && st.spectrum.eegLike === false) noisy.push(scalp[si]);
      }
      if (noisy.length) {
        out.push({ kind: 'watch', text: noisy.join(' and ') + ' looked more like noise than clean EEG this session - interpret ' + (noisy.length > 1 ? 'their' : 'its') + ' channel metrics cautiously, and re-seat the band if it persists.' });
      }
    }

    return out;
  }

  function computeSophiaSummary(snapshots, diagnostics) {
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

    var summary = {
      dominant_regime:       _modeOf(regimes),
      dominant_geometry:     _modeOf(geometries),
      hexagrams_encountered: hexNums,
      mean_coherence:        _mean(cohVals),
      peak_coherence:        cohVals.length ? Math.max.apply(null, cohVals) : null,
      mean_focus:            _mean(focVals),
      mean_meditation:       _mean(medVals),
      spiral:                _computeSpiralSummary(snapshots)
    };
    summary.insights = generateSophiaInsights(summary, snapshots, diagnostics);
    return summary;
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

    var summary = computeSophiaSummary(snapshots, {
      neurodynamics:     sophiaExport.neurodynamics,
      channelDiagnostic: sophiaExport.channelDiagnostic
    });

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
        summary:           summary,
        // Session-level diagnostics (v2.1 exports); null on older exports.
        neurodynamics:     sophiaExport.neurodynamics || null,
        channel_diagnostic: sophiaExport.channelDiagnostic || null
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
    var summary = computeSophiaSummary(merged, {
      neurodynamics:     sophiaExport.neurodynamics || sd.neurodynamics,
      channelDiagnostic: sophiaExport.channelDiagnostic || sd.channel_diagnostic
    });

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
        summary:           summary,
        // Latest export's session-level diagnostics; fall back to prior values.
        neurodynamics:     sophiaExport.neurodynamics || sd.neurodynamics || null,
        channel_diagnostic: sophiaExport.channelDiagnostic || sd.channel_diagnostic || null
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
    generateSophiaInsights:   generateSophiaInsights,
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
