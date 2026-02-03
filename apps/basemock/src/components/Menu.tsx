/**
 * Menu - Category-based keyboard navigation menu.
 */

import React from "react";
import { Box, Text } from "ink";
import type { CategoryKey, MenuCategory } from "../types.js";

interface MenuProps {
  categories: MenuCategory[];
  activeCategory: CategoryKey | null;
  disabled?: boolean;
}

export function Menu({
  categories,
  activeCategory,
  disabled = false,
}: MenuProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Arc0 BaseMock
        </Text>
      </Box>

      {categories.map((category) => {
        const isActive = activeCategory === category.key;

        return (
          <Box key={category.key} flexDirection="column" marginBottom={1}>
            {/* Category header */}
            <Box>
              <Text
                color={isActive ? "cyan" : undefined}
                bold={isActive}
                dimColor={disabled || (!isActive && activeCategory !== null)}
              >
                [{category.key}] {category.label}
              </Text>
            </Box>

            {/* Category items - show numbers when category is active */}
            {category.items.map((item) => (
              <Box key={item.action} paddingLeft={2}>
                <Text
                  dimColor={disabled || (!isActive && activeCategory !== null)}
                  color={isActive ? "white" : undefined}
                >
                  [{item.key}] {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Menu configuration - all available actions organized by category.
 */
export const MENU_CATEGORIES: MenuCategory[] = [
  {
    key: "c",
    label: "Connection",
    items: [
      { key: "1", label: "Start server", action: "start-server" },
      {
        key: "2",
        label: "Stop server",
        action: "stop-server",
        requiresServer: true,
      },
    ],
  },
  {
    key: "s",
    label: "Sessions",
    items: [
      {
        key: "1",
        label: "Create session",
        action: "create-session",
        requiresServer: true,
      },
      {
        key: "2",
        label: "Close session",
        action: "close-session",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "3",
        label: "Select session",
        action: "select-session",
        requiresServer: true,
      },
      {
        key: "4",
        label: "Send sessions",
        action: "sessions-sync",
        requiresServer: true,
      },
    ],
  },
  {
    key: "m",
    label: "Messages",
    items: [
      {
        key: "1",
        label: "User text",
        action: "user-text",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "2",
        label: "Assistant text",
        action: "assistant-text",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "3",
        label: "Assistant + thinking",
        action: "assistant-thinking",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "4",
        label: "Thinking only",
        action: "thinking-only",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "5",
        label: "Sample conversation",
        action: "sample-conversation",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "6",
        label: "Read (auto)",
        action: "tool-read",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "7",
        label: "Grep (auto)",
        action: "tool-grep",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "8",
        label: "Write (approval)",
        action: "tool-write",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "9",
        label: "Bash (approval)",
        action: "tool-bash",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "0",
        label: "tool_result",
        action: "tool-result",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "a",
        label: "AskUser (simple)",
        action: "ask-user",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "b",
        label: "ExitPlanMode",
        action: "exit-plan",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "i",
        label: "AskUser (multi-select)",
        action: "ask-user-multi-select",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "j",
        label: "AskUser (multi-question)",
        action: "ask-user-multi-question",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "k",
        label: "AskUser (next steps)",
        action: "ask-user-next-steps",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "c",
        label: "TodoWrite",
        action: "todo-write",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "d",
        label: "Rename session",
        action: "rename-session",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "e",
        label: "Tool Permission",
        action: "tool-permission",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "f",
        label: "Tool auto-approved",
        action: "tool-auto-approved",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "g",
        label: "Tool approved (delayed)",
        action: "tool-approve-delayed",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "h",
        label: "Tool rejected (delayed)",
        action: "tool-reject-delayed",
        requiresServer: true,
        requiresSession: true,
      },
      {
        key: "x",
        label: "Walk all types",
        action: "walk-all-types",
        requiresServer: true,
      },
    ],
  },
];
