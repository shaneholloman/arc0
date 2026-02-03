/**
 * WorkstationEditModal: Add or edit a workstation configuration.
 *
 * For new workstations:
 * - User enters URL + pairing code (from `arc0 pair`)
 * - "Pair Workstation" performs SPAKE2 pairing
 * - On success, authToken + encryptionKey are derived and stored
 *
 * For existing workstations:
 * - Edit name, URL, enabled toggle only
 * - No re-pairing (pairing is one-time)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from 'lucide-react-native';
import { useUniwind } from 'uniwind';
import { useTable, useValue } from 'tinybase/ui-react';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useSocketContext } from '@/lib/socket/provider';
import { pairWithWorkstation, type PairingResult } from '@/lib/socket/pairing';
import type { WorkstationConfig } from '@/lib/store/hooks';
import { THEME } from '@/lib/theme';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Validates if a string is a valid URL with http/https protocol
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks if a valid URL uses HTTP (not HTTPS)
 */
function isHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Format pairing code with dash (XXXX-XXXX)
 */
function formatPairingCode(code: string): string {
  // Remove existing dashes and non-alphanumeric chars
  const clean = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length <= 4) {
    return clean;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

/**
 * Check if pairing code is valid (8 alphanumeric chars, with optional dash)
 */
function isValidPairingCode(code: string): boolean {
  const clean = code.replace(/[^a-zA-Z0-9]/g, '');
  return clean.length === 8;
}

// =============================================================================
// Types
// =============================================================================

interface WorkstationEditModalProps {
  visible: boolean;
  /** Workstation to edit, or null to add a new one */
  workstation: WorkstationConfig | null;
  onClose: () => void;
  /** Pre-filled URL for deep link pairing */
  initialUrl?: string;
  /** Pre-filled pairing code for deep link pairing */
  initialCode?: string;
  /** Called after successfully adding a new workstation (passes workstation ID for activation) */
  onWorkstationAdded?: (workstationId: string) => void;
}

// =============================================================================
// Pairing Hook
// =============================================================================

function usePairing(deviceId: string | undefined) {
  const [isPairing, setIsPairing] = useState(false);
  const [pairingResult, setPairingResult] = useState<PairingResult | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const pair = useCallback(
    async (url: string, code: string): Promise<PairingResult | null> => {
      setIsPairing(true);
      setPairingError(null);
      abortRef.current = false;

      try {
        // Pass the device ID from the store to ensure consistency
        const result = await pairWithWorkstation(url, code, deviceId);
        if (abortRef.current) return null;
        setPairingResult(result);
        return result;
      } catch (err) {
        if (abortRef.current) return null;
        const message = err instanceof Error ? err.message : 'Pairing failed';
        setPairingError(message);
        return null;
      } finally {
        if (!abortRef.current) {
          setIsPairing(false);
        }
      }
    },
    [deviceId]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setIsPairing(false);
    setPairingResult(null);
    setPairingError(null);
  }, []);

  return { pair, isPairing, pairingResult, pairingError, reset };
}

// =============================================================================
// Main Component
// =============================================================================

interface WorkstationRow {
  name?: string;
  url?: string;
  enabled?: number;
  active?: number;
}

export function WorkstationEditModal({
  visible,
  workstation,
  onClose,
  initialUrl,
  initialCode,
  onWorkstationAdded,
}: WorkstationEditModalProps) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const { height: screenHeight } = useWindowDimensions();
  const { addWorkstation, updateWorkstation, removeWorkstation, allConnectionStates } =
    useSocketContext();

  // Get existing workstations to check for duplicates
  const workstationsTable = useTable('workstations') as Record<string, WorkstationRow>;

  // Get device ID from store for pairing
  const storeDeviceId = useValue('device') as string | undefined;

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Loading states
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pairing - pass device ID from store
  const {
    pair,
    isPairing,
    pairingResult,
    pairingError,
    reset: resetPairing,
  } = usePairing(storeDeviceId);

  const isEditing = workstation !== null;
  const connectionState = workstation ? allConnectionStates.get(workstation.id) : undefined;

  // Check for issues with the pairing result
  const pairingIssue = (() => {
    if (!pairingResult?.workstationId) {
      return null;
    }

    const wsId = pairingResult.workstationId;
    const trimmedUrl = url.trim().toLowerCase();

    // Check if workstation with this ID already exists
    if (workstationsTable[wsId]) {
      const existingName = workstationsTable[wsId].name ?? wsId;
      return `A workstation "${existingName}" already exists with this Base. Please edit the existing workstation instead.`;
    }

    // Check if workstation with this URL already exists
    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.url?.toLowerCase() === trimmedUrl) {
        const existingName = row.name ?? id;
        return `A workstation "${existingName}" already uses this URL. Please edit the existing workstation instead.`;
      }
    }

    return null;
  })();

  // Determine if save is allowed
  const canSave = (() => {
    if (!isEditing) {
      // New workstation - need successful pairing without issues
      return pairingResult !== null && !pairingIssue;
    }
    // Editing - can always save (name, URL, enabled changes)
    return url.trim() !== '';
  })();

  // Load existing workstation data when editing, or pre-fill from deep link params
  useEffect(() => {
    if (visible) {
      resetPairing();
      setError(null);

      if (workstation) {
        setName(workstation.name);
        setUrl(workstation.url);
        setEnabled(workstation.enabled);
        setPairingCode('');
      } else {
        // Reset form for new workstation, or pre-fill from deep link params
        setName('');
        setUrl(initialUrl ?? '');
        setPairingCode(initialCode ? formatPairingCode(initialCode) : '');
        setEnabled(true);
      }
    }
  }, [visible, workstation, resetPairing, initialUrl, initialCode]);

  // Reset pairing when URL or code changes
  useEffect(() => {
    if (!isEditing) {
      resetPairing();
    }
  }, [url, pairingCode, isEditing, resetPairing]);

  const handlePairingCodeChange = useCallback((text: string) => {
    // Format as user types
    const formatted = formatPairingCode(text);
    setPairingCode(formatted);
  }, []);

  const handlePair = useCallback(async () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    if (!isValidUrl(url.trim())) {
      setError('Please enter a valid URL (e.g., https://io43e7u.t.arc0.ai)');
      return;
    }
    if (!isValidPairingCode(pairingCode)) {
      setError('Please enter a valid pairing code (8 characters, e.g., ABCD-1234)');
      return;
    }
    setError(null);
    await pair(url.trim(), pairingCode);
  }, [url, pairingCode, pair]);

  const handleSave = useCallback(async () => {
    // Validate
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    if (!isValidUrl(url.trim())) {
      setError('Please enter a valid URL (e.g., https://io43e7u.t.arc0.ai)');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (isEditing && workstation) {
        // Update existing workstation (name, URL, enabled only)
        await updateWorkstation(workstation.id, {
          name: name.trim() || workstation.name,
          url: url.trim(),
          enabled,
        });
      } else {
        // New workstation - must have pairing result
        if (!pairingResult) {
          setError('Please pair with the workstation first');
          setIsSaving(false);
          return;
        }

        // Check for duplicates
        if (workstationsTable[pairingResult.workstationId]) {
          const existingName =
            workstationsTable[pairingResult.workstationId].name ?? pairingResult.workstationId;
          setError(`A workstation "${existingName}" already exists with this Base.`);
          setIsSaving(false);
          return;
        }

        // Capture pairing data before resetting (to prevent brief error flash)
        const { workstationId, workstationName, authToken, encryptionKey } = pairingResult;
        resetPairing();

        // Add new workstation with credentials from pairing
        const workstationNameFinal =
          name.trim() || workstationName || `Workstation ${workstationId.slice(0, 8)}`;
        await addWorkstation(
          workstationId,
          workstationNameFinal,
          url.trim(),
          authToken,
          encryptionKey
        );

        // Notify parent that workstation was added (for sync success modal)
        onClose();
        onWorkstationAdded?.(workstationId);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workstation');
    } finally {
      setIsSaving(false);
    }
  }, [
    isEditing,
    workstation,
    name,
    url,
    enabled,
    pairingResult,
    addWorkstation,
    updateWorkstation,
    workstationsTable,
    onClose,
    onWorkstationAdded,
    resetPairing,
  ]);

  const handleDelete = useCallback(() => {
    if (!workstation) return;

    const performDelete = async () => {
      setIsDeleting(true);
      try {
        await removeWorkstation(workstation.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete workstation');
      } finally {
        setIsDeleting(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete workstation "${workstation.name}"? This cannot be undone.`)) {
        performDelete();
      }
    } else {
      Alert.alert('Delete Workstation', `Delete "${workstation.name}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDelete },
      ]);
    }
  }, [workstation, removeWorkstation, onClose]);

  const handleClose = () => {
    if (isSaving || isDeleting || isPairing) return;
    resetPairing();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1">
        <Pressable
          onPress={handleClose}
          className="flex-1 items-center justify-center bg-black/50 p-4">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ maxHeight: screenHeight * 0.9 }}
            className="bg-card border-border w-full max-w-md rounded-xl border p-4">
            {/* Header */}
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-foreground text-lg font-semibold">
                {isEditing ? 'Edit Workstation' : 'Add Workstation'}
              </Text>
              <Pressable
                onPress={handleClose}
                disabled={isSaving || isDeleting || isPairing}
                hitSlop={8}
                className="active:opacity-70">
                <Icon as={XIcon} className="text-muted-foreground size-5" />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 4 }}>
              {/* Connection Status (when editing) */}
              {isEditing && connectionState && (
                <View className="bg-muted mb-4 flex-row items-center gap-2 rounded-lg px-3 py-2">
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor:
                        connectionState.status === 'connected'
                          ? '#22c55e'
                          : connectionState.status === 'connecting'
                            ? '#f59e0b'
                            : '#ef4444',
                    }}
                  />
                  <Text className="text-muted-foreground text-sm capitalize">
                    {connectionState.status}
                  </Text>
                </View>
              )}

              {/* Pairing Result (new workstation only) */}
              {!isEditing && pairingResult && (
                <View
                  className={`mb-4 flex-row items-center gap-2 rounded-lg px-3 py-2 ${
                    !pairingIssue ? 'bg-green-500/10' : 'bg-red-500/10'
                  }`}>
                  <Icon
                    as={!pairingIssue ? CheckCircleIcon : XCircleIcon}
                    className={!pairingIssue ? 'text-green-500' : 'text-red-500'}
                    size={18}
                  />
                  <View className="flex-1">
                    <Text
                      className={`text-sm ${!pairingIssue ? 'text-green-600' : 'text-red-600'}`}>
                      {pairingIssue
                        ? 'Workstation already exists'
                        : `Connected to "${pairingResult.workstationName}"`}
                    </Text>
                    {!pairingIssue && (
                      <Text className="text-muted-foreground text-xs">
                        ID: {pairingResult.workstationId}
                      </Text>
                    )}
                    {pairingIssue && (
                      <Text className="text-muted-foreground text-xs">{pairingIssue}</Text>
                    )}
                  </View>
                </View>
              )}

              {/* Pairing Error (new workstation only) */}
              {!isEditing && pairingError && !pairingResult && (
                <View className="mb-4 flex-row items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                  <Icon as={XCircleIcon} className="text-red-500" size={18} />
                  <View className="flex-1">
                    <Text className="text-sm text-red-600">{pairingError}</Text>
                  </View>
                </View>
              )}

              {/* Form Fields */}
              <View className="gap-4">
                {/* URL */}
                <View>
                  <Text className="text-muted-foreground mb-1 text-sm">URL</Text>
                  <TextInput
                    testID="workstation-url-input"
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://io43e7u.t.arc0.ai"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    editable={!isSaving && !isDeleting && !isPairing}
                    className="bg-background border-border text-foreground rounded-lg border px-4 py-3"
                    style={{ fontSize: 16 }}
                  />
                  {isHttpUrl(url.trim()) && (
                    <View className="mt-2 flex-row items-center gap-2">
                      <Icon as={AlertTriangleIcon} className="text-yellow-600" size={14} />
                      <Text className="text-xs text-yellow-600">
                        Consider using HTTPS for better security
                      </Text>
                    </View>
                  )}
                </View>

                {/* Pairing Code (new workstations only) */}
                {!isEditing && !pairingResult && (
                  <View>
                    <Text className="text-muted-foreground mb-1 text-sm">Pairing Code</Text>
                    <TextInput
                      testID="workstation-pairing-code-input"
                      value={pairingCode}
                      onChangeText={handlePairingCodeChange}
                      placeholder="ABCD-1234"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={9} // 8 chars + dash
                      editable={!isSaving && !isPairing}
                      className="bg-background border-border text-foreground rounded-lg border px-4 py-3 font-mono"
                      style={{ fontSize: 16, letterSpacing: 2 }}
                    />
                    <Text className="text-muted-foreground mt-1 text-xs">
                      Run `arc0 pair` on your workstation to get this code
                    </Text>
                  </View>
                )}

                {/* Name (optional - shows after pairing for new, always for edit) */}
                {(isEditing || pairingResult) && (
                  <View>
                    <Text className="text-muted-foreground mb-1 text-sm">Name (optional)</Text>
                    <TextInput
                      testID="workstation-name-input"
                      value={name}
                      onChangeText={setName}
                      placeholder={
                        pairingResult?.workstationName ||
                        (pairingResult?.workstationId
                          ? `Workstation ${pairingResult.workstationId.slice(0, 8)}`
                          : 'My MacBook')
                      }
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="words"
                      autoCorrect={false}
                      editable={!isSaving && !isDeleting}
                      className="bg-background border-border text-foreground rounded-lg border px-4 py-3"
                      style={{ fontSize: 16 }}
                    />
                  </View>
                )}

                {/* Enabled Toggle (only when editing) */}
                {isEditing && (
                  <View className="flex-row items-center justify-between py-2">
                    <Text className="text-foreground">Enabled</Text>
                    <Switch
                      value={enabled}
                      onValueChange={setEnabled}
                      disabled={isSaving || isDeleting}
                      trackColor={{ false: colors.muted, true: colors.primary }}
                    />
                  </View>
                )}

                {/* Error Message */}
                {error && (
                  <View className="bg-destructive/10 rounded-lg px-4 py-3">
                    <Text className="text-destructive text-sm">{error}</Text>
                  </View>
                )}

                {/* Actions */}
                <View className="mt-2 gap-3">
                  {/* Pair Button (new workstations only, before pairing) */}
                  {!isEditing && !pairingResult && (
                    <Pressable
                      testID="workstation-pair-button"
                      onPress={handlePair}
                      disabled={isPairing || !url.trim() || !isValidPairingCode(pairingCode)}
                      className="bg-primary items-center rounded-lg py-3 active:opacity-70 disabled:opacity-50">
                      {isPairing ? (
                        <View className="flex-row items-center gap-2">
                          <ActivityIndicator size="small" color="white" />
                          <Text className="text-primary-foreground font-medium">Pairing...</Text>
                        </View>
                      ) : (
                        <Text className="text-primary-foreground font-medium">
                          Pair Workstation
                        </Text>
                      )}
                    </Pressable>
                  )}

                  {/* Save Button (after pairing for new, or always for edit) */}
                  {(isEditing || pairingResult) && (
                    <Pressable
                      testID="workstation-save-button"
                      onPress={handleSave}
                      disabled={isSaving || isDeleting || !canSave}
                      className="bg-primary items-center rounded-lg py-3 active:opacity-70 disabled:opacity-50">
                      {isSaving ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text className="text-primary-foreground font-medium">
                          {isEditing ? 'Save Changes' : 'Add Workstation'}
                        </Text>
                      )}
                    </Pressable>
                  )}

                  {/* Delete Button (only when editing) */}
                  {isEditing && (
                    <Pressable
                      testID="workstation-delete-button"
                      onPress={handleDelete}
                      disabled={isSaving || isDeleting}
                      className="flex-row items-center justify-center gap-2 rounded-lg py-3 active:opacity-70 disabled:opacity-50">
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={colors.destructive} />
                      ) : (
                        <>
                          <Icon as={Trash2Icon} className="text-destructive size-5" />
                          <Text className="text-destructive font-medium">Delete Workstation</Text>
                        </>
                      )}
                    </Pressable>
                  )}

                  {/* Cancel Button */}
                  <Pressable
                    testID="workstation-cancel-button"
                    onPress={handleClose}
                    disabled={isSaving || isDeleting || isPairing}
                    className="items-center rounded-lg py-3 active:opacity-70 disabled:opacity-50">
                    <Text className="text-muted-foreground font-medium">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
