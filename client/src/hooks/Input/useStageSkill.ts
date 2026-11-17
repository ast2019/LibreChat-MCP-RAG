import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { useSetRecoilState } from 'recoil';
import { pendingManualSkillsByConvoId } from '@librechat/chat/react';
import { Permissions, PermissionTypes, defaultAgentCapabilities } from 'librechat-data-provider';
import { flagsForSkillName, reconcileFeatureFlags } from './featureToolFlags';
import { useAgentCapabilities, useHasAccess } from '~/hooks';
import { ephemeralAgentByConvoId } from '~/store';
import { useBadgeRowContext } from '~/Providers';

export interface StagedSkills {
  /** Skills staged for the next message, by name */
  staged: readonly string[];
  /** Turns a skill on for the next message, as picking it in the palette does */
  stage: (name: string) => void;
  /** Takes a staged skill off again */
  unstage: (name: string) => void;
}

/**
 * The skills staged for this conversation's next message, and turning one on or off: on, the
 * skills toggle goes on and the skill joins the staged chips above the textarea. Null when the
 * user may not use skills or the deployment has them off, so callers just skip it.
 */
export default function useStageSkill(conversationId: string): StagedSkills | null {
  const context = useBadgeRowContext();
  const { skillsEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );
  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));
  const [staged, setPendingSkills] = useAtom(pendingManualSkillsByConvoId(conversationId));

  return useMemo(() => {
    if (!canUseSkills || !skillsEnabled) {
      return null;
    }
    return {
      staged,
      stage: (name: string) => {
        setEphemeralAgent((agent) => reconcileFeatureFlags(agent, staged, flagsForSkillName(name)));
        setPendingSkills((current) => (current.includes(name) ? current : [...current, name]));
      },
      unstage: (name: string) => {
        const remaining = staged.filter((skill) => skill !== name);
        setEphemeralAgent((agent) => reconcileFeatureFlags(agent, remaining));
        setPendingSkills(() => remaining);
      },
    };
  }, [canUseSkills, skillsEnabled, staged, setEphemeralAgent, setPendingSkills]);
}
