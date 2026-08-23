export interface Phase {
  key: string;
  label: string;
  match: string[];
}

export const PHASES: Phase[] = [
  { key: "open", label: "Open", match: ["opening process", "found mono module", "opened target"] },
  { key: "resolve", label: "Resolve", match: ["resolving exports", "resolved mono exports"] },
  { key: "write", label: "Write", match: ["allocating", "writing assembly", "wrote assembly"] },
  { key: "invoke", label: "Invoke", match: ["creating remote thread", "runtime_invoke", "entry point executed"] },
  { key: "done", label: "Done", match: ["injection succeeded", "✓"] },
];

export const PIPE_PHASES: Phase[] = [
  { key: "detect", label: "Detect", match: ["bepinex is live", "detecting loader"] },
  { key: "ping", label: "Ping", match: ["pinging receiver", "receiver online", "hello from receiver"] },
  { key: "send", label: "Send", match: ["sending load", "load request sent"] },
  { key: "ack", label: "Confirm", match: ["receiver acknowledged", "load confirmed"] },
  { key: "done", label: "Done", match: ["injection succeeded", "✓"] },
];

export function reachedPhase(lines: string[], phases: Phase[] = PHASES): number {
  let reached = -1;
  const hay = lines.map((l) => l.toLowerCase());
  phases.forEach((p, i) => {
    if (hay.some((line) => p.match.some((m) => line.includes(m)))) {
      reached = Math.max(reached, i);
    }
  });
  return reached;
}

export function activePhases(lines: string[]): Phase[] {
  const hay = lines.join("\n").toLowerCase();
  if (hay.includes("pipe") || hay.includes("receiver") || hay.includes("bepinex is live")) {
    return PIPE_PHASES;
  }
  return PHASES;
}
