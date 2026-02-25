import type { SessionData, SessionFile } from "../../lib/types.js";
import { findPaneByTty } from "../../lib/tmux.js";
import { jsonlStore } from "../../transcript/store.js";

export async function sessionFileToData(
  session: SessionFile,
): Promise<SessionData> {
  // Check if session is running in tmux (interactive)
  let interactive = false;
  if (session.tty) {
    const pane = await findPaneByTty(session.tty);
    interactive = pane !== null;
  }

  return {
    id: session.sessionId,
    provider: session.provider,
    cwd: session.cwd,
    name: jsonlStore.getName(session.sessionId),
    model: null, // TODO: extract from JSONL
    gitBranch: null, // TODO: extract from JSONL or git
    startedAt: session.startedAt,
    interactive,
    capabilities:
      session.provider === "claude"
        ? {
            modelSwitch: {
              supported: true,
              kind: "command",
              commandName: "/model",
              options: [
                { id: "default", label: "Default", command: "/model default" },
                { id: "opus", label: "Opus", command: "/model Opus" },
                { id: "sonnet", label: "Sonnet", command: "/model Sonnet" },
                { id: "haiku", label: "Haiku", command: "/model Haiku" },
              ],
            },
            approvals: { supported: true },
          }
        : {
            modelSwitch: { supported: false },
            approvals: { supported: false },
          },
  };
}
