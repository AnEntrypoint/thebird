// playCompletionCue — short two-tone audio cue (e.g. "agent turn finished"),
// ported from pi-web's useAudio. The voice surface otherwise covers voice-call
// UI (PTT/VAD/webcam/queue), not simple one-shot notification tones, so this is
// the missing piece rather than a duplicate. A single AudioContext is reused
// (module-scoped) so a browser autoplay-suspended context can be resumed
// instead of leaking a fresh context per call.

let _cueCtx = null;
function getCueCtx() {
    if (_cueCtx && _cueCtx.state !== 'closed') return _cueCtx;
    try { _cueCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    return _cueCtx;
}

export function playCompletionCue() {
    const ctx = getCueCtx();
    if (!ctx) return;
    const play = () => {
        try {
            const now = ctx.currentTime;
            [523.25, 659.25].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const t = now + i * 0.18;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
                osc.start(t);
                osc.stop(t + 0.45);
            });
        } catch { /* swallow: AudioContext/oscillator unsupported, cue is best-effort */ }
    };
    if (ctx.state === 'suspended') { ctx.resume().then(play).catch(() => {}); return; }
    play();
}
