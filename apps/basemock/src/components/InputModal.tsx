/**
 * InputModal - Text input overlay for user prompts.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputModalProps {
  title: string;
  placeholder: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InputModal({
  title,
  placeholder,
  initialValue = "",
  onSubmit,
  onCancel,
}: InputModalProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>

      <Box>
        <Text dimColor>{placeholder}: </Text>
        <Text>{value}</Text>
        <Text color="cyan">█</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Enter to submit, ESC to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * SelectModal - Selection overlay for choosing from options.
 */
interface SelectModalProps {
  title: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function SelectModal({
  title,
  options,
  onSelect,
  onCancel,
}: SelectModalProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const selected = options[selectedIndex];
      if (selected) {
        onSelect(selected.value);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(options.length - 1, i + 1));
      return;
    }

    // Number key selection (1-9)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= options.length) {
      const selected = options[num - 1];
      if (selected) {
        onSelect(selected.value);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>

      {options.map((option, index) => (
        <Box key={option.value}>
          <Text
            color={index === selectedIndex ? "cyan" : undefined}
            bold={index === selectedIndex}
          >
            {index === selectedIndex ? "> " : "  "}[{index + 1}] {option.label}
          </Text>
          {option.hint && <Text dimColor> ({option.hint})</Text>}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>
          Use ↑↓ or 1-{options.length}, Enter to select, ESC to cancel
        </Text>
      </Box>
    </Box>
  );
}

/**
 * ConfirmModal - Yes/No confirmation overlay.
 */
interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: (confirmed: boolean) => void;
}

export function ConfirmModal({
  title,
  message,
  onConfirm,
}: ConfirmModalProps): React.ReactElement {
  const [selected, setSelected] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      onConfirm(false);
      return;
    }

    if (key.return) {
      onConfirm(selected);
      return;
    }

    if (key.leftArrow || key.rightArrow || input === "y" || input === "n") {
      if (input === "y") {
        setSelected(true);
        onConfirm(true);
      } else if (input === "n") {
        setSelected(false);
        onConfirm(false);
      } else {
        setSelected((s) => !s);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">
          {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      <Box>
        <Text color={!selected ? "cyan" : undefined} bold={!selected}>
          {!selected ? "> " : "  "}[n] No
        </Text>
        <Text> </Text>
        <Text color={selected ? "cyan" : undefined} bold={selected}>
          {selected ? "> " : "  "}[y] Yes
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press y/n or ←→, Enter to confirm, ESC to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * WalkModal - Step-by-step message type walker.
 */
interface WalkModalProps {
  title: string;
  message: string;
  step: number;
  total: number;
  onNext: () => void;
  onCancel: () => void;
}

export function WalkModal({
  title,
  message,
  step,
  total,
  onNext,
  onCancel,
}: WalkModalProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onNext();
      return;
    }
  });

  const progress = Math.round(((step + 1) / total) * 20);
  const progressBar = "█".repeat(progress) + "░".repeat(20 - progress);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="magenta"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Box marginBottom={1}>
        <Text bold color="magenta">
          {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Progress: </Text>
        <Text color="magenta">{progressBar}</Text>
        <Text dimColor>
          {" "}
          {step + 1}/{total}
        </Text>
      </Box>

      <Box>
        <Text dimColor>Press Enter to send, ESC to cancel walk</Text>
      </Box>
    </Box>
  );
}
