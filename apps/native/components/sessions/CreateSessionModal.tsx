import { useState, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Portal } from '@rn-primitives/portal';
import { XIcon } from 'lucide-react-native';
import { useUniwind } from 'uniwind';
import { useRow, useTable, useValue } from 'tinybase/ui-react';
import type { ProviderId as TypesProviderId } from '@arc0/types';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  NativeSelectScrollView,
} from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { ProviderIcon } from '@/components/sessions/ProviderIcon';
import { useUserActions } from '@/lib/contexts/UserActionsContext';
import { useActiveWorkstationId } from '@/lib/socket/provider';
import { useWorkstationProjects } from '@/lib/store/hooks';
import { THEME } from '@/lib/theme';
import { truncatePath } from '@/lib/utils/path';

// On web, use a plain View instead of KeyboardStickyView. The CSS transform
// from KeyboardStickyView creates a new stacking context that blocks touch
// events on the Radix Select dropdown. Browsers handle keyboard avoidance natively.
const NativeModalContainer = (props: React.ComponentProps<typeof View>) => (
  <KeyboardStickyView offset={{ opened: 0, closed: 0 }} {...props} />
);
const ModalContainer = Platform.OS === 'web' ? View : NativeModalContainer;

interface ProviderOption {
  value: TypesProviderId;
  label: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

interface CreateSessionModalProps {
  visible: boolean;
  onClose: () => void;
  /** Optional project ID to pre-select when opening the modal */
  defaultProjectId?: string;
  /** Called when the newly created session appears in TinyBase */
  onSessionCreated?: (sessionId: string) => void;
}

/**
 * Modal for creating a new session.
 * Uses the openSession action to create sessions via Socket.IO.
 */
export function CreateSessionModal({
  visible,
  onClose,
  defaultProjectId,
  onSessionCreated,
}: CreateSessionModalProps) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const insets = useSafeAreaInsets();
  const [provider, setProvider] = useState<TypesProviderId>('claude');
  const [sessionName, setSessionName] = useState('');
  const [selectedProject, setSelectedProject] = useState<
    { value: string; label: string } | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState(false);
  const knownSessionIdsRef = useRef<Set<string> | null>(null);
  const expectedSessionIdRef = useRef<string | null>(null);

  const activeWorkstationId = useActiveWorkstationId();
  const projects = useWorkstationProjects(activeWorkstationId);
  const { openSession, actionStates } = useUserActions();
  const isLoading = actionStates.openSession.isLoading;
  const isBusy = isLoading || pendingNav;

  // Watch sessions table for newly created session
  const sessionsTable = useTable('sessions') as Record<
    string,
    { workstation_id?: string; open?: number }
  >;

  const finishWithSession = (sessionId: string) => {
    knownSessionIdsRef.current = null;
    expectedSessionIdRef.current = null;
    setPendingNav(false);
    onClose();
    resetForm();
    onSessionCreated?.(sessionId);
  };

  useEffect(() => {
    if (!pendingNav) return;

    // Prefer the exact sessionId returned by the ack
    if (expectedSessionIdRef.current && sessionsTable[expectedSessionIdRef.current]) {
      finishWithSession(expectedSessionIdRef.current);
      return;
    }

    // Fallback: scan for any new session (covers servers that don't return sessionId)
    if (!knownSessionIdsRef.current) return;
    const newId = Object.keys(sessionsTable).find((id) => {
      if (knownSessionIdsRef.current!.has(id)) return false;
      const row = sessionsTable[id];
      return row.workstation_id === activeWorkstationId && row.open === 1;
    });

    if (newId) {
      finishWithSession(newId);
    }
  }, [sessionsTable, pendingNav, activeWorkstationId, onSessionCreated, onClose]);

  // Timeout fallback: if session never appears, close after 15s
  useEffect(() => {
    if (!pendingNav) return;
    const timer = setTimeout(() => {
      knownSessionIdsRef.current = null;
      expectedSessionIdRef.current = null;
      setPendingNav(false);
      onClose();
      resetForm();
    }, 15_000);
    return () => clearTimeout(timer);
  }, [pendingNav]);

  // Get active session's project to use as default
  const activeSessionId = useValue('active_session_id') as string | undefined;
  const activeSessionRow = useRow('sessions', activeSessionId ?? '') as
    | { project_id?: string }
    | undefined;
  const activeProjectId = activeSessionRow?.project_id;

  // Compute default project: prop > active session's project > first project
  const defaultProject = useMemo(() => {
    if (projects.length === 0) return undefined;

    // Priority 1: Use prop if provided
    if (defaultProjectId) {
      const propProject = projects.find((p) => p.id === defaultProjectId);
      if (propProject) {
        return { value: propProject.id, label: truncatePath(propProject.path, 40) };
      }
    }

    // Priority 2: Use active session's project
    if (activeProjectId) {
      const activeProject = projects.find((p) => p.id === activeProjectId);
      if (activeProject) {
        return { value: activeProject.id, label: truncatePath(activeProject.path, 40) };
      }
    }

    // Fallback to first project
    return { value: projects[0].id, label: truncatePath(projects[0].path, 40) };
  }, [projects, defaultProjectId, activeProjectId]);

  // Set default project when modal opens or default changes
  useEffect(() => {
    if (visible && defaultProject) {
      setSelectedProject(defaultProject);
    }
  }, [visible, defaultProject]);

  const resetForm = () => {
    setProvider('claude');
    setSessionName('');
    setSelectedProject(defaultProject);
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);

    // Look up the selected project to get its path (required)
    const selectedProjectData = selectedProject
      ? projects.find((p) => p.id === selectedProject.value)
      : undefined;

    if (!selectedProjectData?.path) {
      setError('Please select a project');
      return;
    }

    const payload = {
      provider,
      name: sessionName.trim() || undefined,
      cwd: selectedProjectData.path, // Required: working directory for the session
    };
    console.log('Submitting openSession:', JSON.stringify(payload, null, 2));

    try {
      // Snapshot current session IDs before the request
      knownSessionIdsRef.current = new Set(Object.keys(sessionsTable));
      const result = await openSession(payload.provider, payload.cwd, payload.name);

      if (result.status === 'success') {
        // Store the sessionId from the ack when available
        if (result.sessionId) {
          expectedSessionIdRef.current = result.sessionId;
        }
        // Don't close yet — wait for session to appear in TinyBase
        setPendingNav(true);
      } else {
        knownSessionIdsRef.current = null;
        setError(result.message);
      }
    } catch (err) {
      knownSessionIdsRef.current = null;
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  const handleClose = () => {
    if (isBusy) return; // Don't close while loading or waiting for session
    onClose();
    resetForm();
  };

  if (!visible) return null;

  return (
    <Portal name="create-session">
      {/* Backdrop */}
      <Pressable
        className="absolute inset-0 bg-black/50"
        onPress={handleClose}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel="Close modal"
      />

      <ModalContainer className="absolute right-0 bottom-0 left-0">
        <View
          className="bg-background border-border rounded-t-2xl border-t"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-4">
            <Text className="text-lg font-semibold">New Session</Text>
            <Pressable
              onPress={handleClose}
              disabled={isBusy}
              className="active:bg-accent rounded-lg p-2 disabled:opacity-50"
              accessibilityRole="button"
              accessibilityLabel="Close">
              <Icon as={XIcon} className="text-muted-foreground size-5" />
            </Pressable>
          </View>

          {/* Form */}
          <View className="gap-6 px-4">
            {/* Provider Selection */}
            <View className="gap-3">
              <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Provider
              </Text>
              <RadioGroup
                value={provider}
                onValueChange={(val) => val && setProvider(val as TypesProviderId)}>
                {PROVIDER_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => !isBusy && setProvider(option.value)}
                    disabled={isBusy}
                    className="flex-row items-center gap-3 py-2 disabled:opacity-50">
                    <RadioGroupItem value={option.value} disabled={isBusy} />
                    <ProviderIcon providerId={option.value} size={20} showBackground={false} />
                    <Text className="text-foreground">{option.label}</Text>
                  </Pressable>
                ))}
              </RadioGroup>
            </View>

            {/* Project Selection */}
            {projects.length > 0 && (
              <View className="gap-3">
                <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Project
                </Text>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger disabled={isBusy} className="w-full">
                    <SelectValue
                      placeholder="Select a project"
                      style={!selectedProject ? { color: colors.mutedForeground } : undefined}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <NativeSelectScrollView>
                      {projects.map((project) => (
                        <SelectItem
                          key={project.id}
                          value={project.id}
                          label={truncatePath(project.path, 40)}>
                          {truncatePath(project.path, 40)}
                        </SelectItem>
                      ))}
                    </NativeSelectScrollView>
                  </SelectContent>
                </Select>
              </View>
            )}

            {/* Session Name */}
            <View className="gap-3">
              <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Session Name (Optional)
              </Text>
              <TextInput
                placeholder="Enter a name for this session"
                placeholderTextColor={colors.mutedForeground}
                value={sessionName}
                onChangeText={setSessionName}
                editable={!isBusy}
                className="border-border bg-background text-foreground rounded-lg border px-4 py-3"
              />
            </View>

            {/* Error Message */}
            {error && (
              <View className="bg-destructive/10 rounded-lg px-4 py-3">
                <Text className="text-destructive text-sm">{error}</Text>
              </View>
            )}

            {/* Submit Button */}
            <Button onPress={handleSubmit} disabled={isBusy} className="mt-2">
              {isBusy ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-primary-foreground">Creating...</Text>
                </View>
              ) : (
                <Text>Create Session</Text>
              )}
            </Button>
          </View>
        </View>
      </ModalContainer>
    </Portal>
  );
}
