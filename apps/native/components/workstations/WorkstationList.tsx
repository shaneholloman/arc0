/**
 * WorkstationList: Displays list of configured workstations for Settings screen.
 * Shows connection status, allows setting active workstation, and editing.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CheckIcon, PlusIcon, SettingsIcon } from 'lucide-react-native';
import { useUniwind } from 'uniwind';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useWorkstations, useOpenSessions, type WorkstationConfig } from '@/lib/store/hooks';
import { useSocketContext } from '@/lib/socket/provider';
import type { ConnectionState } from '@/lib/socket/types';
import { THEME } from '@/lib/theme';
import { WorkstationEditModal } from './WorkstationEditModal';
import { SyncSuccessModal } from './SyncSuccessModal';

// =============================================================================
// Types
// =============================================================================

interface WorkstationListProps {
  /** Called when a workstation is edited or added */
  onWorkstationChange?: () => void;
  /** Whether to open the add workstation modal (controlled by URL param) */
  openModal?: boolean;
  /** Pre-filled URL for pairing */
  initialUrl?: string;
  /** Pre-filled pairing code for pairing */
  initialCode?: string;
  /** Called when URL params are consumed */
  onParamsConsumed?: () => void;
  /** Called when user clicks "View Sessions" after successful pairing */
  onViewSessions?: () => void;
  /** Called when user clicks "Create Session" after successful pairing */
  onCreateSession?: () => void;
}

// =============================================================================
// Connection Status Indicator
// =============================================================================

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const color =
    state.status === 'connected'
      ? '#22c55e' // green
      : state.status === 'connecting'
        ? '#f59e0b' // amber
        : '#ef4444'; // red

  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color,
      }}
    />
  );
}

// =============================================================================
// Workstation Row
// =============================================================================

interface WorkstationRowProps {
  workstation: WorkstationConfig;
  connectionState: ConnectionState;
  onSetActive: () => void;
  onEdit: () => void;
  isLast: boolean;
}

function WorkstationRow({
  workstation,
  connectionState,
  onSetActive,
  onEdit,
  isLast,
}: WorkstationRowProps) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];

  // Truncate URL for display
  const displayUrl = workstation.url.replace(/^https?:\/\//, '').slice(0, 30);

  return (
    <View
      testID={`workstation-row-${workstation.id}`}
      className="flex-row items-center px-4 py-3"
      style={!isLast ? { borderBottomWidth: 1, borderBottomColor: colors.border } : undefined}>
      {/* Active indicator / Set active button */}
      <Pressable
        onPress={onSetActive}
        disabled={workstation.active}
        className="mr-3 h-6 w-6 items-center justify-center"
        hitSlop={8}>
        {workstation.active ? (
          <Icon as={CheckIcon} className="text-primary size-5" />
        ) : (
          <View className="border-muted-foreground h-5 w-5 rounded-full border-2" />
        )}
      </Pressable>

      {/* Workstation info */}
      <View className="mr-3 flex-1">
        <Text className="text-foreground font-medium" numberOfLines={1}>
          {workstation.name}
        </Text>
        <Text className="text-muted-foreground text-sm" numberOfLines={1}>
          {displayUrl}
        </Text>
      </View>

      {/* Connection status */}
      <View className="mr-3">
        <ConnectionIndicator state={connectionState} />
      </View>

      {/* Edit button */}
      <Pressable onPress={onEdit} className="active:bg-accent rounded-lg p-2" hitSlop={8}>
        <Icon as={SettingsIcon} className="text-muted-foreground size-5" />
      </Pressable>
    </View>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function WorkstationList({
  onWorkstationChange,
  openModal,
  initialUrl,
  initialCode,
  onParamsConsumed,
  onViewSessions,
  onCreateSession,
}: WorkstationListProps) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const workstations = useWorkstations();
  const openSessions = useOpenSessions();
  const { allConnectionStates, setActiveWorkstation } = useSocketContext();

  // Modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<WorkstationConfig | null>(null);
  const [modalUrl, setModalUrl] = useState<string | undefined>(undefined);
  const [modalCode, setModalCode] = useState<string | undefined>(undefined);

  // Sync success modal state (shown after adding a new workstation)
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Track if params have been consumed
  const paramsConsumedRef = useRef(false);

  // Reset consumed ref when openModal becomes false (allows re-triggering on subsequent navigations)
  useEffect(() => {
    if (!openModal) {
      paramsConsumedRef.current = false;
    }
  }, [openModal]);

  // Auto-open modal when openModal prop is true
  useEffect(() => {
    if (openModal && !paramsConsumedRef.current) {
      paramsConsumedRef.current = true;
      setModalUrl(initialUrl);
      setModalCode(initialCode);
      setEditingWorkstation(null);
      setEditModalVisible(true);
      onParamsConsumed?.();
    }
  }, [openModal, initialUrl, initialCode, onParamsConsumed]);

  const handleSetActive = (workstationId: string) => {
    setActiveWorkstation(workstationId);
  };

  const handleEdit = (workstation: WorkstationConfig) => {
    setEditingWorkstation(workstation);
    setEditModalVisible(true);
  };

  const handleAdd = () => {
    setEditingWorkstation(null);
    setModalUrl(undefined);
    setModalCode(undefined);
    setEditModalVisible(true);
  };

  const handleModalClose = () => {
    setEditModalVisible(false);
    setEditingWorkstation(null);
    setModalUrl(undefined);
    setModalCode(undefined);
    onWorkstationChange?.();
  };

  // Called when a new workstation is successfully added
  const handleWorkstationAdded = (workstationId: string) => {
    // Set the newly added workstation as active so useOpenSessions shows its sessions
    setActiveWorkstation(workstationId);
    setShowSyncModal(true);
  };

  // Sync modal action handlers
  const handleSyncViewSessions = () => {
    setShowSyncModal(false);
    onViewSessions?.();
  };

  const handleSyncCreateSession = () => {
    setShowSyncModal(false);
    onCreateSession?.();
  };

  const handleSyncClose = () => {
    setShowSyncModal(false);
  };

  return (
    <View>
      <Text className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
        Workstations
      </Text>

      <View testID="workstation-list" className="bg-card border-border overflow-hidden rounded-lg border">
        {workstations.length === 0 ? (
          <View testID="workstation-empty" className="items-center px-4 py-6">
            <Text className="text-muted-foreground text-center">No workstations configured</Text>
            <Text className="text-muted-foreground mt-1 text-center text-sm">
              Add a workstation running Arc0 base service to connect your app
            </Text>
          </View>
        ) : (
          workstations.map((ws, index) => (
            <WorkstationRow
              key={ws.id}
              workstation={ws}
              connectionState={allConnectionStates.get(ws.id) ?? { status: 'disconnected' }}
              onSetActive={() => handleSetActive(ws.id)}
              onEdit={() => handleEdit(ws)}
              isLast={index === workstations.length - 1}
            />
          ))
        )}

        {/* Add Workstation button */}
        <Pressable
          testID="add-workstation-button"
          onPress={handleAdd}
          className="active:bg-accent flex-row items-center gap-3 px-4 py-3"
          style={
            workstations.length > 0
              ? { borderTopWidth: 1, borderTopColor: colors.border }
              : undefined
          }>
          <Icon as={PlusIcon} className="text-primary size-5" />
          <Text className="text-primary font-medium">Add Workstation</Text>
        </Pressable>
      </View>

      {/* Edit Modal */}
      <WorkstationEditModal
        visible={editModalVisible}
        workstation={editingWorkstation}
        onClose={handleModalClose}
        initialUrl={modalUrl}
        initialCode={modalCode}
        onWorkstationAdded={handleWorkstationAdded}
      />

      {/* Sync Success Modal (shown after adding a new workstation) */}
      <SyncSuccessModal
        visible={showSyncModal}
        hasSessions={openSessions.length > 0}
        onViewSessions={handleSyncViewSessions}
        onCreateSession={handleSyncCreateSession}
        onClose={handleSyncClose}
      />
    </View>
  );
}
