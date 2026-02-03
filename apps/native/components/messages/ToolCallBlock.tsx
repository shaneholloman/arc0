import { Icon } from '@/components/ui/icon';
import { Shimmer } from '@/components/ui/shimmer';
import { Text } from '@/components/ui/text';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { StructuredPatch, ToolUseResultMetadata } from '@/lib/types/session';
import { cn } from '@/lib/utils';
import { structuredPatch } from 'diff';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  FileIcon,
  GlobeIcon,
  HelpCircleIcon,
  ListTodoIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { AskUserQuestionDisplay } from './AskUserQuestionDisplay';
import { DiffView } from './DiffView';
import { PlanApprovalDisplay } from './PlanApprovalDisplay';
import { TodoListDisplay } from './TodoListDisplay';
import { ToolApprovalDisplay } from './ToolApprovalDisplay';

interface ToolCallBlockProps {
  name: string;
  input: Record<string, unknown>;
  result?: string | unknown[] | Record<string, unknown>;
  isError?: boolean;
  metadata?: ToolUseResultMetadata;
  interactive?: boolean; // Enable interactive mode for AskUserQuestion
  isLastMessage?: boolean;
}

/**
 * Normalize tool result content to a displayable string.
 * Claude API can send content as:
 * - string: "Tool result text"
 * - array: [{type: "text", text: "Tool result text"}]
 * - object: {type: "text", text: "Tool result text"}
 */
function normalizeResultContent(
  result: string | unknown[] | Record<string, unknown> | undefined
): string | undefined {
  if (result === undefined) return undefined;
  if (typeof result === 'string') return result;

  // Handle array of content blocks
  if (Array.isArray(result)) {
    return result
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: unknown }).text);
        }
        if (block && typeof block === 'object' && 'type' in block) {
          // For non-text blocks, stringify them
          return JSON.stringify(block);
        }
        return String(block);
      })
      .join('\n');
  }

  // Handle single object with text property
  if (result && typeof result === 'object' && 'text' in result) {
    return String((result as { text: unknown }).text);
  }

  // Fallback: stringify the object
  return JSON.stringify(result, null, 2);
}

/**
 * Compute structured patches from Edit tool input when metadata doesn't have them.
 * Uses the diff package to compute a proper unified diff with context lines.
 */
function computeEditPatches(input: Record<string, unknown>): StructuredPatch[] | null {
  const oldStr = input.old_string as string | undefined;
  const newStr = input.new_string as string | undefined;

  if (!oldStr && !newStr) return null;
  if (oldStr === newStr) return null;

  // Use diff library to compute proper unified diff
  const patch = structuredPatch('', '', oldStr ?? '', newStr ?? '', '', '', { context: 3 });

  if (!patch.hunks || patch.hunks.length === 0) return null;

  // Convert diff library's hunks to our StructuredPatch format
  return patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: TerminalIcon,
  Read: FileIcon,
  Write: PencilIcon,
  Edit: PencilIcon,
  Glob: SearchIcon,
  Grep: SearchIcon,
  TodoWrite: ListTodoIcon,
  AskUserQuestion: HelpCircleIcon,
  ExitPlanMode: ClipboardCheckIcon,
  Task: PlayIcon,
  WebFetch: GlobeIcon,
  WebSearch: GlobeIcon,
};

function getToolIcon(toolName: string): LucideIcon {
  return TOOL_ICONS[toolName] || WrenchIcon;
}

// Tools that have their own custom display components and don't use ToolApprovalDisplay
const CUSTOM_DISPLAY_TOOLS = new Set([
  'TodoWrite',
  'AskUserQuestion',
  'ExitPlanMode',
  'EnterPlanMode',
]);

// Tools that should auto-expand when in the last message.
// All other tools (including MCP tools) will auto-collapse.
const AUTO_EXPAND_TOOLS = new Set([
  'AskUserQuestion',
  'ExitPlanMode',
  'TodoWrite',
  'Edit',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
]);

function shouldAutoExpand(toolName: string): boolean {
  // MCP tools (contain '/') always collapse
  if (toolName.includes('/')) return false;
  return AUTO_EXPAND_TOOLS.has(toolName);
}

/**
 * Extract first meaningful string value from tool input for display in header.
 * Used as fallback for unknown tools (including MCP tools).
 */
function extractFirstStringValue(input: Record<string, unknown>): string | null {
  // Priority fields commonly used for descriptions across various tools
  // Order matters - more descriptive fields first
  const priorityKeys = [
    'description',
    'query', // WebSearch, context7 tools
    'url', // WebFetch, navigate tools
    'action', // MCP chrome tools (screenshot, wait, click)
    'text', // javascript_tool, find tools
    'subject', // TaskCreate
    'skill', // Skill tool
    'libraryName', // context7 resolve-library-id
    'libraryId', // context7 query-docs
    'name',
    'path',
    'file',
    'command',
    'pattern',
  ];

  for (const key of priorityKeys) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0 && val.length < 200) {
      return val;
    }
  }

  // Fallback: first string value that's reasonably short
  for (const val of Object.values(input)) {
    if (typeof val === 'string' && val.length > 0 && val.length < 200) {
      return val;
    }
  }

  return null;
}

function getToolDescription(name: string, input: Record<string, unknown>): string | null {
  let value: string | null = null;

  switch (name) {
    case 'Bash':
      value = (input.description as string) || (input.command as string) || null;
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
      value = input.file_path as string | null;
      break;
    case 'Glob':
    case 'Grep':
      value = input.pattern as string | null;
      break;
    case 'Task':
      value = input.description as string | null;
      break;
    case 'WebFetch':
      value = input.url as string | null;
      break;
    case 'WebSearch':
      value = input.query as string | null;
      break;
    case 'Skill':
      value = input.skill as string | null;
      break;
    case 'NotebookEdit':
      value = input.notebook_path as string | null;
      break;
    case 'TaskCreate':
      value = input.subject as string | null;
      break;
    case 'TaskUpdate':
      // Show status change if available, otherwise taskId
      if (input.status && input.taskId) {
        value = `${input.taskId} → ${input.status}`;
      } else {
        value = (input.taskId as string) || (input.status as string) || null;
      }
      break;
    case 'TaskOutput':
      value = input.task_id as string | null;
      break;
    case 'KillShell':
      value = input.shell_id as string | null;
      break;
    case 'AskUserQuestion': {
      // Extract first question's header or question text
      const questions = input.questions as { header?: string; question?: string }[] | undefined;
      if (questions && questions.length > 0) {
        value = questions[0].header || questions[0].question || null;
      }
      break;
    }
    case 'TodoWrite': {
      // Show count of todos
      const todos = input.todos as unknown[] | undefined;
      if (todos && todos.length > 0) {
        value = `${todos.length} task${todos.length > 1 ? 's' : ''}`;
      }
      break;
    }
    default:
      // Fallback: find first short string value in input
      value = extractFirstStringValue(input);
  }

  return value || null;
}

export function ToolCallBlock({
  name,
  input,
  result,
  isError,
  metadata,
  interactive,
  isLastMessage,
}: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(() => {
    // Interactive tools (awaiting approval) should always start expanded
    if (interactive) return true;
    if (!isLastMessage) return false;
    return shouldAutoExpand(name);
  });
  // Track if user has manually toggled the collapsible - don't override their choice
  const [userInteracted, setUserInteracted] = useState(false);
  // Track previous interactive value to detect state transitions
  const prevInteractive = useRef(interactive);

  // React to interactive state transitions (not initial mount):
  // - When interactive becomes true (tool needs approval) → expand
  // - When interactive becomes false (tool was approved) → collapse unless in whitelist
  // - Don't override if user has manually interacted
  useEffect(() => {
    if (userInteracted) return;

    if (interactive && !prevInteractive.current) {
      // Newly became interactive (needs approval)
      setIsOpen(true);
    } else if (
      !interactive &&
      prevInteractive.current &&
      isLastMessage &&
      !shouldAutoExpand(name)
    ) {
      // Was just approved (interactive went from true to false) → collapse
      setIsOpen(false);
    }
    prevInteractive.current = interactive;
  }, [interactive, isLastMessage, name, userInteracted]);

  // Handle user toggle - track that they've interacted
  const handleOpenChange = (open: boolean) => {
    setUserInteracted(true);
    setIsOpen(open);
  };

  // Normalize result to string for display
  const normalizedResult = normalizeResultContent(result);
  const hasResult = normalizedResult !== undefined;
  const ToolIcon = getToolIcon(name);
  const description = getToolDescription(name, input);
  // Compute patches from Edit tool input when metadata doesn't have structuredPatch
  const computedPatches = useMemo(() => {
    const hasDiff = metadata?.structuredPatch && metadata.structuredPatch.length > 0;
    if (hasDiff) return null; // metadata already has patches
    if (name !== 'Edit') return null;
    return computeEditPatches(input);
  }, [name, input, metadata]);

  const effectivePatches = metadata?.structuredPatch ?? computedPatches;
  const showDiff = effectivePatches && effectivePatches.length > 0;

  const iconColor = hasResult
    ? isError
      ? 'text-destructive'
      : 'text-green-500'
    : 'text-muted-foreground';

  const isPending = !hasResult;

  return (
    <View className="border-border bg-background overflow-hidden rounded-sm border">
      <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger className="flex-row items-center gap-2 px-2.5 py-1.5">
          <Shimmer isShimmering={isPending}>
            <Icon as={ToolIcon} className={cn('size-4', iconColor)} />
          </Shimmer>
          <View className="flex-1 flex-row items-center gap-2">
            <Shimmer isShimmering={isPending}>
              <Text className="text-foreground text-sm font-medium">{name}</Text>
            </Shimmer>
            {description && (
              <Text className="text-muted-foreground flex-1 font-mono text-sm" numberOfLines={1}>
                {description}
              </Text>
            )}
            {isPending && (
              <Shimmer isShimmering>
                <Text className="text-muted-foreground text-xs">Running...</Text>
              </Shimmer>
            )}
          </View>
          <Icon
            as={isOpen ? ChevronDownIcon : ChevronRightIcon}
            className="text-muted-foreground size-4"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <View className="border-border bg-muted/30 gap-2 border-t px-2.5 py-1.5">
            {/* Input - custom renderers for specific tools */}
            <View>
              <Text className="text-muted-foreground mb-1 text-xs font-medium">Input</Text>
              {name === 'TodoWrite' && input.todos ? (
                <TodoListDisplay
                  todos={
                    input.todos as {
                      content: string;
                      status: 'pending' | 'in_progress' | 'completed';
                      activeForm?: string;
                    }[]
                  }
                />
              ) : name === 'AskUserQuestion' && input.questions ? (
                <AskUserQuestionDisplay
                  questions={
                    input.questions as {
                      question: string;
                      header: string;
                      options: { label: string; description: string }[];
                      multiSelect: boolean;
                    }[]
                  }
                  answer={normalizedResult}
                  interactive={interactive}
                />
              ) : name === 'ExitPlanMode' ? (
                <PlanApprovalDisplay
                  planFilePath={input.planFilePath as string | undefined}
                  planContent={input.plan as string | undefined}
                  answer={normalizedResult}
                  interactive={interactive}
                />
              ) : !CUSTOM_DISPLAY_TOOLS.has(name) ? (
                <ToolApprovalDisplay
                  toolName={name}
                  input={input}
                  answer={normalizedResult}
                  isError={isError}
                  interactive={interactive}
                />
              ) : (
                <Text className="text-muted-foreground font-mono text-xs leading-relaxed">
                  {JSON.stringify(input, null, 2)}
                </Text>
              )}
            </View>

            {/* Diff View for Edit operations */}
            {showDiff && effectivePatches && (
              <View className="border-border border-t pt-2">
                <Text className="text-muted-foreground mb-1 text-xs font-medium">Changes</Text>
                <DiffView patches={effectivePatches} />
              </View>
            )}

            {/* Result */}
            {hasResult && !showDiff && (
              <View className="border-border border-t pt-2">
                <Text
                  className={cn(
                    'mb-1 text-xs font-medium',
                    isError ? 'text-destructive' : 'text-green-500'
                  )}>
                  {isError ? 'Error' : 'Result'}
                </Text>
                <Text
                  className={cn(
                    'font-mono text-xs leading-relaxed',
                    isError ? 'text-destructive' : 'text-muted-foreground'
                  )}>
                  {normalizedResult}
                </Text>
              </View>
            )}
          </View>
        </CollapsibleContent>
      </Collapsible>
    </View>
  );
}
