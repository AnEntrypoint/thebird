// Wire-format translation for the dashboard chat page: SSE frame parsing and
// the dashboard-message -> kit-ChatMessage shape conversion.

export function parseSseEvents(text) {
    const events = [];
    let curEvent = null, curData = '';
    for (const line of text.split('\n')) {
        if (line.startsWith('event: ')) { curEvent = line.slice(7).trim(); }
        else if (line.startsWith('data: ')) { curData = line.slice(6).trim(); }
        else if (line === '' && curEvent) {
            try { events.push({ event: curEvent, data: JSON.parse(curData) }); } catch { /* swallow: a malformed SSE event is dropped, the stream continues */ }
            curEvent = null; curData = '';
        }
    }
    return events;
}

// Convert the dashboard message shape into the kit ChatMessage shape:
//   { role:'user', content:string }   -> { role:'user', text }
//   { role:'assistant', content:string } -> { role:'assistant', parts:[{kind:'md', text}] }
//   { role:'tool', name, argsSummary, content } ->
//       { role:'tool', parts:[{kind:'tool_call', name, label, args, result, status}] }
//   { role:'thinking' } -> { role:'thinking', parts:[{kind:'thinking', text}] }
export function toKitMessage(m) {
    if (m.role === 'tool') {
        const status = m.status || (m.error ? 'error' : (m.content != null ? 'done' : 'running'));
        return { role: 'tool', parts: [{ kind: 'tool_call', name: m.name || 'tool', label: m.argsSummary || '', args: m.args || m.input || {}, result: m.content, status, error: !!m.error, open: status !== 'done' }] };
    }
    if (m.role === 'thinking') return { role: 'thinking', parts: [{ kind: 'thinking', text: m.content || 'thinking…' }] };
    if (m.role === 'assistant' && m.content) return { role: 'assistant', parts: [{ kind: 'md', text: String(m.content) }] };
    return { role: m.role, text: m.content || '' };
}
