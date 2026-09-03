// AgentChat — a reusable multi-agent orchestration chat surface.
//
// This kit takes the best of two surfaces: agentgui's orchestration chat
// (agent-then-model picker, streamed tool_use/tool_result parts, resume + cwd
// controls, error alerts) and the AICat chat thread (IntersectionObserver
// auto-scroll, a thinking indicator, polished head). It is a PURE component:
// props in, vnode out. It holds NO transport — every server interaction is a
// callback the host wires (WebSocket, fetch, SSE, whatever). That keeps the kit
// reusable by any app, not just agentgui.
//
// The host owns state; AgentChat renders it and calls back on intent.
//
// This module is a barrel: the surface and its parts live in
// single-responsibility submodules under ./agent-chat/, and the public export
// surface here is unchanged — no consumer import needs to move.

import { MESSAGE_CAP } from './agent-chat/thread-behaviour.js';
import { AgentChat } from './agent-chat/surface.js';

export { MESSAGE_CAP, AgentChat };
