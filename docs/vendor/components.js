// Component barrel — matches upstream export surface 1:1.

import * as webjsx from '../vendor/webjsx/index.js';
export const h = webjsx.createElement;

export {
    Brand, Chip, Btn, Glyph, Icon, IconButton, Badge, Pill,
    Topbar, Crumb, Side, Status, AppShell,
    WorkspaceShell, WorkspaceRail,
    Heading, Lede, Dot, Rail
} from './components/shell.js';

export {
    Panel, Card, Row, RowLink, PanelFromItems,
    Hero, HeroFromPageData, Marquee, Install, CliBlock, Receipt, Changelog,
    WorksList, WritingList, Manifesto, Section, PageHeader,
    Kpi, Sparkline, BarChart, Table, HealthTable, ProcessRegistryTable, SearchInput, TextField, Select, EventList,
    HomeView, ProjectView, Form, InputOTP,
    Spinner, Skeleton, Alert, FilterPills, Avatar, avatarInitial
} from './components/content.js';

export {
    fmtBytes, renderInline, hasSelectionInside,
    ChatMessage, ChatComposer, Chat, flashComposerNote, ChatSuggestions,
    AICAT_FACE, AICatPortrait, AICat
} from './components/chat.js';

export { AgentChat, MESSAGE_CAP } from './components/agent-chat.js';

export { ChatMinimap, CHAT_MINIMAP_WIDTH } from './components/chat-minimap.js';

export {
    ConversationList, SessionCard, SessionDashboard, SessionMeta, fmtDuration, fmtTime, fmtAgo, AgentListSkeleton
} from './components/sessions.js';

export { ContextPane, ContextMeter, ContextTreemap, ContextXRayPanel } from './components/context-pane.js';

export { SpreadsheetPreview } from './components/spreadsheet-preview.js';

export { GitStatusPanel, GitDiffView } from './components/git-status.js';

export { WorktreeSwitcher } from './components/worktree-switcher.js';

export { PluginsConfig } from './components/plugins-config.js';

export { SkillsConfig } from './components/skills-config.js';

export { ModelsConfig } from './components/models-config.js';

export {
    DEFAULT_PHASES, PhaseWalk, TreeNode, BarRow, RateCell,
    StatTile, StatsGrid, SubGrid, SessionRow, DevRow, LiveLogEntry, LiveLog,
    Progress
} from './components/data-density.js';

export {
    fileGlyph, fmtFileSize,
    FileIcon, FileRow, FileGrid, FileSkeleton, sortFiles, FileToolbar, RootsPicker,
    DropZone, UploadProgress, EmptyState, BreadcrumbPath, BulkBar
} from './components/files.js';

export {
    ConfirmDialog, PromptDialog, CountdownDialog,
    FilePreviewMedia, FilePreviewCode, FilePreviewText, FileViewer, FilePreviewPane,
    Modal, modalError
} from './components/files-modals.js';

export {
    ServerIcon, ServerRail,
    ChannelItem, ChannelCategory,
    VoiceUser, UserPanel, ChannelSidebar,
    MemberItem, MemberList,
    ChatHeader, VoiceStrip, CommunityShell,
    MobileHeader, ReplyBar, Banner,
    ThreadPanel, ForumView, PageView
} from './components/community.js';

export {
    PttButton, VadMeter, WebcamPreview, VoiceSettingsModal, AudioQueue, VoiceControls,
    playCompletionCue
} from './components/voice.js';

export {
    LiveCursorOverlay, RemoteSelectionRings, RecentEditHighlightFlash,
    AgentPresenceChip, PresenceBar
} from './components/collab.js';

export { ThemeToggle } from './components/theme-toggle.js';

export {
    Checkbox, Radio, RadioGroup, Toggle, Field, useFormValidation, focusFirstInvalidField
} from './components/form-primitives.js';

export { Slider } from './components/slider.js';

export { Carousel } from './components/carousel.js';

export {
    useDraggable, useDropTarget, useNumberScrub, usePointerDrag, Reorderable,
    useKeyboardShortcut, formatShortcut, ShortcutHint, ShortcutList,
    useKeyboardShortcutHelp, ShortcutHelpDialog,
    isMobileNow, onMobileChange
} from './components/interaction-primitives.js';

export {
    Toolbar, ToolbarRow, Tabs,
    TreeView, TreeItem,
    PropertyGrid, PropertyField, PropertyGridRow, InlineEditableField,
    Dock, IconButtonGroup,
    ResizeHandle, SplitPanel,
    ContextMenu, useContextMenu,
    Drawer, Dialog, FocusTrap,
    Toast, toast,
    Pager, JsonViewer,
    Grid, GridItem,
    Collapse, CollapseGroup,
    Divider, AspectRatio,
    useMediaQuery,
    BP_SM, BP_MD, BP_LG, BP_XL,
    InfoRow, InfoSection, DiagnosticsPanel,
    BatchProgressLabel, formatBatchOutcome, runBatchSequential
} from './components/editor-primitives.js';

export {
    Tooltip, Popover, Dropdown, useLongPress, useFloating,
    CommandPalette, EmojiPicker, BootOverlay, SettingsPopover,
    AuthModal, VideoLightbox, PermissionMenu, ApprovalPrompt, withBusy,
    MenuButton,
    HoverCard, Menubar
} from './components/overlay-primitives.js';

export {
    FREDDIE_PAGES,
    home, chat, voice, sessions, projects, agents, analytics,
    models, cron, skills, config, env, tools, batch, gateway, chains,
    skillLabel, getRecentPaths, saveRecentPath, renderChatMessages
} from './components/freddie.js';

export {
    makePage, api, loadingState, errorState, emptyState, refreshError
} from './components/freddie/runtime.js';

export { mountCommunityApp } from './community-app.js';

export {
    Calendar, DatePicker, DateRangePicker,
    WEEKDAY_LABELS, buildMonthGrid, formatDate, monthLabel
} from './components/calendar.js';
