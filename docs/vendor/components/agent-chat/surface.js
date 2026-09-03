// AgentChat — the composed surface: controls + cwd bar + banners, then the
// thread body (windowed rows, working tail, jump-to-latest, optional minimap)
// and the composer, optionally split against a host-supplied side preview pane.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { ChatComposer } from '../chat.js';
import { Icon } from '../shell.js';
import { SplitPanel } from '../editor-primitives.js';
import { initializeCachesEagerly } from '../../markdown-cache.js';
import { ChatMinimap } from '../chat-minimap.js';
import { threadRef, scrollThreadToBottom, MESSAGE_CAP } from './thread-behaviour.js';
import { AgentControls, CwdBar } from './controls.js';
import { buildMessageRows, msgHasBody } from './message-rows.js';
import { AgentEmptyState, FollowupRow } from './empty-state.js';

const h = webjsx.createElement;

// AgentChat — the composed surface.
//   agents, selectedAgent, models, selectedModel : picker state
//   messages : [{ id, role:'user'|'assistant', content, time, parts:[string] }]
//   busy, draft, status                          : stream + composer state
//   cwd, cwdEditing, cwdDraft                    : working-directory bar
//   banners                                      : array of pre-built Alert vnodes (errors, resume, unavailable)
//   onSelectAgent/onSelectModel/onSend/onStop/onNewChat/onInput
//   onCwdEdit/onCwdSave/onCwdCancel/onCwdClear/onCwdDraft
export function AgentChat(props = {}) {
  const {
    agents = [], selectedAgent = '', models = [], selectedModel = '', modelsLoading = false, agentsLoading = false,
    messages = [], busy = false, draft = '', status, banners = [],
    cwd = '', cwdEditing = false, cwdDraft, cwdError, cwdChecking = false,
    cwdRoots, cwdRecent, cwdBrowse, defaultCwd,
    agentName, placeholder,
    onSelectAgent, onSelectModel, onSend, onStop, onNewChat, onInput,
    onCwdEdit, onCwdSave, onCwdCancel, onCwdClear, onCwdDraft,
    onCwdBrowseToggle, onCwdBrowseCrumb, onCwdBrowseEnter, onCwdBrowsePick,
    canSend = true,
    suggestions = [], onSuggestionClick,
    onCopyMessage, onRetryMessage, onEditMessage,
    confirmEdit = false, onArmEdit,
    avatar, composerContext,
    followups = [], onFollowupClick,
    installHint, exportActions = [],
    onPasteFiles, onDropFiles, onEmoji,
    shownMessages, onShowEarlier,
    streamingSince, detectAttachment,
    // @-mention file autocomplete in the composer — a flat list of file paths
    // the host already has (e.g. its Files tab data source). Purely forwarded
    // to ChatComposer; omitting it keeps every existing caller unchanged (no
    // mention affordance appears without it).
    mentionFiles,
    // Optional scroll-position minimap alongside the thread (ChatMinimap).
    // false/omitted keeps every existing caller byte-identical (no minimap
    // column at all). true renders the strip using this component's own
    // thread ref via a shared getter — no extra DOM wiring needed from the
    // host beyond passing showMinimap.
    showMinimap = false,
    // Optional inline content viewer beside the thread (a docstudio-cue
    // addition: its chat view keeps a live document/PDF preview open next to
    // the conversation instead of forcing a separate tab/window). The host
    // supplies the actual preview vnode (FilePreviewPane/FileViewer or
    // anything else) - this component only owns the split layout + a close
    // affordance. Omitting sidePanel keeps every existing caller's output
    // byte-identical (no SplitPanel wrapper at all when absent).
    sidePanel, sidePanelTitle = 'preview', onCloseSidePanel,
  } = props;

  // Warm the markdown/Prism stack the moment the surface mounts so the CDN
  // round-trip never starts mid-first-response. Self-idempotent (internal
  // _initPromise), so the per-render call is free after the first.
  initializeCachesEagerly().catch((err) => console.warn('[247420] cache init error:', err));

  const name = agentName || (agents.find((a) => a.id === selectedAgent)?.name) || selectedAgent || 'agent';
  const lastIdx = messages.length - 1;
  const lastMsg = messages[lastIdx];
  // Windowed thread render (mirrors FileGrid's cap): only the last `limit`
  // turns build vnodes each frame; a keyed 'show N earlier turns' row at the
  // top grows the window via onShowEarlier (host keeps state.chat.shownMessages
  // and resets it on newChat/loadSession). A 500-turn conversation no longer
  // rebuilds 500 ChatMessage vnodes per streaming rAF tick.
  const msgLimit = shownMessages != null ? shownMessages : MESSAGE_CAP;
  const msgStart = Math.max(0, messages.length - msgLimit);
  // True when streaming but the live assistant turn already shows content/parts,
  // so its inline typing dots have stopped — a long silent tool call would
  // otherwise read as frozen. We append a standalone "working" indicator below.
  const lastMsgLastPart = lastMsg && Array.isArray(lastMsg.parts) && lastMsg.parts.length ? lastMsg.parts[lastMsg.parts.length - 1] : null;
  const showWorkingTail = busy && lastMsg && lastMsg.role === 'assistant' && msgHasBody(lastMsg)
    && lastMsgLastPart && lastMsgLastPart.kind === 'tool' && lastMsgLastPart.status === 'running';
  const rows = buildMessageRows({ messages, msgStart, lastIdx, busy, name, avatar,
                                 onCopyMessage, onRetryMessage, onEditMessage, confirmEdit, onArmEdit });
  // Keyed 'show N earlier turns' control at the top of the window. A keyed
  // VElement like every row sibling (webjsx keying discipline).
  const earlierRow = msgStart > 0
    ? h('div', { key: '_earlier', class: 'agentchat-earlier' },
        h('span', { class: 'agentchat-earlier-count', role: 'status', 'aria-live': 'polite' },
          'showing ' + (messages.length - msgStart) + ' of ' + messages.length + ' turns'),
        onShowEarlier ? h('button', { type: 'button', class: 'agentchat-earlier-btn',
          onclick: () => onShowEarlier(Math.min(messages.length, msgLimit + MESSAGE_CAP)) },
          'show ' + Math.min(MESSAGE_CAP, msgStart) + ' earlier turns') : null)
    : null;

  // While streaming, the composer's send button becomes an inline stop button
  // (busy + onCancel) so the user can halt the turn from where their hands
  // already are, not only from the controls cluster up top.
  const composer = ChatComposer({
    value: draft,
    disabled: !canSend,
    busy,
    placeholder: placeholder || (selectedAgent ? 'message…' : 'choose an agent first'),
    onInput: (v) => onInput && onInput(v),
    onSend: (v) => onSend && onSend(v),
    onCancel: busy && onStop ? () => onStop() : undefined,
    // The active target (agent / model / cwd-basename) at the point of typing.
    context: composerContext,
    // Paste/drop file intents (image paste, file drop) — host-wired; the
    // composer itself always preventDefaults the drop so the browser never
    // navigates away from a live session.
    onPasteFiles,
    onDropFiles,
    onEmoji,
    streamingSince,
    detectAttachment,
    mentionFiles,
  });

  // Shown only when not busy and the last message is an assistant turn with body.
  const followupRow = (!busy && followups && followups.length && lastMsg && lastMsg.role === 'assistant' && msgHasBody(lastMsg))
    ? FollowupRow({ followups, onFollowupClick, onSuggestionClick })
    : null;

  const emptyState = (messages.length === 0)
    ? AgentEmptyState({ name, selectedAgent, suggestions, onSuggestionClick, installHint })
    : null;

  // ChatMinimap needs a getter that resolves the live thread element lazily
  // (it may mount before the thread's own ref fires). A holder object keeps
  // the element across re-renders without introducing component state.
  const threadElHolder = { el: null };
  const combinedThreadRef = (el) => {
    threadElHolder.el = el;
    const dispose = threadRef(messages.length)(el);
    return dispose;
  };

  const threadBody = h('div', { class: 'agentchat-thread-wrap' },
    h('div', { class: 'agentchat-thread', ref: combinedThreadRef, role: 'log', 'aria-label': 'conversation', 'aria-live': 'polite', 'aria-relevant': 'additions' },
      emptyState,
      earlierRow,
      ...rows.filter(Boolean),
      showWorkingTail
        ? h('div', { key: '_working', class: 'agentchat-working', role: 'status', 'aria-live': 'polite' },
            h('span', { class: 'chat-thinking-dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
            h('span', { class: 'agentchat-working-text' }, 'working…'))
        : null,
      followupRow),
    // Jump-to-latest: hidden until the scroll listener adds .show (user scrolled
    // up). Clicking returns to the live edge. Pure-DOM, like the kit's other
    // stateless chrome, so the host needn't thread scroll state through state.
    h('button', { class: 'agentchat-jump', type: 'button', 'aria-label': 'jump to latest', title: 'jump to latest',
      onclick: (e) => scrollThreadToBottom(e.currentTarget) },
      Icon('arrow-down', { size: 16 }), h('span', { class: 'agentchat-jump-label' }, 'latest')),
    // Optional scroll-position overview strip, sharing the same live thread
    // element the auto-scroll/jump logic already resolves via threadElHolder.
    showMinimap
      ? ChatMinimap({ messages, getThreadEl: () => threadElHolder.el })
      : null);

  const mainColumn = h('div', { class: 'agentchat-main-col' },
    h('div', { class: 'agentchat-head' },
      h('h1', { class: 'agentchat-title' }, name + (selectedModel ? ' · ' + selectedModel : '')),
      h('span', { class: 'agentchat-sub', 'aria-hidden': busy ? 'true' : null },
        // Derive the busy label from the same status prop the controls use, so a
        // reconnecting-while-streaming state reads one word everywhere instead of
        // the head saying "streaming…" while the controls say "reconnecting…".
        busy ? (status || 'streaming…') : (messages.length ? messages.length + (messages.length === 1 ? ' message' : ' messages') : ''))),
    threadBody,
    composer);

  // sidePanel renders the caller's content vnode (a FilePreviewPane, a plain
  // iframe/embed, anything) inside a resizable SplitPanel beside the thread -
  // omitted entirely when sidePanel is falsy so every existing caller's DOM
  // output is byte-unchanged.
  const body = sidePanel
    ? SplitPanel({ orientation: 'horizontal', initial: '55%', min: 320,
        children: [
          mainColumn,
          h('div', { class: 'agentchat-side-panel' },
            h('div', { class: 'agentchat-side-panel-head' },
              h('span', { class: 'agentchat-side-panel-title' }, sidePanelTitle),
              onCloseSidePanel
                ? h('button', { type: 'button', class: 'agentchat-side-panel-close', 'aria-label': 'close preview', title: 'close preview', onclick: onCloseSidePanel }, Icon('x', { size: 14 }))
                : null),
            h('div', { class: 'agentchat-side-panel-body' }, sidePanel)),
        ] })
    : mainColumn;

  return h('div', { class: 'agentchat' + (sidePanel ? ' has-side-panel' : '') },
    AgentControls({ agents, selectedAgent, models, selectedModel, busy, status, modelsLoading, agentsLoading,
                    onSelectAgent, onSelectModel, onNewChat, onStop, exportActions }),
    CwdBar({ cwd, editing: cwdEditing, draft: cwdDraft, error: cwdError, checking: cwdChecking,
             roots: cwdRoots, recent: cwdRecent, browse: cwdBrowse, defaultCwd,
             onEdit: onCwdEdit, onSave: onCwdSave, onCancel: onCwdCancel, onClear: onCwdClear, onDraft: onCwdDraft,
             onBrowseToggle: onCwdBrowseToggle, onBrowseCrumb: onCwdBrowseCrumb, onBrowseEnter: onCwdBrowseEnter, onBrowsePick: onCwdBrowsePick }),
    ...(banners || []).filter(Boolean),
    body,
  );
}
