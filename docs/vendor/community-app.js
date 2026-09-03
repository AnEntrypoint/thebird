// community-app — the full chat/community application GUI, owned by the design
// system. A consumer (e.g. zellous over Nostr) supplies an `adapter` that maps
// its own data + actions to the contract below; this module composes every
// surface (rail, chat, members, voice, user panel, overlays) and wires it to
// the adapter. The consumer never touches component internals — it only feeds
// data and receives action callbacks.
//
// Adapter contract (all fields optional; the app degrades when one is absent):
//   adapter.brandName  // string shown in the topbar brand span; defaults to 'app'
//   adapter.get() -> snapshot {
//     channels, categories, servers, currentChannel, currentServerId, homeMode,
//     messages,  // each message may carry reactions: [{emoji, count, users?, you?}]
//     chatInputValue, currentUser, userId,
//     isConnected, voiceConnected, voiceChannelName, voiceConnectionState,
//     voiceParticipants, micMuted, voiceDeafened,
//     audioQueueItems, audioQueueCurrentId, audioQueuePaused,
//     showAuthModal, settingsOpen, voiceSettingsOpen, replyTarget,
//     mobileMenuOpen,  // drives the .ca-rail off-canvas drawer on narrow shells
//     canManage,       // gates the rail's "+ create channel" affordance
//     forumPosts,      // ch.type==='forum': [{id,title,snippet,author,time,replyCount,tags?}]
//     pageHtml, pageAuthor, pageUpdatedAt  // ch.type==='page': PageView content + attribution
//   }
//   adapter.subscribe(cb) -> unsubscribe   // cb fires when any snapshot field changes
//   adapter.actions = {
//     switchChannel(ch), send(text, opts), toggleMic(), toggleDeafen(),
//     leaveVoice(), toggleMembers(), openMobileMenu(), closeMobileMenu(), openSettings(),
//     channelContext(id, x, y), serverContext(id, x, y), switchServer(id),
//     goHome(), openServers(), memberMenu(id, name, x, y),
//     replaySegment(id), skipSegment(), pauseQueue(), resumeQueue(),
//     setInput(v), startReply(msg), cancelReply(), deleteMessage(id),
//     reactToMessage(id, authorUserId, emoji)  // optional; emoji defaults ('+') when omitted from the trigger
//     createChannel()  // optional; when present + canManage, rail shows a "+" next to "rooms"
//   }
//   adapter.helpers = { avatarColor(id), initial(name), formatTime(ts) }
//
// Returns { render, destroy }.

import * as webjsx from '../vendor/webjsx/index.js';
import { Icon } from './components/shell.js';
import { register } from './debug.js';
import { Chat, ChatComposer } from './components/chat.js';
import {
    ServerRail, ChannelItem, MemberList, MobileHeader,
    UserPanel, VoiceStrip, VoiceUser, ThreadPanel, ForumView, PageView, Banner,
} from './components/community.js';
import { VoiceControls, VoiceSettingsModal, AudioQueue, PttButton, VadMeter, WebcamPreview } from './components/voice.js';
import { ContextMenu } from './components/editor-primitives.js';
import { EmojiPicker, CommandPalette, AuthModal, BootOverlay, SettingsPopover, VideoLightbox } from './components/overlay-primitives.js';

const h = webjsx.createElement;

// announcement previously used 'megaphone', whose two-arc speaker-cone SVG
// path reads as visually near-identical to the voice channel's 'speaker'
// icon at rail size (15px) -- easy to confuse a text-only broadcast channel
// for a live voice room. 'send' (paper-plane) reads distinctly as
// one-way/outbound at a glance and shares no silhouette with 'speaker'.
const CHANNEL_ICON = { voice: 'speaker', forum: 'forum', threaded: 'thread', announcement: 'send', page: 'page', text: 'hash' };

export function mountCommunityApp(root, adapter = {}) {
    if (!root) throw new Error('mountCommunityApp: root required');
    const get = typeof adapter.get === 'function' ? adapter.get : () => ({});
    const A = adapter.actions || {};
    const H = adapter.helpers || {};
    // The topbar brand name was hardcoded 'zellous' -- a design-system
    // component should not bake in one consumer's name. Any host can supply
    // its own via adapter.brandName; 'app' is a neutral, non-branded fallback.
    const brandName = adapter.brandName || 'app';
    const avatarColor = H.avatarColor || (() => 'var(--accent)');
    const initial = H.initial || ((n) => String(n || '?').slice(0, 1).toUpperCase());
    const formatTime = H.formatTime || ((t) => new Date(t || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

    // overlay state owned by the app module (imperative surfaces the consumer triggers)
    let ctx = { open: false, x: 0, y: 0, items: [] };
    let emoji = { open: false, x: 0, y: 0, onSelect: null };
    let palette = { open: false, items: [], onSelect: null };

    const railView = (s) => {
        const out = [];
        const channels = [...(s.channels || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
        const text = channels.filter(c => c.type !== 'voice' && c.type !== 'threaded');
        const voice = channels.filter(c => c.type === 'voice' || c.type === 'threaded');
        const cur = s.currentChannel || {};
        const servers = s.servers || [];
        if (text.length || !servers.length) {
            out.push(groupHeader('rooms', s));
        }
        if (text.length) {
            for (const c of text) out.push(railPill(c, cur, false, s));
        } else if (!servers.length) {
            out.push(h('div', { class: 'rail-empty', role: 'status' }, 'no rooms yet'));
        }
        if (voice.length) {
            out.push(h('div', { class: 'group' }, 'voice'));
            for (const c of voice) out.push(railPill(c, cur, true, s));
        }
        if (servers.length) {
            out.push(h('div', { class: 'group' }, 'servers'));
            out.push(railServerPill({ name: 'home', _home: true }, s));
            for (const sv of servers) out.push(railServerPill(sv, s));
        }
        return h('div', {}, ...out);
    };

    const groupHeader = (label, s) => h('div', { class: 'group group-header' },
        h('span', {}, label),
        (s.canManage && A.createChannel)
            ? h('button', {
                type: 'button', class: 'group-add-btn', 'aria-label': 'create channel', title: 'Create channel',
                onclick: (e) => { e.preventDefault(); e.stopPropagation(); A.createChannel(); },
            }, Icon('plus', { size: 13 }))
            : null);

    const railPill = (c, cur, isVoice, s) => {
        const active = cur.id === c.id;
        const inVoice = isVoice && s.voiceConnected && s.voiceChannelName === c.name;
        const glyph = inVoice ? h('span', { class: 'glyph', 'aria-hidden': 'true' }, h('span', { class: 'ds-dot ds-dot-live' }))
            : (c.type === 'threaded' ? h('span', { class: 'glyph', 'aria-hidden': 'true' }, Icon('circle-dot', { size: 15 }))
                : h('span', { class: 'glyph', 'aria-hidden': 'true' }, Icon(CHANNEL_ICON[c.type] || 'hash', { size: 15 })));
        return h('a', {
            href: '#', class: active ? 'active' : '', 'aria-label': (c.name || c.id) + (inVoice ? ' (in voice)' : ''),
            onclick: (e) => { e.preventDefault(); A.switchChannel && A.switchChannel(c); },
            oncontextmenu: (e) => { e.preventDefault(); A.channelContext && A.channelContext(c.id, e.clientX, e.clientY); },
        }, glyph, h('span', {}, c.name || c.id),
            c.unreadCount ? h('span', { class: 'count' }, c.unreadCount > 99 ? '99+' : String(c.unreadCount)) : null);
    };

    const railServerPill = (sv, s) => {
        const active = sv._home ? s.homeMode : (!s.homeMode && s.currentServerId === sv.id);
        return h('a', {
            href: '#', class: active ? 'active' : '', 'aria-label': sv._home ? 'home' : (sv.name || sv.id),
            onclick: (e) => { e.preventDefault(); sv._home ? (A.goHome && A.goHome()) : (A.switchServer && A.switchServer(sv.id)); },
            oncontextmenu: sv._home ? null : (e) => { e.preventDefault(); A.serverContext && A.serverContext(sv.id, e.clientX, e.clientY); },
        }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, sv._home ? Icon('square', { size: 15 }) : (sv.name || '?').slice(0, 1).toUpperCase()),
            h('span', {}, sv.name || sv.id),
            sv.unreadCount ? h('span', { class: 'count' }, sv.unreadCount > 99 ? '99+' : String(sv.unreadCount)) : null);
    };

    const CODE_FENCE_RE = /^```([a-zA-Z0-9_+-]*)\n([\s\S]*?)\n?```\s*$/;
    const partsFromMessage = (m) => {
        const parts = [];
        if (m.replyTo) {
            const who = m.replyTo.username || (m.replyTo.userId && A.resolveProfile && A.resolveProfile(m.replyTo.userId)) || 'User';
            const quoted = m.replyTo.content ? (m.replyTo.content || '').replace(/\n/g, ' ').slice(0, 120) : '(message unavailable)';
            parts.push({ kind: 'md', text: '> **@' + who + ':** ' + quoted });
        }
        const content = m.content || '';
        const fence = content.match(CODE_FENCE_RE);
        if (m.type === 'code' || fence) parts.push({ kind: 'code', code: fence ? fence[2] : content, lang: fence ? fence[1] : (m.lang || '') });
        else if (m.type === 'image') { const src = m.url || m.imageUrl || m.src; if (src) parts.push({ kind: 'image', src, alt: m.alt || '', caption: m.caption }); else if (content) parts.push({ kind: 'md', text: content }); }
        else if (m.type === 'file') parts.push({ kind: 'file', src: m.url || m.fileUrl || m.src, name: m.name || m.filename || 'attachment', size: m.size });
        else if (content) parts.push({ kind: 'md', text: content });
        if (Array.isArray(m.attachments)) for (const a of m.attachments) {
            if (!a) continue;
            if (a.type === 'image' && (a.src || a.url)) parts.push({ kind: 'image', src: a.src || a.url, alt: a.alt || '', caption: a.caption });
            else if ((a.src || a.url) && (a.name || a.filename)) parts.push({ kind: 'file', src: a.src || a.url, name: a.name || a.filename, size: a.size });
        }
        return parts;
    };

    const mapMessages = (s) => {
        const chatMsgs = s.messages || [];
        const selfId = s.userId;
        return chatMsgs.map((m, i) => {
            if (m.type === 'system') return { key: m.id || ('sys' + i), who: 'them', name: '', parts: [{ kind: 'md', text: '_' + (m.text || '') + '_' }] };
            const username = (A.resolveProfile && A.resolveProfile(m.userId)) || m.username || 'User';
            const isYou = selfId && String(m.userId) === String(selfId);
            const reactions = Array.isArray(m.reactions) ? m.reactions.map(r => ({ emoji: r.emoji, count: r.count != null ? r.count : (r.users ? r.users.length : 1), you: !!(r.you || (r.users && selfId && r.users.includes(selfId))) })) : null;
            const msgActions = [
                {
                    label: 'react', title: 'react to ' + username + '\'s message', icon: 'smile',
                    onClick: (e) => {
                        if (!A.reactToMessage) return;
                        const rect = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
                        if (api.emojiPicker) {
                            api.emojiPicker.show(rect ? rect.left : 200, rect ? rect.bottom + 4 : 200, (em) => A.reactToMessage(m.id, m.userId, em));
                        } else {
                            A.reactToMessage(m.id, m.userId);
                        }
                    },
                },
                { label: 'reply', title: 'reply to ' + username, icon: 'corner-up-left', onClick: () => A.startReply && A.startReply({ id: m.id, userId: m.userId, username, content: m.content }) },
                // "delete" is honest about what this actually does: a
                // relay-side deletion request (NIP-09 kind:5), which relays
                // are not obligated to honor and which other clients may
                // have already cached before it arrives -- not a guarantee
                // of removal. The title makes that explicit rather than
                // implying certain content removal.
                isYou ? { label: 'delete', title: 'request deletion (relays may not honor it; other clients may have already cached this message)', icon: 'trash', onClick: () => A.deleteMessage && A.deleteMessage(m.id) } : null,
            ].filter(Boolean);
            return { key: m.id || ('m' + i), who: isYou ? 'you' : 'them', name: isYou ? null : username, avatar: initial(username), time: formatTime(m.timestamp), parts: partsFromMessage(m), reactions, onToggleReaction: A.reactToMessage ? (emoji) => A.reactToMessage(m.id, m.userId, emoji) : null, actions: msgActions, receipt: isYou && m.read ? 'read' : (isYou && m.delivered ? 'delivered' : null) };
        });
    };

    const chatView = (s) => {
        const ch = s.currentChannel || {};
        const sub = ch.type === 'voice' ? 'voice' : ch.type === 'forum' ? 'forum' : ch.type === 'page' ? 'page' : ch.type === 'announcement' ? 'announcement' : 'public';
        const rt = s.replyTarget;
        const replyPreview = rt ? h('div', { class: 'cm-reply-preview', role: 'status' },
            h('span', { class: 'cm-reply-preview-label' }, 'Replying to ' + (rt.username || 'User')),
            h('button', { type: 'button', class: 'cm-reply-preview-close', 'aria-label': 'cancel reply', title: 'cancel reply', onclick: (e) => { e.preventDefault(); A.cancelReply && A.cancelReply(); } }, Icon('x', { size: 14 }))
        ) : null;
        return Chat({
            title: ch.name || 'general', sub, messages: mapMessages(s), header: null,
            composer: h('div', { class: 'cm-composer-wrap' }, replyPreview, ChatComposer({
                value: s.chatInputValue || '',
                placeholder: rt ? 'reply to ' + (rt.username || 'User') + '…' : 'message #' + (ch.name || 'general') + '…',
                onInput: (v) => A.setInput && A.setInput(v),
                onSend: (v) => { const t = (v || '').trim(); if (t) A.send && A.send(t, rt ? { replyTo: rt } : undefined); },
            })),
        });
    };

    const voiceView = (s) => h('div', { class: 'vx-view' },
        h('div', { class: 'vx-grid' }, ...(s.voiceParticipants || []).map((p, i) => VoiceUser({ ...p, key: p.identity || p.id || i }))),
        s.webcamEnabled ? WebcamPreview({ videoStream: s.webcamStream, resolution: s.webcamResolution, fps: s.webcamFps, enabled: true }) : null,
        s.pttUiMode === 'vad' ? VadMeter({ level: s.micRawLevel || 0, threshold: s.vadThreshold, onThresholdChange: (t) => A.setVadThreshold && A.setVadThreshold(t) }) : null,
        s.pttUiMode === 'ptt' || s.pttUiMode == null ? PttButton({ state: s.isSpeaking ? 'live' : 'idle', mode: 'ptt', onHoldStart: () => A.pttStart && A.pttStart(), onHoldEnd: () => A.pttStop && A.pttStop() }) : null,
        VoiceControls({
            muted: !!s.micMuted, deafened: !!s.voiceDeafened,
            onMic: () => A.toggleMic && A.toggleMic(),
            onDeafen: () => A.toggleDeafen && A.toggleDeafen(),
            onSettings: () => A.openVoiceSettings && A.openVoiceSettings(),
            onLeave: () => A.leaveVoice && A.leaveVoice(),
        }),
    );

    const view = () => {
        const s = get();
        const ch = s.currentChannel || {};
        const inVoiceChannel = ch.type === 'voice';
        const bodyMain = inVoiceChannel ? voiceView(s)
            : ch.type === 'forum' ? ForumView({ posts: s.forumPosts || [], onSelect: (id) => A.openThread && A.openThread(id), onNewPost: () => A.newForumPost && A.newForumPost() })
            : ch.type === 'page' ? PageView({ title: ch.name, html: s.pageHtml || '', author: s.pageAuthor || '', updatedAt: s.pageUpdatedAt || 0, isAdmin: !!s.canManage, onEdit: () => A.editPage && A.editPage() })
            : chatView(s);
        const showVoiceBanner = s.voiceConnected && s.voiceChannelName && !(inVoiceChannel && s.voiceChannelName === ch.name);
        return h('div', { class: 'ca-app' },
            // Same skip-link contract AppShell() provides. This app builds its
            // own chrome, so without this a keyboard user had to tab through
            // the whole topbar nav and channel rail to reach the messages.
            h('a', { href: '#app-main', class: 'skip-link' }, 'skip to main content'),
            // top bar (sole app chrome above the chat-head)
            h('header', { class: 'app-topbar' },
                h('span', { class: 'brand' }, brandName, h('span', { class: 'slash' }, ' / '), h('span', {}, ch.name || 'general')),
                h('span', {}),
                h('nav', {},
                    h('a', { href: '../', title: 'Home', onclick: (e) => { if (A.goHome) { e.preventDefault(); A.goHome(); } } }, 'home'),
                    h('a', { href: '#', title: 'Servers', onclick: (e) => { e.preventDefault(); A.openServers && A.openServers(); } }, 'servers'),
                    h('a', { href: 'https://github.com/AnEntrypoint/zellous', target: '_blank', rel: 'noopener' }, 'source ->'),
                ),
            ),
            MobileHeader({ channelType: ch.type || 'text', channelName: ch.name || '', onMenu: () => A.openMobileMenu && A.openMobileMenu(), onMembers: () => A.toggleMembers && A.toggleMembers() }),
            Banner({ tone: 'warning', message: 'No relay connected. Reconnecting…', visible: s.isConnected === false }),
            Banner({ tone: 'success', visible: !!showVoiceBanner, message: showVoiceBanner ? ('In voice: ' + (s.voiceChannelName || '') + ' — click to return') : '', actionLabel: 'Leave', onAction: (e) => { if (e && e.stopPropagation) e.stopPropagation(); A.leaveVoice && A.leaveVoice(); }, onClick: () => A.returnToVoice && A.returnToVoice() }),
            h('div', { class: 'app-body' + (s.mobileMenuOpen ? ' ca-rail-open' : '') },
                h('aside', { class: 'app-side ca-rail' + (s.mobileMenuOpen ? ' open' : '') }, railView(s)),
                // id + tabindex match AppShell()'s contract so the skip link
                // above actually lands somewhere; this app builds its own shell
                // and so inherited neither.
                h('main', { class: 'app-main', id: 'app-main', tabindex: '0', onclick: () => { if (s.mobileMenuOpen && A.closeMobileMenu) A.closeMobileMenu(); } },
                    // The channel name is the page title, but it lived only in
                    // the topbar brand span, leaving the document with no
                    // heading at all. sr-only because the topbar and chat-head
                    // already show it — this adds the semantics, not a visual.
                    h('h1', { class: 'sr-only' }, ch.name || 'general'),
                    !inVoiceChannel && s.voiceConnected ? VoiceStrip({ channelName: s.voiceChannelName, status: s.voiceConnectionState || 'connected', muted: !!s.micMuted, deafened: !!s.voiceDeafened, onMute: () => A.toggleMic && A.toggleMic(), onDeafen: () => A.toggleDeafen && A.toggleDeafen(), onLeave: () => A.leaveVoice && A.leaveVoice(), open: true }) : null,
                    UserPanel({ name: (s.currentUser && (s.currentUser.displayName || s.currentUser.username || s.currentUser.name)) || 'You', tag: s.currentUser && s.currentUser.tag, color: avatarColor(s.userId), muted: !!s.micMuted, deafened: !!s.voiceDeafened, onMute: () => A.toggleMic && A.toggleMic(), onDeafen: () => A.toggleDeafen && A.toggleDeafen(), onSettings: () => A.openSettings && A.openSettings() }),
                    bodyMain,
                ),
                MemberList({ categories: s.memberCategories || [], open: !!s.memberListOpen }),
            ),
            // overlays
            ctx.open ? ContextMenu({ items: ctx.items, anchor: { x: ctx.x, y: ctx.y }, onClose: () => { ctx = { ...ctx, open: false }; render(); } }) : null,
            emoji.open ? EmojiPicker({ open: true, anchorX: emoji.x, anchorY: emoji.y, onSelect: (em) => { try { emoji.onSelect && emoji.onSelect(em); } catch (_) { /* swallow: consumer onSelect callback must not break overlay close/re-render */ } emoji = { ...emoji, open: false }; render(); }, onClose: () => { emoji = { ...emoji, open: false }; render(); } }) : null,
            palette.open ? CommandPalette({ open: true, items: palette.items, onSelect: (it) => { try { palette.onSelect && palette.onSelect(it); } catch (_) { /* swallow: consumer onSelect callback must not break overlay close/re-render */ } palette = { ...palette, open: false }; render(); }, onClose: () => { palette = { ...palette, open: false }; render(); } }) : null,
            // global overlays (visibility driven by adapter snapshot)
            s.showAuthModal ? AuthModal({ open: true, mode: s.authMode || 'extension', error: s.authError || '', busy: !!s.authBusy, onModeChange: (m) => A.setAuthMode && A.setAuthMode(m), onConnectExtension: () => A.authExtension && A.authExtension(), onGenerate: () => A.authGenerate && A.authGenerate(), onImport: (k) => A.authImport && A.authImport(k), onClose: () => A.closeAuth && A.closeAuth() }) : null,
            BootOverlay({ progress: s.bootProgress || 0, phase: s.bootPhase || '', errored: !!s.bootErrored, visible: !!s.bootVisible }),
            s.settingsOpen ? SettingsPopover({ open: true, anchorX: (s.settingsAnchor && s.settingsAnchor.x) || 0, anchorY: (s.settingsAnchor && s.settingsAnchor.y) || 0, sections: s.settingsSections || [], onClose: () => A.openSettings && A.openSettings() }) : null,
            s.voiceSettingsOpen ? VoiceSettingsModal({ open: true, mode: s.voiceMode || 'ptt', inputId: s.inputDeviceId, outputId: s.outputDeviceId, inputDevices: s.inputDevices || [], outputDevices: s.outputDevices || [], vadThreshold: s.vadThreshold, rnnoise: !!s.rnnoiseEnabled, autoGain: !!s.autoGainEnabled, forceTurn: !!s.forceTurnEnabled, bitrate: s.voiceBitrate, volume: s.masterVolume, onChange: (p) => A.voiceSettingsChange && A.voiceSettingsChange(p), onSave: () => A.voiceSettingsSave && A.voiceSettingsSave(), onCancel: () => A.voiceSettingsClose && A.voiceSettingsClose(), onClose: () => A.voiceSettingsClose && A.voiceSettingsClose() }) : null,
            s.videoLightbox && s.videoLightbox.open ? VideoLightbox({ open: true, src: s.videoLightbox.src, label: s.videoLightbox.label, onClose: () => A.closeVideoLightbox && A.closeVideoLightbox() }) : null,
            (s.audioQueueItems && s.audioQueueItems.length) ? AudioQueue({ segments: s.audioQueueItems, currentSegmentId: s.audioQueueCurrentId, paused: !!s.audioQueuePaused, onReplay: (id) => A.replaySegment && A.replaySegment(id), onSkip: () => A.skipSegment && A.skipSegment(), onResume: () => A.resumeQueue && A.resumeQueue(), onPause: () => A.pauseQueue && A.pauseQueue() }) : null,
            s.threadPanelOpen ? ThreadPanel({ threads: s.threads || [], activeId: s.activeThreadId, onSelect: (id) => A.selectThread && A.selectThread(id), onCreate: () => A.createThread && A.createThread(), onClose: () => A.closeThreadPanel && A.closeThreadPanel() }) : null,
        );
    };

    const render = () => { webjsx.applyDiff(root, view()); };

    // imperative overlay API the consumer (and its modules) can call
    const api = {
        contextMenu: { show: (items, x, y) => { ctx = { open: true, x: x | 0, y: y | 0, items: Array.isArray(items) ? items : [] }; render(); }, close: () => { ctx = { ...ctx, open: false }; render(); } },
        emojiPicker: { show: (x, y, onSelect) => { emoji = { open: true, x: x || 200, y: y || 200, onSelect }; render(); }, close: () => { emoji = { ...emoji, open: false }; render(); } },
        commandPalette: { show: (items, onSelect) => { palette = { open: true, items: items || [], onSelect }; render(); }, close: () => { palette = { ...palette, open: false }; render(); } },
        render,
    };

    let unsub = null;
    if (typeof adapter.subscribe === 'function') unsub = adapter.subscribe(render);

    // Observability: expose live overlay + snapshot state for in-browser inspection.
    register('community-app', () => {
        const s = get() || {};
        return {
            overlays: { context: ctx.open, emoji: emoji.open, palette: palette.open },
            channels: (s.channels || []).length,
            servers: (s.servers || []).length,
            messages: (s.messages || []).length,
            currentChannel: (s.currentChannel || {}).name || null,
            voiceConnected: !!s.voiceConnected,
            homeMode: !!s.homeMode,
        };
    });

    render();
    return { render, api, destroy: () => { if (unsub) try { unsub(); } catch (_) { /* swallow: unsubscribe failure during teardown is non-fatal */ } } };
}
