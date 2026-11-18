export const HEARTBEAT_MS = 2000;

export const isPushDue = ({ json, sent, sentAt, now, heartbeatMs = HEARTBEAT_MS }) => json !== sent || now - sentAt >= heartbeatMs;
