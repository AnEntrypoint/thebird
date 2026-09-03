// Turn-to-vnode translation for AgentChat: the windowed thread render, the
// mid-stream part downgrades that keep a long streaming turn O(tail) instead of
// O(turn^2), the streaming-caret placement, and the per-message action row.

import { ChatMessage } from '../chat.js';
import { STREAM_TAIL_THRESHOLD, STREAM_TAIL_WINDOW } from './thread-behaviour.js';

// A message carries content (text/parts) when it has a non-empty content
// string OR at least one part. Used for the empty-shell skip + working tail
// so an interleaved turn (parts-only, no m.content) is not treated as empty.
export const msgHasBody = (m) => !!(m.content || (Array.isArray(m.parts) && m.parts.length));

// Build the visible turn rows. `msgStart` is the window's absolute start index
// (rows keep their ABSOLUTE index so streaming/caret/actions logic keys off the
// real lastIdx, not the window offset).
export function buildMessageRows({ messages, msgStart, lastIdx, busy, name, avatar,
                                   onCopyMessage, onRetryMessage, onEditMessage, confirmEdit, onArmEdit }) {
  return messages.slice(msgStart).map((m, wi) => {
    const i = wi + msgStart; // absolute index — streaming/caret/actions logic keys off the real lastIdx
    const isAssistant = m.role === 'assistant';
    const isStreaming = busy && i === lastIdx && isAssistant;
    const hasParts = Array.isArray(m.parts) && m.parts.length > 0;
    const emptyStreaming = isStreaming && !msgHasBody(m);
    // A finished assistant message with no content and no parts is an empty
    // shell (e.g. an aborted turn) — render nothing rather than a blank bubble.
    if (!isStreaming && isAssistant && !msgHasBody(m)) return null;
    // Render order follows m.parts so text and tool cards INTERLEAVE in arrival
    // order (text -> tool -> text -> tool). A message's parts may be bare
    // strings (legacy) OR structured {kind,...} objects (md/tool/tool_result/
    // code/...) passed straight through to ChatMessage.renderPart — this is what
    // lets an orchestration host render the kit's collapsible ToolCallNode
    // inline instead of flattening tools to the end of the turn.
    const parts = [];
    if (hasParts) {
      for (const p of m.parts) {
        const part = (p && typeof p === 'object' && p.kind) ? p : { kind: 'text', text: String(p) };
        // While a turn is still streaming, render its prose as cheap inline text
        // rather than full markdown: MdNode re-parses + re-sanitizes the WHOLE
        // accumulated source and swaps the entire bubble innerHTML on every frame
        // (O(n^2) over the turn, with a visible reflow). Downgrade md -> text
        // mid-stream; the settled turn below renders real markdown once.
        // Carry a `mdShell` flag so the streaming-text bubble uses the same
        // container shape (.chat-md padding/spacing) the settled markdown will
        // use — only the inner content swaps on settle, so the bubble box does
        // not reflow/jump when the turn finishes and renders real markdown.
        if (isStreaming && part.kind === 'md') {
          const txt = part.text || '';
          // Giant streamed block: re-rendering the whole accumulated string per
          // rAF is O(n^2) across the turn. Past the threshold, render a preShell
          // bubble with a 'streaming · N KB so far' head plus only the last
          // STREAM_TAIL_WINDOW chars; full markdown renders once on settle.
          if (txt.length > STREAM_TAIL_THRESHOLD) {
            parts.push({ kind: 'text', mdShell: true, preShell: true,
              text: txt.slice(-STREAM_TAIL_WINDOW),
              streamHead: 'streaming · ' + Math.round(txt.length / 1024) + ' KB so far' });
            continue;
          }
          // If the streaming prose contains a code fence, the inline renderer
          // (which has no triple-backtick handling) would show it as run-on text
          // with literal ``` and no monospace, then snap into a styled <pre> on
          // settle (a visible reflow during the most-watched moment). Detect a
          // fence and render the bubble as a cheap monospaced <pre> shell instead
          // (no Prism mid-stream, so no O(n^2)) so it does not reflow on settle.
          if (part.text && part.text.indexOf('```') !== -1) parts.push({ kind: 'text', text: part.text, mdShell: true, preShell: true });
          else parts.push({ kind: 'text', text: part.text, mdShell: true });
        }
        else if (!isStreaming && part.kind === 'thinking') parts.push({ kind: 'thinking', settled: true, text: part.text });
        else parts.push(part);
      }
    }
    // m.content is the legacy/simple path (user messages, hosts that don't build
    // interleaved parts). Only prepend it when the parts array doesn't already
    // carry prose, so a parts-driven turn isn't double-rendered.
    const partsHaveProse = parts.some(p => p.kind === 'md' || p.kind === 'text');
    if (m.content && !partsHaveProse) parts.unshift({ kind: isAssistant ? 'md' : 'text', text: m.content });
    // The streaming caret rides the live assistant turn once it has body (the
    // empty-shell turn already shows the inline typing dots).
    const streaming = isStreaming && msgHasBody(m);
    // Place the caret inline inside the last text/md part rather than as a
    // sibling span (which renders as a block below the last bubble). Tag the
    // last text part so PART_RENDERERS.text can append it as an inline child.
    if (streaming && parts.length) {
      const lastPart = parts[parts.length - 1];
      if (lastPart && (lastPart.kind === 'text' || lastPart.kind === 'md')) {
        parts[parts.length - 1] = { ...lastPart, streamingCaret: true };
      }
    }
    // Per-message actions: the host supplies onCopyMessage / onRetryMessage; we
    // build the action row only for SETTLED messages (no actions mid-stream).
    let actions;
    if (!isStreaming && msgHasBody(m)) {
      const built = [];
      if (onCopyMessage) built.push({ label: 'copy', icon: 'copy', title: 'copy message', onClick: () => onCopyMessage(m) });
      // Mid-thread retry: EVERY settled assistant turn gets a retry action,
      // not only the trailing one - the host truncates from that turn's
      // position and resends (the same mechanism edit-and-resend uses for
      // user messages), so any assistant reply the user was unhappy with can
      // be redone without discarding turns that came after a LATER one.
      if (isAssistant && onRetryMessage) built.push({ label: 'retry', icon: 'refresh', title: 'retry this turn', onClick: () => onRetryMessage(m) });
      // A dangling user message (send failed / no reply arrived) can only be
      // the LAST message when it has no assistant reply - retry here means
      // "resend as-is", not "redo a specific turn", so stays lastIdx-gated.
      if (!isAssistant && onRetryMessage && i === lastIdx) built.push({ label: 'retry', icon: 'refresh', title: 'retry', onClick: () => onRetryMessage(m) });
      // With confirmEdit the host arms its own confirm affordance (onArmEdit)
      // instead of resending immediately; the kit stays stateless either way.
      if (!isAssistant && onEditMessage) built.push({ label: 'edit', icon: 'pencil', title: 'edit and resend',
        onClick: () => (confirmEdit && onArmEdit) ? onArmEdit(m) : onEditMessage(m) });
      if (built.length) actions = built;
    }
    return ChatMessage({
      key: m.id || String(i),
      role: isAssistant ? 'assistant' : 'user',
      // Claude-Code-web layout: flat full-width turns (no avatar disc, no colored
      // bubble), distinguished by a role label + a faint assistant background.
      // aicat is left OFF so the mascot tint never reaches the agent surface.
      flat: true,
      aicat: false,
      // A stable per-agent product mark (host passes a small line-SVG via
      // `avatar`) instead of a per-agent letter initial that shifts identity.
      avatar: isAssistant ? (m.avatar != null ? m.avatar : avatar) : undefined,
      name: isAssistant ? name : 'you',
      time: m.time || '',
      typing: emptyStreaming,
      streaming,
      actions,
      // Out-of-band notices (plain copy, neutral tone): m.stopped marks a
      // cancelled turn; m.incomplete marks a turn whose stream dropped without
      // replay. Retry rides the existing actions row.
      stopped: m.stopped,
      incomplete: m.incomplete,
      // A failed trailing turn (the host's send/stream rejected, regardless
      // of which role the placeholder message landed on) gets its error
      // pinned to that specific turn, with retry right there — same pattern
      // as stopped/incomplete, but destructive-toned since this is a genuine
      // failure rather than a neutral "not finished" state.
      error: i === lastIdx ? m.error : undefined,
      onRetry: (i === lastIdx && m.error && onRetryMessage) ? () => onRetryMessage(m) : undefined,
      parts: emptyStreaming ? undefined : (parts.length ? parts : [{ kind: 'text', text: '' }]),
    });
  });
}
