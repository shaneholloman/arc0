import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Question {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

// Special constant for "Other" selection
export const OTHER_OPTION = '__OTHER__';

interface PendingQuestionContextValue {
  // The pending question data
  questions: Question[] | null;
  toolUseId: string | null;

  // Selection state: Map<questionIndex, selectedLabel(s)>
  // Use OTHER_OPTION constant when "Other" is selected
  selections: Map<number, string | string[]>;

  // Custom text per question (for "Other" responses)
  customTexts: Map<number, string>;

  // Loading state - disables interactions while submitting
  isSubmitting: boolean;

  // Actions
  setPendingQuestion: (questions: Question[] | null, toolUseId: string | null) => void;
  selectOption: (questionIndex: number, label: string) => void;
  toggleOption: (questionIndex: number, label: string) => void;
  setCustomText: (questionIndex: number, text: string) => void;
  clearSelections: () => void;
  setIsSubmitting: (value: boolean) => void;

  // Computed
  getFormattedAnswer: () => string;
  getSelectionSummary: () => string;
  hasSelections: boolean;
}

const PendingQuestionContext = createContext<PendingQuestionContextValue | null>(null);

export function usePendingQuestion() {
  const context = useContext(PendingQuestionContext);
  if (!context) {
    throw new Error('usePendingQuestion must be used within PendingQuestionProvider');
  }
  return context;
}

// Safe version that returns null if not in provider (for optional usage)
export function usePendingQuestionSafe() {
  return useContext(PendingQuestionContext);
}

interface PendingQuestionProviderProps {
  children: ReactNode;
}

export function PendingQuestionProvider({ children }: PendingQuestionProviderProps) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [toolUseId, setToolUseId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Map<number, string | string[]>>(new Map());
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(new Map());
  const [isSubmitting, setIsSubmittingState] = useState(false);

  const setIsSubmitting = useCallback((value: boolean) => {
    setIsSubmittingState(value);
  }, []);

  const setPendingQuestion = useCallback(
    (newQuestions: Question[] | null, newToolUseId: string | null) => {
      setQuestions(newQuestions);
      setToolUseId(newToolUseId);
      // Clear selections and custom texts when question changes
      setSelections(new Map());
      setCustomTexts(new Map());
    },
    []
  );

  // For single-select: replaces the selection for a question
  const selectOption = useCallback((questionIndex: number, label: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(questionIndex, label);
      return next;
    });
  }, []);

  // For multi-select: toggles an option in the selection
  const toggleOption = useCallback((questionIndex: number, label: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(questionIndex);

      if (Array.isArray(current)) {
        // Already an array, toggle the label
        if (current.includes(label)) {
          const filtered = current.filter((l) => l !== label);
          if (filtered.length === 0) {
            next.delete(questionIndex);
          } else {
            next.set(questionIndex, filtered);
          }
        } else {
          next.set(questionIndex, [...current, label]);
        }
      } else if (current === label) {
        // Same label selected, unselect
        next.delete(questionIndex);
      } else if (current) {
        // Different label selected, convert to array
        next.set(questionIndex, [current, label]);
      } else {
        // Nothing selected, add as array with single item
        next.set(questionIndex, [label]);
      }

      return next;
    });
  }, []);

  // Set custom text for a specific question (for "Other" responses)
  const setCustomText = useCallback((questionIndex: number, text: string) => {
    setCustomTexts((prev) => {
      const next = new Map(prev);
      if (text) {
        next.set(questionIndex, text);
      } else {
        next.delete(questionIndex);
      }
      return next;
    });
  }, []);

  const clearSelections = useCallback(() => {
    setSelections(new Map());
    setCustomTexts(new Map());
  }, []);

  // Format selections into answer string
  const getFormattedAnswer = useCallback(() => {
    if (!questions || selections.size === 0) return '';

    const answers: string[] = [];

    questions.forEach((q, index) => {
      const selection = selections.get(index);
      if (selection) {
        const answerValue = Array.isArray(selection) ? selection.join(', ') : selection;
        answers.push(`"${q.question}"="${answerValue}"`);
      }
    });

    if (answers.length === 0) return '';

    return `User has answered your questions: ${answers.join(', ')}`;
  }, [questions, selections]);

  // Has selections: either predefined options selected OR custom text entered for "Other"
  const hasSelections = useMemo(() => {
    // Check for predefined option selections (excluding OTHER_OPTION without text)
    for (const [questionIndex, selection] of selections) {
      if (selection === OTHER_OPTION) {
        // "Other" is selected - only counts if there's custom text
        if (customTexts.get(questionIndex)) {
          return true;
        }
      } else {
        // Regular option selected
        return true;
      }
    }
    return false;
  }, [selections, customTexts]);

  // Get a display string for the placeholder
  const getSelectionSummary = useCallback(() => {
    if (selections.size === 0) return '';

    const allSelections: string[] = [];
    selections.forEach((selection, questionIndex) => {
      if (Array.isArray(selection)) {
        allSelections.push(...selection);
      } else if (selection === OTHER_OPTION) {
        // For "Other", show the custom text
        const customText = customTexts.get(questionIndex);
        if (customText) {
          allSelections.push(`Other: "${customText}"`);
        }
      } else {
        allSelections.push(selection);
      }
    });

    return allSelections.join(', ');
  }, [selections, customTexts]);

  const value = useMemo(
    () => ({
      questions,
      toolUseId,
      selections,
      customTexts,
      isSubmitting,
      setPendingQuestion,
      selectOption,
      toggleOption,
      setCustomText,
      clearSelections,
      setIsSubmitting,
      getFormattedAnswer,
      hasSelections,
      getSelectionSummary,
    }),
    [
      questions,
      toolUseId,
      selections,
      customTexts,
      isSubmitting,
      setPendingQuestion,
      selectOption,
      toggleOption,
      setCustomText,
      clearSelections,
      setIsSubmitting,
      getFormattedAnswer,
      hasSelections,
      getSelectionSummary,
    ]
  );

  return (
    <PendingQuestionContext.Provider value={value}>{children}</PendingQuestionContext.Provider>
  );
}
