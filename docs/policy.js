// In-browser policy/guardrail engine, modeled on docs/audit.js's conventions:
// factory function (not a class, except the one Error subclass), persists
// through the existing per-instance fs (docs/instance-fs.js) rather than
// inventing its own storage, and matches docs/sdk.js's dependency-free
// plain-JS style.

// Actions this engine gates. Kept as plain strings (not frozen symbols) so
// they serialize to JSON untouched and match docs/audit.js's AuditEvent shape
// where relevant (file.read/file.write/git.clone/git.push line up 1:1).
export const PolicyAction = {
    FILE_READ: 'file.read',
    FILE_WRITE: 'file.write',
    PROCESS_SPAWN: 'process.spawn',
    SERVER_BIND: 'server.bind',
    TOOL_USE: 'tool.use',
    GIT_CLONE: 'git.clone',
    GIT_PUSH: 'git.push',
};

const ACTIONS = new Set(Object.values(PolicyAction));

const LIMIT_KINDS = new Set(['maxFileSize', 'maxProcesses', 'maxTurns', 'timeoutSec']);

const POLICY_CONFIG_KEY = 'policy';

const DEFAULT_LIMITS = {
    maxFileSize: null,
    maxProcesses: null,
    maxTurns: null,
    timeoutSec: null,
};

// Thrown by check()/checkLimit() on denial. A real Error subclass (not a
// plain object) so `instanceof PolicyDeniedError` works for callers that
// want to distinguish policy denials from other thrown errors.
export class PolicyDeniedError extends Error {
    constructor(action, target, rule) {
        super('policy denied: ' + action + ' ' + JSON.stringify(target) +
            (rule ? ' (rule: ' + JSON.stringify(rule) + ')' : ' (limit exceeded)'));
        this.name = 'PolicyDeniedError';
        this.action = action;
        this.target = target;
        this.rule = rule || null;
    }
}

// Dependency-free glob-to-regex compiler. Supports:
//   *   any chars except '/'
//   **  any chars including '/'
//   ?   a single char
// Literal regex-special chars are escaped. Anchored full-string match.
export function globToRegex(pattern) {
    let out = '';
    const str = String(pattern);
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '*') {
            if (str[i + 1] === '*') {
                out += '.*';
                i++;
            } else {
                out += '[^/]*';
            }
        } else if (c === '?') {
            out += '[^/]';
        } else if ('.+^${}()|[]\\'.includes(c)) {
            out += '\\' + c;
        } else {
            out += c;
        }
    }
    return new RegExp('^' + out + '$');
}

function defaultPolicyConfig() {
    return { rules: [], limits: { ...DEFAULT_LIMITS } };
}

export function createPolicyEngine(instance, auditLog, opts = {}) {
    const fs = instance && instance.fs;
    if (!fs) throw new Error('createPolicyEngine: instance.fs required');
    const defaultDeny = !!opts.defaultDeny;

    function readPolicyConfig() {
        const cfg = fs.getConfig();
        const policy = cfg[POLICY_CONFIG_KEY];
        if (!policy || typeof policy !== 'object') return defaultPolicyConfig();
        return {
            rules: Array.isArray(policy.rules) ? policy.rules : [],
            limits: { ...DEFAULT_LIMITS, ...(policy.limits && typeof policy.limits === 'object' ? policy.limits : {}) },
        };
    }

    // Reads the FULL existing config, merges in the policy sub-object, and
    // writes the whole thing back -- never overwrites unrelated config keys
    // (providers/defaultProvider/etc live alongside `policy` in the same
    // /etc/freddie/config.yaml document).
    function writePolicyConfig(policy) {
        const cfg = fs.getConfig();
        cfg[POLICY_CONFIG_KEY] = policy;
        fs.setConfig(cfg);
    }

    function logDeny(action, target, rule) {
        if (auditLog && typeof auditLog.log === 'function') {
            auditLog.log('policy.deny', 'policy', { action, target, rule: rule || null });
        }
    }

    function check(action, target, context = {}) {
        if (!ACTIONS.has(action)) {
            // Unknown action kind: nothing configured can gate it, fail open.
            return true;
        }
        const { rules } = readPolicyConfig();
        const actionRules = rules.filter(r => r.action === action);
        if (!actionRules.length) return true; // no rules for this action -> default allow

        for (const rule of actionRules) {
            let re;
            try { re = globToRegex(rule.pattern); } catch { continue; }
            if (re.test(String(target))) {
                if (rule.allow) return true;
                logDeny(action, target, rule);
                throw new PolicyDeniedError(action, target, rule);
            }
        }

        // No rule matched this target, but rules DO exist for this action.
        if (defaultDeny) {
            logDeny(action, target, null);
            throw new PolicyDeniedError(action, target, null);
        }
        return true;
    }

    function checkLimit(kind, value) {
        if (!LIMIT_KINDS.has(kind)) return true;
        const { limits } = readPolicyConfig();
        const limit = limits[kind];
        if (limit == null) return true; // no limit configured for this kind
        if (value > limit) {
            logDeny('limit.' + kind, value, { kind, limit });
            throw new PolicyDeniedError('limit.' + kind, value, { kind, limit });
        }
        return true;
    }

    function getRules() {
        return readPolicyConfig().rules;
    }

    function setRules(rules) {
        const policy = readPolicyConfig();
        policy.rules = Array.isArray(rules) ? rules : [];
        writePolicyConfig(policy);
    }

    function getLimits() {
        return readPolicyConfig().limits;
    }

    function setLimits(limits) {
        const policy = readPolicyConfig();
        policy.limits = { ...DEFAULT_LIMITS, ...(limits && typeof limits === 'object' ? limits : {}) };
        writePolicyConfig(policy);
    }

    return { check, checkLimit, getRules, setRules, getLimits, setLimits, PolicyAction, PolicyDeniedError };
}
