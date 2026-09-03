// AgentChat thread scroll behaviour: the auto-scroll ref composed with a
// scroll listener that reveals the jump-to-latest button once the user has
// scrolled away from the live edge, plus the window/stream-tail constants the
// row builder renders against.

import { makeThreadAutoScroll } from '../chat.js';

// Auto-scroll behaviour is the shared chat helper; bind it to this thread's
// live message count. (`makeThreadAutoScroll` takes a getter so the observer
// always compares against current state, not a value captured at mount.)
const baseAutoScroll = (msgCount) => makeThreadAutoScroll(() => msgCount);

// Compose the auto-scroll ref with a scroll listener that reveals the
// jump-to-latest button when the user has scrolled away from the bottom. This
// is the scroll-anchoring fix: auto-scroll only pins when the user is already at
// the bottom (the IntersectionObserver gate), so reading back-history is no
// longer fought; the button is the explicit way back to the live edge.
const NEAR_BOTTOM_PX = 80;

// Thread window: how many trailing turns render by default (hosts override via
// shownMessages; grow with onShowEarlier).
export const MESSAGE_CAP = 100;
// A single streaming message beyond this many chars renders only a tail window
// per frame (O(tail), not O(turn)); the settled turn renders full markdown once.
export const STREAM_TAIL_THRESHOLD = 20000;
export const STREAM_TAIL_WINDOW = 4000;

export const threadRef = (msgCount) => {
  const auto = baseAutoScroll(msgCount);
  return (el) => {
    if (!el) return;
    const disposeAuto = auto(el);
    const jumpBtn = () => el.parentElement && el.parentElement.querySelector('.agentchat-jump');
    const update = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      const btn = jumpBtn();
      if (btn) btn.classList.toggle('show', !atBottom);
    };
    el.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
    return () => { el.removeEventListener('scroll', update); if (typeof disposeAuto === 'function') disposeAuto(); };
  };
};

// Scroll a thread to its live edge — used by the jump-to-latest button.
export function scrollThreadToBottom(btn) {
  const wrap = btn.closest('.agentchat-thread-wrap');
  const thread = wrap && wrap.querySelector('.agentchat-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}
