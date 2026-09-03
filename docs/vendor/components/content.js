// Content blocks: Panel, Row, RowLink, Section, Hero, Install, Receipt,
// Changelog, WorksList, WritingList, Manifesto, Kpi, Table, HomeView,
// ProjectView, Form. Pure factories.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./content/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { avatarInitial, avatarContrastFg, Avatar } from './content/avatar.js';
import { Row, RowLink } from './content/row.js';
import { Panel, Card, PanelFromItems, Section, Receipt, Changelog } from './content/panel.js';
import { Hero, HeroFromPageData, Marquee, Manifesto, PageHeader } from './content/hero.js';
import { Install, CliBlock } from './content/cli.js';
import { WorksList, WritingList, EventList } from './content/lists.js';
import { Kpi, Sparkline, BarChart } from './content/charts.js';
import { Table, HealthTable, ProcessRegistryTable } from './content/table.js';
import { SearchInput, TextField, Select, Form } from './content/fields.js';
import { InputOTP } from './content/otp-input.js';
import { Spinner, Skeleton, Alert, FilterPills } from './content/feedback.js';
import { HomeView, ProjectView } from './content/views.js';

export {
    avatarInitial, avatarContrastFg, Avatar,
    Row, RowLink,
    Panel, Card, PanelFromItems, Section, Receipt, Changelog,
    Hero, HeroFromPageData, Marquee, Manifesto, PageHeader,
    Install, CliBlock,
    WorksList, WritingList, EventList,
    Kpi, Sparkline, BarChart,
    Table, HealthTable, ProcessRegistryTable,
    SearchInput, TextField, Select, Form, InputOTP,
    Spinner, Skeleton, Alert, FilterPills,
    HomeView, ProjectView,
};
