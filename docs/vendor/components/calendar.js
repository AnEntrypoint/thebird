// Calendar / DatePicker / DateRangePicker — date-grid primitive plus its two
// trigger+popover shells. Barrel over ./calendar/*.js submodules (each stays
// single-responsibility and under the 200-line cap); the public export
// surface here matches the group-barrel shape used by editor-primitives.js /
// overlay-primitives.js (import-then-bare-export, never `export … from`).

import { Calendar } from './calendar/calendar.js';
import { DatePicker, DateRangePicker } from './calendar/date-picker.js';
import { WEEKDAY_LABELS, buildMonthGrid, formatDate, monthLabel } from './calendar/grid.js';

export {
    Calendar,
    DatePicker, DateRangePicker,
    WEEKDAY_LABELS, buildMonthGrid, formatDate, monthLabel,
};
