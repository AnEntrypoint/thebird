// SSE transport for the freddie chat page: a generic POST-friendly
// Server-Sent-Events frame decoder plus the two payload->AgentChat-part
// mappers (streaming tool_progress, and the authoritative post-`done`
// rebuild from freddie's persisted message list).

// Parse a fetch Response body as a Server-Sent-Events frame stream. There is
// no EventSource-over-POST in browsers (EventSource only does GET, no custom
// headers/body), so a POST-based SSE consumer has to manually decode the
// ReadableStream and split on blank-line-terminated `event: X\ndata: Y\n\n`
// frames. No existing SSE-parsing utility exists elsewhere in this SDK
// (checked idb-outbox.js and grepped src/ for `text/event-stream`) -- this is
// the first, generic enough (event name + JSON.parse'd data) to reuse for any
// future SSE endpoint, not freddie-chat-specific in shape.
export async function* parseSseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // Frames are separated by a blank line; a frame may itself contain
            // multiple `field: value` lines (event/data/id/retry) but this
            // server only ever emits one `event:` + one `data:` line per frame.
            let sep;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
                const frame = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                let event = 'message', dataLines = [];
                for (const line of frame.split('\n')) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                }
                if (!dataLines.length) continue;
                let data;
                try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); }
                yield { event, data };
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* swallow: stream already closed/errored */ }
    }
}

// Map a freddie tool_progress SSE payload ({name, args, partial}) to an
// AgentChat tool part. There is no matching id to correlate a later
// "done" state (freddie's stream has no discrete tool-start/tool-end pair --
// tool_progress fires zero-or-more times per call while it runs, and the
// authoritative role:'tool' result only arrives batched in the final
// `message`/`done` events) so every progress part renders as 'running'; the
// turn-settle pass below promotes matching parts to 'done'/'error' once the
// real tool_call_id/content pairs are known.
export function toolProgressPart(payload) {
    return { kind: 'tool', name: payload.name || 'tool', args: payload.args || {}, status: 'running' };
}

// After `done`, freddie's persisted message list is the source of truth:
// walk it and rebuild the assistant turn's parts as interleaved
// text/tool/tool_result, replacing the provisional tool_progress-only parts
// accumulated during streaming. assistant messages with tool_calls become
// running tool parts (by call id); role:'tool' messages settle the matching
// part to done/error by tool_call_id.
export function partsFromMessages(assistantAndToolMessages) {
    const parts = [];
    const byId = new Map();
    for (const m of assistantAndToolMessages) {
        if (m.role === 'assistant') {
            if (m.content) parts.push({ kind: 'md', text: m.content });
            for (const tc of (m.tool_calls || [])) {
                const part = { kind: 'tool', _id: tc.id, name: tc.name || tc.function?.name || 'tool', args: tc.arguments || tc.function?.arguments || {}, status: 'running' };
                parts.push(part);
                if (tc.id) byId.set(tc.id, part);
            }
        } else if (m.role === 'tool') {
            const target = m.tool_call_id ? byId.get(m.tool_call_id) : null;
            let content = m.content;
            let isError = false;
            try { const parsed = JSON.parse(content); if (parsed && parsed.error) { isError = true; } } catch { /* swallow: not JSON, leave as-is */ }
            if (target) { target.result = content; target.status = isError ? 'error' : 'done'; target.error = isError || undefined; }
            else parts.push({ kind: 'tool_result', name: 'result', result: content, error: isError || undefined, status: isError ? 'error' : 'done' });
        }
    }
    return parts;
}
