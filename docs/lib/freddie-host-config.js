// freddie-host config: default config, env keys, command/platform registries,
// HookType + SDK hook mapping, plugin helpers, and small deep-merge/dot-path
// utilities used by the config surface. Split out of docs/freddie-host.js
// (pure move, no behavior change).

export const HookType = {
    PRE_TOOL_USE: 'pre_tool_use',
    POST_TOOL_USE: 'post_tool_use',
    USER_PROMPT_SUBMIT: 'user_prompt_submit',
    NOTIFICATION: 'notification',
    STOP: 'stop',
};

export const FREDDIE_DEFAULT_CONFIG = {
    _config_version: 1,
    display: { skin: 'default', tool_progress_command: false, background_process_notifications: 'all' },
    agent: { provider: 'anthropic', model: '', max_iterations: 90, fallback_model: null, save_trajectories: false },
    memory: { provider: null },
    skills: { config: {} },
    terminal: { cwd: null },
    gateway: { timeout: 60, platforms: {} },
    plugins: { enabled: [] },
    toolsets: { enabled: ['core'], disabled: [] },
    providers: {
        freddie: { baseUrl: 'http://localhost:3030' },
        // openai.baseUrl is the PRIMARY LLM gateway — acptoapi (https://github.com/AnEntrypoint/acptoapi)
        // runs locally on :4800 and multiplexes Anthropic / OpenAI / Groq / Cerebras / OpenRouter /
        // Mistral / Gemini / etc using its own .env-loaded keys. Falls through to freddie
        // (providers.freddie.baseUrl) then direct-from-browser providers if acptoapi is down.
        // Request `auto` so acptoapi self-routes to whatever model is live in its
        // own chain. Pinning a specific provider (e.g. groq) makes acptoapi auth-fail
        // and walk its full slow fallback chain (each dead ACP daemon times out over
        // tens of seconds) when that provider's key is absent from acptoapi's .env,
        // which blows past the agent runtime's per-call timeout. `auto` short-circuits
        // to acptoapi's default queue and returns in ~1s from the first live provider.
        openai: { baseUrl: 'http://localhost:4800', model: 'auto' },
    },
    // gatewayChain is the ordered, never-reject failover list of OpenAI-compatible base URLs
    // tried in sequence by the chat tool. acptoapi first, then any user-added compat endpoints.
    gatewayChain: ['http://localhost:4800'],
};

export const FREDDIE_ENV_KEYS = [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
    'GOOGLE_API_KEY', 'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'NVIDIA_API_KEY',
    'CLOUDFLARE_API_KEY', 'SAMBANOVA_API_KEY', 'CODESTRAL_API_KEY', 'ZAI_API_KEY',
    'QWEN_API_KEY', 'OPENCODE_ZEN_API_KEY',
    'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET',
    'WHATSAPP_API_TOKEN', 'SIGNAL_CLI_URL', 'MATRIX_HOMESERVER', 'MATTERMOST_URL',
    'HONCHO_API_KEY', 'MEM0_API_KEY', 'SUPERMEMORY_API_KEY', 'BYTEROVER_API_KEY',
    'HINDSIGHT_API_KEY', 'OPENVIKING_API_KEY', 'RETAINDB_API_KEY', 'SERPAPI_KEY',
    'REPLICATE_API_TOKEN', 'SMTP_HOST', 'TWILIO_SID', 'HASS_TOKEN',
];

export const FREDDIE_COMMAND_REGISTRY = [
    { name: 'run', category: 'core', description: 'Send prompt to configured LLM, stream response' },
    { name: 'tools', category: 'core', description: 'List registered tools' },
    { name: 'skills', category: 'core', description: 'List registered skills' },
    { name: 'exec', category: 'core', description: 'Run a single prompt non-interactively' },
    { name: 'memory', category: 'memory', description: 'Memory CRUD' },
    { name: 'skill', category: 'skills', description: 'Run a freddie skill against a prompt' },
    { name: 'config', category: 'config', description: 'Get/set freddie config values' },
    { name: 'sessions', category: 'sessions', description: 'List sessions' },
    { name: 'cron', category: 'cron', description: 'Manage cron jobs' },
    { name: 'batch', category: 'batch', description: 'Run prompts in parallel' },
    { name: 'projects', category: 'projects', description: 'Switch project (instance)' },
];

export const FREDDIE_GATEWAY_PLATFORMS = [
    'telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'mattermost',
    'email', 'sms', 'webhook', 'api_server', 'feishu', 'wecom', 'qqbot', 'homeassistant',
];

export function definePlugin(spec) {
    if (!spec || !spec.name) throw new Error('definePlugin: name required');
    return { kind: 'plugsdk', name: spec.name, tools: spec.tools || [], hooks: spec.hooks || [], meta: spec.meta || {} };
}

export const allowResult = (data) => ({ decision: 'allow', data });
export const blockResult = (reason) => ({ decision: 'block', reason });
export const modifyResult = (data) => ({ decision: 'modify', data });

export const FREDDIE_TO_SDK_HOOK = {
    preToolUse: HookType.PRE_TOOL_USE,
    postToolUse: HookType.POST_TOOL_USE,
    userPromptSubmit: HookType.USER_PROMPT_SUBMIT,
    notification: HookType.NOTIFICATION,
    stop: HookType.STOP,
};

export function deepMerge(target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const k of Object.keys(src)) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], src[k]);
        else target[k] = src[k];
    }
    return target;
}

export function clone(o) { return structuredClone(o); }

export function setDot(obj, dotpath, value) {
    const keys = String(dotpath).split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
        cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
}

export function getDot(obj, dotpath, fallback) {
    return String(dotpath).split('.').reduce((c, k) => (c && k in c) ? c[k] : undefined, obj) ?? fallback;
}
