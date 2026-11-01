import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { renderHook, act } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { pendingManualSkillsByConvoId } from '@librechat/chat/react';
import { ephemeralAgentByConvoId } from '~/store';
import useStageSkill from '../useStageSkill';

let mockCanUseSkills = true;
let mockSkillsEnabled = true;

jest.mock('~/hooks', () => ({
  useHasAccess: () => mockCanUseSkills,
  useAgentCapabilities: () => ({ skillsEnabled: mockSkillsEnabled }),
}));

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({ agentsConfig: { capabilities: [] } }),
}));

function setup() {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot>
      <JotaiProvider store={store}>{children}</JotaiProvider>
    </RecoilRoot>
  );
  const { result } = renderHook(
    () => ({
      stage: useStageSkill('convo1'),
      agent: useRecoilValue(ephemeralAgentByConvoId('convo1')),
    }),
    { wrapper },
  );
  return { result, store };
}

describe('useStageSkill', () => {
  beforeEach(() => {
    mockCanUseSkills = true;
    mockSkillsEnabled = true;
  });

  it('turns skills on and stages the skill once for the next message', () => {
    const { result, store } = setup();
    act(() => {
      result.current.stage?.('article-writer');
      result.current.stage?.('article-writer');
    });
    expect(store.get(pendingManualSkillsByConvoId('convo1'))).toEqual(['article-writer']);
    expect(result.current.agent?.skills).toBe(true);
  });

  it('offers nothing to stage when the user may not use skills', () => {
    mockCanUseSkills = false;
    expect(setup().result.current.stage).toBeNull();
  });

  it('offers nothing to stage when the deployment has skills off', () => {
    mockSkillsEnabled = false;
    expect(setup().result.current.stage).toBeNull();
  });
});
