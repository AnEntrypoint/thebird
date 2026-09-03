// Pure helpers for a chat input's "@" file-mention autocomplete: detecting an
// in-progress @token before the caret, ranking a flat file/dir index against
// the typed query, and building the replacement text on completion.
// Framework-independent — no DOM, no webjsx — wire into any composer's
// oninput/onkeydown handlers.

/**
 * Detect an "@" file token immediately before the cursor. The "@" must sit at
 * the start of the text or be preceded by whitespace, so emails like
 * foo@bar never trigger. Supports the quoted form @"my dir/fi so
 * space-containing paths can be typed into.
 * @param {string} textBeforeCursor
 * @returns {{start:number, query:string, quoted:boolean}|null}
 */
export function extractAtQuery(textBeforeCursor) {
    const quoted = /(?:^|\s)@"([^"\n]*)$/.exec(textBeforeCursor)
    if (quoted) {
        return { start: textBeforeCursor.length - (quoted[1].length + 2), query: quoted[1], quoted: true }
    }
    const plain = /(?:^|\s)@([^\s"]*)$/.exec(textBeforeCursor)
    if (plain) {
        return { start: textBeforeCursor.length - (plain[1].length + 1), query: plain[1], quoted: false }
    }
    return null
}

function pathDepth(p) {
    let depth = 0
    for (let i = 0; i < p.length; i++) if (p[i] === '/') depth++
    return depth
}

/**
 * Build a { path, isDir } entry list from a flat file-path list, deriving
 * directory entries by walking each path's "/" segments. Base order is
 * shallow-first then alphabetical (what an empty "@" query should show).
 * @param {string[]} files
 * @returns {{path:string, isDir:boolean}[]}
 */
export function buildEntriesFromFiles(files) {
    const dirs = new Set()
    for (const f of files) {
        let idx = f.indexOf('/')
        while (idx !== -1) {
            dirs.add(f.slice(0, idx))
            idx = f.indexOf('/', idx + 1)
        }
    }
    const entries = []
    for (const d of dirs) entries.push({ path: d, isDir: true })
    for (const f of files) {
        if (!f) continue
        entries.push({ path: f, isDir: false })
    }
    entries.sort((a, b) => pathDepth(a.path) - pathDepth(b.path) || a.path.localeCompare(b.path))
    return entries
}

function isSubsequence(needle, haystack) {
    if (!needle) return true
    let i = 0
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
        if (haystack[j] === needle[i]) i++
    }
    return i === needle.length
}

/**
 * Score ladder: exact 100 / prefix 80 / substring 50 / path-substring 30,
 * directories get +10, plus a low-weight subsequence fallback (10) so a
 * loose query like "chinp" still finds components/ChatInput.tsx. Queries
 * containing "/" rank against the full relative path (drill-down support).
 */
function scoreEntry(entry, lowerQuery) {
    const lowerPath = entry.path.toLowerCase()
    let score = 0
    if (lowerQuery.includes('/')) {
        if (lowerPath === lowerQuery) score = 100
        else if (lowerPath.startsWith(lowerQuery)) score = 80
        else if (lowerPath.includes(lowerQuery)) score = 50
        else if (isSubsequence(lowerQuery, lowerPath)) score = 10
    } else {
        const slash = lowerPath.lastIndexOf('/')
        const lowerName = slash === -1 ? lowerPath : lowerPath.slice(slash + 1)
        if (lowerName === lowerQuery) score = 100
        else if (lowerName.startsWith(lowerQuery)) score = 80
        else if (lowerName.includes(lowerQuery)) score = 50
        else if (lowerPath.includes(lowerQuery)) score = 30
        else if (isSubsequence(lowerQuery, lowerPath)) score = 10
    }
    if (entry.isDir && score > 0) score += 10
    return score
}

export const AT_RESULT_LIMIT = 20

/**
 * Rank+filter a file index against a typed query, capped at `limit`.
 * @param {{path:string, isDir:boolean}[]} entries
 * @param {string} query
 * @param {number} [limit]
 */
export function filterFileEntries(entries, query, limit = AT_RESULT_LIMIT) {
    const lowerQuery = query.toLowerCase()
    if (!lowerQuery) return entries.slice(0, limit)
    const scored = []
    for (const entry of entries) {
        const score = scoreEntry(entry, lowerQuery)
        if (score > 0) scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score || pathDepth(a.entry.path) - pathDepth(b.entry.path) || a.entry.path.localeCompare(b.entry.path))
    return scored.slice(0, limit).map(s => s.entry)
}

/**
 * Replacement text for the @token when a suggestion is confirmed. Files
 * close the token ("@path ", quoted if it has spaces), caret after the
 * trailing space. Directories stay open for drill-down ("@dir/"), no
 * trailing space — quoted directories close instead (@"my dir/") with the
 * caret placed before the closing quote.
 * @returns {{text:string, cursorOffset:number}}
 */
export function buildAtInsertText(entryPath, isDir, forceQuotes = false) {
    const p = isDir ? `${entryPath}/` : entryPath
    const needsQuotes = forceQuotes || p.includes(' ')
    if (isDir) {
        const text = needsQuotes ? `@"${p}"` : `@${p}`
        return { text, cursorOffset: needsQuotes ? text.length - 1 : text.length }
    }
    const text = needsQuotes ? `@"${p}" ` : `@${p} `
    return { text, cursorOffset: text.length }
}

/** Closed one-shot @mention (e.g. an explorer's "@" button) — directories close too. */
export function buildAtMentionText(entryPath, isDir) {
    const p = isDir ? `${entryPath}/` : entryPath
    return p.includes(' ') ? `@"${p}" ` : `@${p} `
}

export function buildFileAtMentionsText(entryPaths) {
    return entryPaths.map(entryPath => buildAtMentionText(entryPath, false)).join('')
}
