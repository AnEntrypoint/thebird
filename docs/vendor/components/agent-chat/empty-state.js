// AgentChat's zero-and-between-turn prompts: the fresh-thread empty state
// (with starter suggestions and the guided agent-install path) and the
// contextual follow-up chips shown under the last settled assistant turn.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Btn } from '../shell.js';

const h = webjsx.createElement;

// Empty state: a fresh thread is a void without this. Mirrors the kit's Chat
// empty surface (title, sub, optional starter prompts) with calm, factual
// copy rather than blank panel or invitational framing.
export function AgentEmptyState({ name, selectedAgent, suggestions, onSuggestionClick, installHint }) {
  return h('div', { class: 'agentchat-empty', role: 'status' },
    h('p', { class: 'agentchat-empty-title' }, selectedAgent ? name + ' is ready.' : 'Select an agent to start.'),
    h('p', { class: 'agentchat-empty-sub' },
      selectedAgent ? 'Type a message below.' : 'Pick an agent from the selector above, then send a message.'),
    (suggestions && suggestions.length)
      ? h('div', { class: 'agentchat-empty-suggestions' },
          ...suggestions.map((s, i) => h('button', {
            key: 'sug' + i, type: 'button', class: 'agentchat-empty-suggestion',
            onclick: () => { const t = typeof s === 'string' ? s : (s.prompt || s.text || ''); if (onSuggestionClick) onSuggestionClick(t); },
          }, typeof s === 'string' ? s : (s.label || s.text || s.prompt))))
      : null,
    // Guided install path for a brand-new user with zero installed agents:
    // a plain copy line, a monospaced command per row (each with its own
    // copy button, pure-DOM label flip like the code-block copy), and a
    // recheck button so the user needn't reload after installing.
    installHint
      ? h('div', { class: 'agentchat-install', role: 'group', 'aria-label': 'install an agent' },
          installHint.text ? h('p', { class: 'agentchat-install-text' }, installHint.text) : null,
          (installHint.commands && installHint.commands.length)
            ? h('ul', { class: 'agentchat-install-list' },
                ...installHint.commands.map((c, i) => h('li', { key: 'inst' + i, class: 'agentchat-install-row' },
                  h('span', { class: 'agentchat-install-agent' }, c.agent),
                  h('code', { class: 'agentchat-install-cmd' }, c.command),
                  h('button', {
                    type: 'button', class: 'agentchat-install-copy',
                    'aria-label': 'copy install command for ' + c.agent, title: 'copy command',
                    onclick: (e) => {
                      const btn = e.currentTarget;
                      const done = () => { btn.textContent = 'copied'; setTimeout(() => { btn.textContent = 'copy'; }, 1200); };
                      // Falls back whenever the async Clipboard API is
                      // absent OR its promise rejects (permission denied,
                      // an unfocused document) instead of optimistically
                      // claiming "copied" before the write is confirmed.
                      const fallback = () => { try { const t = document.createElement('textarea'); t.value = c.command; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); done(); } catch { /* swallow: no copy mechanism available */ } };
                      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c.command).then(done, fallback);
                      else fallback();
                    },
                  }, 'copy'))))
            : null,
          installHint.onRecheck
            ? h('div', { class: 'agentchat-install-actions' },
                Btn({ onClick: () => installHint.onRecheck(), children: 'recheck agents', title: 'Re-check installed agents' }))
            : null)
      : null);
}

// Contextual follow-up chips below the last SETTLED assistant turn (claude.ai/
// code / cowork surface these after a turn, not only on an empty thread).
export function FollowupRow({ followups, onFollowupClick, onSuggestionClick }) {
  return h('div', { class: 'agentchat-followups', role: 'group', 'aria-label': 'suggested follow-ups' },
    ...followups.map((s, i) => h('button', {
      key: 'fu' + i, type: 'button', class: 'agentchat-empty-suggestion agentchat-followup',
      onclick: () => { const t = typeof s === 'string' ? s : (s.prompt || s.text || ''); if (onFollowupClick) onFollowupClick(t); else if (onSuggestionClick) onSuggestionClick(t); },
    }, typeof s === 'string' ? s : (s.label || s.text || s.prompt))));
}
