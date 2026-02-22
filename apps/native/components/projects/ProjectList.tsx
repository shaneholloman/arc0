import { useState, useMemo, useEffect } from 'react';
import { View, ScrollView } from 'react-native';

import { Text } from '@/components/ui/text';
import { CreateSessionModal } from '@/components/sessions/CreateSessionModal';
import { useOpenSessions, useProjects } from '@/lib/store/hooks';
import type { Session } from '@/lib/types/session';
import { ProjectItem } from './ProjectItem';

interface ProjectListProps {
  selectedSessionId?: string;
  onSessionPress?: () => void;
  onSessionCreated?: (sessionId: string) => void;
}

interface GroupedProject {
  id: string;
  path: string;
  sessions: Session[];
  latestActivity: string;
}

/**
 * Groups open sessions by project and renders collapsible project items.
 */
export function ProjectList({
  selectedSessionId,
  onSessionPress,
  onSessionCreated,
}: ProjectListProps) {
  const openSessions = useOpenSessions();
  const projects = useProjects();

  // Modal state
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [createSessionProjectId, setCreateSessionProjectId] = useState<string | undefined>();

  // Track expanded projects (first one defaults to expanded)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [hasSetInitialExpand, setHasSetInitialExpand] = useState(false);

  // Group sessions by project
  const groupedProjects = useMemo(() => {
    // Create a map of projectPath -> sessions
    const projectSessionMap = new Map<string, Session[]>();

    for (const session of openSessions) {
      const projectPath = session.projectName;
      const existing = projectSessionMap.get(projectPath) || [];
      existing.push(session);
      projectSessionMap.set(projectPath, existing);
    }

    // Sort sessions within each project by most recent activity
    for (const sessions of projectSessionMap.values()) {
      sessions.sort((a, b) => {
        const timeA = a.lastMessageAt || a.startedAt;
        const timeB = b.lastMessageAt || b.startedAt;
        return timeB.localeCompare(timeA);
      });
    }

    // Convert to grouped projects array
    const grouped: GroupedProject[] = [];

    for (const [path, sessions] of projectSessionMap) {
      // Find the project ID from the projects list
      const project = projects.find((p) => p.path === path);
      const projectId = project?.id || path; // fallback to path as ID

      // Get latest activity time from sessions
      const latestActivity = sessions.reduce((latest, s) => {
        const time = s.lastMessageAt || s.startedAt;
        return time > latest ? time : latest;
      }, '');

      grouped.push({
        id: projectId,
        path,
        sessions,
        latestActivity,
      });
    }

    // Sort by most recent activity
    grouped.sort((a, b) => b.latestActivity.localeCompare(a.latestActivity));

    return grouped;
  }, [openSessions, projects]);

  // Set first project as expanded on initial render
  useEffect(() => {
    if (!hasSetInitialExpand && groupedProjects.length > 0) {
      setExpandedProjects(new Set([groupedProjects[0].id]));
      setHasSetInitialExpand(true);
    }
  }, [groupedProjects, hasSetInitialExpand]);

  const handleToggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleCreateSession = (projectId: string) => {
    setCreateSessionProjectId(projectId);
    setShowCreateSession(true);
  };

  const handleCloseModal = () => {
    setShowCreateSession(false);
    setCreateSessionProjectId(undefined);
  };

  if (groupedProjects.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-4">
        <Text className="text-muted-foreground text-center">No open sessions</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {groupedProjects.map((project) => (
          <ProjectItem
            key={project.id}
            projectId={project.id}
            projectPath={project.path}
            sessions={project.sessions}
            isExpanded={expandedProjects.has(project.id)}
            onToggle={() => handleToggleProject(project.id)}
            onCreateSession={() => handleCreateSession(project.id)}
            selectedSessionId={selectedSessionId}
            onSessionPress={onSessionPress}
          />
        ))}
      </ScrollView>

      <CreateSessionModal
        visible={showCreateSession}
        onClose={handleCloseModal}
        defaultProjectId={createSessionProjectId}
        onSessionCreated={onSessionCreated}
      />
    </>
  );
}
