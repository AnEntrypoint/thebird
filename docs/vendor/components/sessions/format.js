// ONE time/duration vocabulary for every session surface, plus the shared
// status word/disc maps that keep a session's "running / idle / error" reading
// identical on a rail row and on its Live-dashboard card.

import { formatDateTime } from '../../locale.js';

// ONE duration format for every surface (live cards, running panel, session
// meta, context pane): <60s -> 'Ns', <1h -> 'Nm Ss', else 'Nh Nm'. Durations
// roll s -> m -> h instead of an hour-long run reading '3712s'.
// ONE absolute-time / relative-time formatter for every surface that shows a
// timestamp (freddie pages, chat transcripts). fmtTime -> localized
// date+time string; fmtAgo -> coarse relative ('Ns/Nm/Nh/Nd ago').
export function fmtTime(t) {
  try { return formatDateTime(t); } catch { return String(t || ''); }
}
export function fmtAgo(t) {
  if (!t) return '';
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const hrs = Math.floor(m / 60);
  return hrs + 'h ' + (m % 60) + 'm';
}

// `status` is one of: 'error' | 'stale' | 'running' | 'stopping'. A 'stale'
// session is one the host has determined is alive but not making progress (no
// recent activity, no current tool) — it reads as `idle` with a NON-pulsing
// disc so a stuck agent is visually distinct from a busy one (a frozen elapsed
// alone reads identically for both, which is the high-severity oversight gap
// this closes).
export const STATUS_WORD = { error: 'error', stale: 'idle', running: 'running', stopping: 'stopping' };
export const STATUS_DISC = { error: 'status-dot-error', stale: 'status-dot-stale', running: 'status-dot-live', stopping: 'status-dot-connecting' };
