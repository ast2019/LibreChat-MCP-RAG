import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { useSetRecoilState } from 'recoil';
import { pendingManualSkillsByConvoId } from '@librechat/chat/react';
import { Permissions, PermissionTypes, defaultAgentCapabilities } from 'librechat-data-provider';
import { useAgentCapabilities, useHasAccess } from '~/hooks';
import { ephemeralAgentByConvoId } from '~/store';
import { useBadgeRowContext } from '~/Providers';

/**
 * Turns a skill on for this conversation's next message, as picking it in the palette does: the
 * skills toggle goes on and the skill joins the staged chips above the textarea. Null when the
 * user may not use skills or the deployment has them off, so callers just skip it.
 */
export default function useStageSkill(conversationId: string): ((name: string) => void) | null {
  const context = useBadgeRowContext();
  const { skillsEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );
  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));
  const setPendingSkills = useSetAtom(pendingManualSkillsByConvoId(conversationId));

  return useMemo(() => {
    if (!canUseSkills || !skillsEnabled) {
      return null;
    }
    return (name: string) => {
      setEphemeralAgent((agent) =>
        agent?.skills === true ? agent : { ...(agent ?? {}), skills: true },
      );
      setPendingSkills((staged) => (staged.includes(name) ? staged : [...staged, name]));
    };
  }, [canUseSkills, skillsEnabled, setEphemeralAgent, setPendingSkills]);
}
