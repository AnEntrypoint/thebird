// In-tab cron scheduler. makeCronSurface (freddie-host-surfaces.js) is pure
// CRUD (list/create/remove/toggle) over an in-memory sqlite-shim jobs table
// -- nothing anywhere evaluated a job's cron expression against wall-clock
// time, so a "due" job never fired; the dashboard's cron tab only ever
// showed a static table. This module is the missing piece: poll the jobs
// table, evaluate standard 5-field cron syntax, dispatch due jobs through
// the same chat tool makeBatchSurface uses, record last_run so a job fires
// at most once per matching minute.
//
// Lives entirely in-tab: no SW, no persistence beyond the existing (already
// non-durable, in-memory) cron jobs table. A closed tab or reload stops the
// scheduler -- same lifetime as the jobs table itself, so this does not
// change the durability contract, only makes "due" actually mean something
// while the tab is open.

function fieldMatches(field, value, min, max) {
    if (field === '*') return true;
    for (const part of field.split(',')) {
        const stepMatch = part.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
        if (stepMatch) {
            const [, range, stepStr] = stepMatch;
            const step = Number(stepStr);
            let lo = min, hi = max;
            if (range !== '*') {
                if (range.includes('-')) { const [a, b] = range.split('-').map(Number); lo = a; hi = b; }
                else { lo = Number(range); hi = max; }
            }
            if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
            continue;
        }
        if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            if (value >= a && value <= b) return true;
            continue;
        }
        if (Number(part) === value) return true;
    }
    return false;
}

// Field bounds in POSIX-cron column order: minute, hour, day-of-month, month, day-of-week.
const FIELD_BOUNDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

// Loud, creation-time validation companion to fieldMatches: a bare-number
// step start outside a field's [min,max] (e.g. '35/15' on day-of-month,
// max=31) can never satisfy fieldMatches' `value >= lo` test for any real
// value of that field, so the job would silently never fire with no error
// anywhere -- indistinguishable from a correctly-scheduled-but-not-yet-due
// job. Reject at creation instead of failing silently at every tick.
export function validateCronExpr(expr) {
    if (!expr || typeof expr !== 'string') return 'cron expression required';
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return 'cron expression must have 5 space-separated fields (minute hour day-of-month month day-of-week)';
    for (let i = 0; i < 5; i++) {
        const [min, max] = FIELD_BOUNDS[i];
        for (const part of parts[i].split(',')) {
            const stepMatch = part.match(/^(\*|\d+-\d+|\d+)\/(\d+)$/);
            if (!stepMatch) continue;
            const [, range, stepStr] = stepMatch;
            if (Number(stepStr) <= 0) return `field ${i + 1} ("${part}"): step must be positive`;
            if (range === '*') continue;
            let lo, hi;
            if (range.includes('-')) { [lo, hi] = range.split('-').map(Number); }
            else { lo = Number(range); hi = max; }
            if (lo < min || lo > max) return `field ${i + 1} ("${part}"): step start ${lo} outside valid range [${min},${max}]`;
            if (hi < lo) return `field ${i + 1} ("${part}"): range end ${hi} before start ${lo}`;
        }
    }
    return null;
}

export function cronDue(expr, date) {
    if (!expr || typeof expr !== 'string') return false;
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hour, dom, mon, dow] = parts;
    // POSIX cron special-case: when BOTH day-of-month and day-of-week are
    // restricted (neither is '*'), the day component matches if EITHER
    // field matches (OR), not both (AND) -- e.g. "0 0 1 * MON" means
    // "the 1st of the month, OR every Monday", not "only when the 1st is
    // a Monday". When only one (or neither) is restricted, plain AND
    // still applies since the unrestricted field is always true anyway.
    const domRestricted = dom !== '*';
    const dowRestricted = dow !== '*';
    const domMatch = fieldMatches(dom, date.getDate(), 1, 31);
    const dowMatch = fieldMatches(dow, date.getDay(), 0, 6);
    const dayMatch = (domRestricted && dowRestricted)
        ? (domMatch || dowMatch)
        : (domMatch && dowMatch);
    return fieldMatches(min, date.getMinutes(), 0, 59)
        && fieldMatches(hour, date.getHours(), 0, 23)
        && dayMatch
        && fieldMatches(mon, date.getMonth() + 1, 1, 12);
}

// Cap on how many missed minute-buckets a single tick will backfill after a
// sleep/throttled-tab gap. Bounds the catch-up burst -- a tab asleep for days
// still only replays the most recent MAX_CATCHUP_MINUTES, never an unbounded
// storm of queued chat.run calls.
const MAX_CATCHUP_MINUTES = 20;

export function startCronScheduler({ cron, getChatTool, intervalMs = 30000 }) {
    // In-memory minute-bucket cache, mirrored to (and seeded from) the jobs
    // table's own last_run column via cron.markRun so dedup survives a
    // reload -- a page reload mid-window no longer re-fires a job that
    // already ran in the same minute bucket before reload. Pruned every
    // tick against the live job id set so a job removed via cron.remove
    // doesn't leak its Map entry for the rest of the tab's life.
    let lastFiredMinute = new Map(); // job id -> last minute-bucket fired
    let lastFiredLocalMinute = new Map(); // job id -> last local wall-clock minute-of-year fired (DST fall-back dedup)
    let lastTickMinute = null; // wall-clock minute-bucket as of the previous successful tick, for gap detection
    let stopped = false;
    let inFlight = false;
    async function tick() {
        if (stopped) return;
        if (inFlight) return; // previous tick still dispatching chat.run -- skip this fire to avoid overlapping chat.run calls
        inFlight = true;
        try { await tickOnce(); }
        finally { inFlight = false; }
    }
    async function tickOnce() {
        let jobs;
        try { jobs = await cron.list(); }
        catch (e) { console.warn('[cron-scheduler] cron.list() failed:', e && e.message || e); return; }
        const liveIds = new Set(jobs.map(j => j.id));
        for (const id of lastFiredMinute.keys()) {
            if (!liveIds.has(id)) lastFiredMinute.delete(id);
        }
        for (const id of lastFiredLocalMinute.keys()) {
            if (!liveIds.has(id)) lastFiredLocalMinute.delete(id);
        }
        const now = new Date();
        const minuteBucket = Math.floor(now.getTime() / 60000);

        // Normally just the current minute. If the previous tick's bucket
        // is more than one minute behind (setInterval throttled/suspended
        // while backgrounded or the OS slept), backfill the missed minutes
        // so a job due during the gap still fires once -- bounded so a
        // multi-day-asleep tab doesn't replay an unbounded backlog.
        let buckets;
        if (lastTickMinute == null || minuteBucket <= lastTickMinute) {
            buckets = [minuteBucket];
        } else {
            const gap = minuteBucket - lastTickMinute;
            const startBucket = gap > MAX_CATCHUP_MINUTES
                ? minuteBucket - MAX_CATCHUP_MINUTES + 1
                : lastTickMinute + 1;
            buckets = [];
            for (let b = startBucket; b <= minuteBucket; b++) buckets.push(b);
        }
        lastTickMinute = minuteBucket;

        for (const job of jobs) {
            if (!job.enabled) continue;
            // Seed this job's in-memory bucket from the persisted last_run on
            // first sight (e.g. right after a reload) so a bucket that
            // already fired before reload isn't replayed.
            if (!lastFiredMinute.has(job.id) && job.last_run != null) {
                lastFiredMinute.set(job.id, job.last_run);
            }
            for (const bucket of buckets) {
                if (lastFiredMinute.get(job.id) === bucket) continue;
                const bucketDate = bucket === minuteBucket ? now : new Date(bucket * 60000);
                if (!cronDue(job.cron, bucketDate)) continue;
                // DST fall-back guard: buckets are consecutive UTC minutes, but
                // cronDue() matches against LOCAL wall-clock fields (getDate/
                // getHours/...), so during a fall-back transition two distinct
                // epoch buckets 60 minutes apart both map to the same local
                // wall-clock minute (e.g. 1:30am occurs twice). Without this
                // check a job pinned to that local minute would fire once per
                // epoch bucket -- i.e. twice in the same local minute. Key the
                // dedup on the local wall-clock minute-of-day (not the epoch
                // bucket) so only the first occurrence fires.
                // (Spring-forward is the mirror case: the skipped local hour
                // never appears in getHours() for any bucket that day, so a
                // job pinned to it legitimately does not fire -- same as any
                // cron implementation keyed on local time; not fixable without
                // changing the job's semantics to explicit UTC.)
                const localKey = bucketDate.getFullYear() * 527040 // day resolution guard for month/year rollover
                    + bucketDate.getMonth() * 44640
                    + bucketDate.getDate() * 1440
                    + bucketDate.getHours() * 60
                    + bucketDate.getMinutes();
                if (lastFiredLocalMinute.get(job.id) === localKey) { lastFiredMinute.set(job.id, bucket); continue; }
                lastFiredMinute.set(job.id, bucket);
                lastFiredLocalMinute.set(job.id, localKey);
                if (typeof cron.markRun === 'function') {
                    try { await cron.markRun(job.id, bucket); }
                    catch (e) { console.warn('[cron-scheduler] markRun', job.id, 'failed:', e && e.message || e); }
                }
                const chat = getChatTool();
                if (!chat || typeof chat.run !== 'function') break;
                try { await chat.run({ prompt: job.prompt }); }
                catch (e) { console.warn('[cron-scheduler] job', job.id, 'failed:', e && e.message || e); }
                break; // at most one fire per job per tick even if multiple missed buckets match
            }
        }
    }
    const timer = setInterval(tick, intervalMs);
    tick();
    return { stop() { stopped = true; clearInterval(timer); } };
}
