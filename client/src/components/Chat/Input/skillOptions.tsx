import { useCallback, useEffect, useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { ScrollText } from 'lucide-react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { pendingManualSkillsByConvoId } from '@librechat/chat/react';
import {
  Permissions,
  SkillsScope,
  PermissionTypes,
  isAssistantsEndpoint,
  resolveAgentSkillsScope,
} from 'librechat-data-provider';
import type { TSkillSummary } from 'librechat-data-provider';
import type { MentionOption } from '~/common';
import useAgentCapabilities from '~/hooks/Agents/useAgentCapabilities';
import useGetAgentsConfig from '~/hooks/Agents/useGetAgentsConfig';
import { useSkillsInfiniteQuery } from '~/data-provider';
import store, { ephemeralAgentByConvoId } from '~/store';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useAgentsMapContext } from '~/Providers';
import { useSkillActiveState } from '~/hooks';
import { isEphemeralAgent } from '~/common';

const skillIcon = <ScrollText className="icon-md text-status-info" />;

/**
 * Determines whether a skill should appear in the `$` and `/` command popovers.
 * Reads the persisted `userInvocable` field (mirrors the `user-invocable`
 * frontmatter). Defaults to visible when the field is absent so older
 * skills authored before Phase 6 stay user-invocable without a migration;
 * only an explicit `false` hides them.
 */
export function isUserInvocable(skill: TSkillSummary): boolean {
  return skill.userInvocable !== false;
}

/**
 * Filters the skills list down to what should appear in the command popovers.
 * Composes three rules, short-circuiting on the cheapest check first:
 *
 * 1. Agent scope — mirrors backend `scopeSkillIds` semantics:
 *    - `null` / `undefined` → no scope filter (ephemeral convo, or agent
 *      without a `skills` field configured).
 *    - `[]` → explicit opt-out, nothing passes.
 *    - non-empty → intersection with the agent's configured skill ids.
 * 2. Active state — per-user ownership-aware toggle.
 * 3. Invocation mode — `manual` / `both` / undefined are visible; `auto`
 *    is model-only and hidden.
 *
 * Pure function; exported so tests can exercise the filter in isolation
 * without rendering the component.
 */
export function filterSkillsForPopover(
  skills: TSkillSummary[],
  ctx: {
    agentSkillIds: string[] | null | undefined;
    isActive: (skill: Pick<TSkillSummary, '_id' | 'author' | 'source'>) => boolean;
  },
): TSkillSummary[] {
  const { agentSkillIds, isActive } = ctx;
  if (agentSkillIds != null && agentSkillIds.length === 0) {
    return [];
  }
  const agentSet =
    agentSkillIds != null && agentSkillIds.length > 0 ? new Set(agentSkillIds) : null;
  const result: TSkillSummary[] = [];
  for (const skill of skills) {
    if (agentSet && !agentSet.has(skill._id)) {
      continue;
    }
    if (!isActive(skill)) {
      continue;
    }
    if (!isUserInvocable(skill)) {
      continue;
    }
    result.push(skill);
  }
  return result;
}

/** Whether this composer can invoke skills: the role may use them, the agents endpoint offers
 *  them, and the chat is not on an Assistants endpoint (which has no skills). */
export function useSkillsCommandAvailable(index: number): boolean {
  const hasSkillsAccess = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const { agentsConfig } = useGetAgentsConfig();
  const { skillsEnabled } = useAgentCapabilities(agentsConfig?.capabilities);
  const endpoint = useRecoilValue(store.effectiveEndpointByIndex(index));
  return hasSkillsAccess && skillsEnabled && !isAssistantsEndpoint(endpoint);
}

/**
 * The skills the user can pick for this conversation, and what picking one does. Shared by the
 * `$` picker and the `/` menu so both offer the same list and stage the same structured
 * invocation. `enabled: false` keeps the catalog unfetched while no popover is open.
 */
export function useSkillOptions({
  conversationId,
  agentId,
  enabled = true,
}: {
  conversationId: string;
  agentId?: string | null;
  enabled?: boolean;
}) {
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));
  const setPendingManualSkills = useSetAtom(pendingManualSkillsByConvoId(conversationId));
  const agentsMap = useAgentsMapContext();
  const { isActive } = useSkillActiveState();

  /* Resolve the per-agent skill scope. Mirrors backend
     `resolveAgentScopedSkillIds`: ephemeral agents always see the full
     catalog (picking any skill flips `ephemeralAgent.skills = true` and
     activates for the turn); persisted agents gate on the builder's
     `skills_enabled` master toggle and explicit catalog scope. Legacy agents
     without a scope retain empty allowlist = full catalog. Persisted agents fail closed during the
     `agentsMap` hydration window so the user cannot pick a skill the
     backend will then refuse, and again when the map is authoritative
     but the agent isn't in it (deleted, or VIEW revoked mid-session). */
  const agentSkillIds = useMemo<string[] | null | undefined>(() => {
    if (!agentId || isEphemeralAgent(agentId)) {
      return undefined;
    }
    if (!agentsMap) {
      return [];
    }
    const agent = agentsMap[agentId];
    if (!agent) {
      return [];
    }
    if (agent.skills_enabled !== true) {
      return [];
    }
    const scope = resolveAgentSkillsScope(agent.skills, agent.skills_enabled, agent.skills_scope);
    if (scope === SkillsScope.none) {
      return [];
    }
    if (scope === SkillsScope.all) {
      return undefined;
    }
    return agent.skills ?? [];
  }, [agentId, agentsMap]);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSkillsInfiniteQuery({ limit: 50 }, { enabled });

  /* Auto-fetch all pages so client-side search covers the full catalog,
     not just the first page. The skills API is server-side capped. */
  useEffect(() => {
    if (!enabled || isError) {
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [enabled, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const options: MentionOption[] = useMemo(() => {
    if (!data?.pages) {
      return [];
    }
    const allSkills: TSkillSummary[] = [];
    for (const page of data.pages) {
      for (const skill of page.skills) {
        allSkills.push(skill);
      }
    }
    const filtered = filterSkillsForPopover(allSkills, { agentSkillIds, isActive });
    const result: MentionOption[] = [];
    for (const skill of filtered) {
      result.push({
        label: skill.displayTitle ?? skill.name,
        value: skill.name,
        description: skill.description,
        type: 'skill',
        icon: skillIcon,
      });
    }
    return result;
  }, [data?.pages, agentSkillIds, isActive]);

  /* Structured channel for manual skill invocations. The submit pipeline reads
     this and primes SKILL.md as a meta user message before the LLM turn — no
     textarea-level marker is needed, and injecting `$skill-name ` as text would
     mislead users into thinking free-form text invocation is supported. Visual
     confirmation after submit comes from `SkillPills` on the user message bubble
     until the live skill-card stream takes over. */
  const select = useCallback(
    (name: string) => {
      setEphemeralAgent((prev) => {
        if (prev?.skills) {
          return prev;
        }
        return { ...(prev || {}), skills: true };
      });
      setPendingManualSkills((prev) => (prev.includes(name) ? prev : [...prev, name]));
    },
    [setEphemeralAgent, setPendingManualSkills],
  );

  return { options, isLoading, isError, isFetchingNextPage, select };
}
