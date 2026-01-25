/**
 * Action handlers for user actions from mobile app.
 * Routes actions to the appropriate tmux pane via TTY lookup.
 */

import type {
  ActionResult,
  SendPromptPayload,
  ApproveToolUsePayload,
  StopAgentPayload,
  OpenSessionPayload,
} from "@arc0/types";
import type { SessionFile } from "../shared/types.js";
import { findPaneByTty, sendToPane, sendKeyToPane } from "../shared/tmux.js";
import { launchSession } from "./session-launcher.js";

// =============================================================================
// Action Handler
// =============================================================================

export interface ActionHandlerDeps {
  getSession: (sessionId: string) => SessionFile | undefined;
}

/**
 * Creates action handlers with access to session data.
 */
export function createActionHandlers(deps: ActionHandlerDeps) {
  /**
   * Find the tmux pane for a session.
   */
  async function findPaneForSession(sessionId: string): Promise<{ target: string } | { error: ActionResult }> {
    const session = deps.getSession(sessionId);

    if (!session) {
      return {
        error: {
          status: "error",
          code: "SESSION_NOT_FOUND",
          message: `Session ${sessionId} not found`,
        },
      };
    }

    if (!session.tty) {
      return {
        error: {
          status: "error",
          code: "NO_TTY",
          message: `Session ${sessionId} has no TTY`,
        },
      };
    }

    const target = await findPaneByTty(session.tty);

    if (!target) {
      return {
        error: {
          status: "error",
          code: "PANE_NOT_FOUND",
          message: `Could not find tmux pane for TTY ${session.tty}`,
        },
      };
    }

    return { target };
  }

  return {
    /**
     * Send a prompt to a session.
     */
    async sendPrompt(payload: SendPromptPayload): Promise<ActionResult> {
      console.log(`[actions] sendPrompt: session=${payload.sessionId} text="${payload.text.slice(0, 50)}..."`);

      const result = await findPaneForSession(payload.sessionId);
      if ("error" in result) return result.error;

      const success = await sendToPane(result.target, payload.text, true);

      if (!success) {
        return {
          status: "error",
          code: "SEND_FAILED",
          message: "Failed to send prompt to tmux pane",
        };
      }

      return { status: "success" };
    },

    /**
     * Unified tool response handler (permission, plan approval, answers).
     * Handles all tool_use responses via the discriminated union.
     */
    async approveToolUse(payload: ApproveToolUsePayload): Promise<ActionResult> {
      console.log(`[actions] approveToolUse: session=${payload.sessionId} tool=${payload.toolName} type=${payload.response.type}`);

      const result = await findPaneForSession(payload.sessionId);
      if ("error" in result) return result.error;

      switch (payload.response.type) {
        case "tool": {
          // Regular tool permission: send option number (1, 2, or 3)
          const success = await sendToPane(result.target, String(payload.response.option), false);
          if (!success) {
            return {
              status: "error",
              code: "SEND_FAILED",
              message: "Failed to send tool approval to tmux pane",
            };
          }
          break;
        }

        case "plan": {
          // ExitPlanMode: send option number (1-4)
          const success = await sendToPane(result.target, String(payload.response.option), false);
          if (!success) {
            return {
              status: "error",
              code: "SEND_FAILED",
              message: "Failed to send plan approval to tmux pane",
            };
          }
          // If option is 4 (feedback), send the feedback text after
          if (payload.response.option === 4 && payload.response.text) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            await sendToPane(result.target, payload.response.text, true);
          }
          break;
        }

        case "answers": {
          // AskUserQuestion: send each answer
          for (const answer of payload.response.answers) {
            const text = answer.text ?? String(answer.option);
            const success = await sendToPane(result.target, text, true);
            if (!success) {
              return {
                status: "error",
                code: "SEND_FAILED",
                message: `Failed to send answer ${answer.questionIndex} to tmux pane`,
              };
            }
          }
          break;
        }
      }

      return { status: "success" };
    },

    /**
     * Stop the agent (send Escape to interrupt).
     */
    async stopAgent(payload: StopAgentPayload): Promise<ActionResult> {
      console.log(`[actions] stopAgent: session=${payload.sessionId}`);

      const result = await findPaneForSession(payload.sessionId);
      if ("error" in result) return result.error;

      const success = await sendKeyToPane(result.target, "Escape");

      if (!success) {
        return {
          status: "error",
          code: "SEND_FAILED",
          message: "Failed to send stop signal to tmux pane",
        };
      }

      return { status: "success" };
    },

    /**
     * Open a new session in tmux.
     */
    async openSession(payload: OpenSessionPayload): Promise<ActionResult> {
      console.log(`[actions] openSession: provider=${payload.provider} name=${payload.name ?? "unnamed"}`);
      return launchSession(payload);
    },
  };
}

export type ActionHandlers = ReturnType<typeof createActionHandlers>;
