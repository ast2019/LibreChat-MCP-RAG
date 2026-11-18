import { flagsForSkillName, reconcileFeatureFlags } from '../featureToolFlags';

describe('featureToolFlags', () => {
  it('maps office, clip and persian skills to the matching tool flags', () => {
    expect(flagsForSkillName('article-writer')).toEqual({
      ask_user_question: true,
      skills: true,
      office: true,
    });
    expect(flagsForSkillName('clip-builder')).toEqual({
      ask_user_question: true,
      skills: true,
      clip: true,
    });
    expect(flagsForSkillName('persian-calendar')).toEqual({
      ask_user_question: true,
      skills: true,
      persian: true,
    });
  });

  it('clears ask_user_question when no feature tools remain', () => {
    const next = reconcileFeatureFlags(
      { media: true, ask_user_question: true, office: true },
      [],
      { media: false, office: false },
    );
    expect(next.media).toBe(false);
    expect(next.office).toBe(false);
    expect(next.ask_user_question).toBe(false);
  });

  it('keeps office while another office skill is still staged', () => {
    const next = reconcileFeatureFlags({ office: true, ask_user_question: true }, [
      'slide-builder',
    ]);
    expect(next.office).toBe(true);
    expect(next.ask_user_question).toBe(true);
  });
});
