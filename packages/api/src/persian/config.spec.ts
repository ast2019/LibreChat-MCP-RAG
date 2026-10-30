import path from 'path';
import { Types } from 'mongoose';
import { PersianTools } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getDeploymentSkillByName, initializeDeploymentSkills } from '~/skills/deployment';
import { getChatPersianTools, getPersianConfig, getSkillPersianTools } from './config';

const repositoryRoot = path.resolve(__dirname, '../../../..');

describe('shipped Persian skills', () => {
  beforeAll(async () => {
    await initializeDeploymentSkills({ projectRoot: repositoryRoot, env: {} });
  });

  it.each([
    ['persian-calendar', 'تقویم و تاریخ فارسی', [PersianTools.calendar]],
    ['persian-orthography', 'نگارش و نیم‌فاصله', [PersianTools.normalize]],
    ['natural-persian-content', 'نوشتن محتوای فارسی', [PersianTools.normalize]],
  ])('loads %s with its Persian title and tool', (name, title, tools) => {
    const skill = getDeploymentSkillByName(name);
    expect(skill).toMatchObject({ name, displayTitle: title, allowedTools: tools });
  });

  it('gives a saved agent the tools of the Persian skills in its scope', () => {
    const calendar = getDeploymentSkillByName('persian-calendar')!;
    const content = getDeploymentSkillByName('natural-persian-content')!;
    expect(getSkillPersianTools({ accessibleSkillIds: [calendar._id], userId: 'u1' })).toEqual([
      PersianTools.calendar,
    ]);
    expect(getSkillPersianTools({ accessibleSkillIds: [content._id], userId: 'u1' })).toEqual([
      PersianTools.normalize,
    ]);
    expect(
      getSkillPersianTools({ accessibleSkillIds: [new Types.ObjectId()], userId: 'u1' }),
    ).toEqual([]);
  });

  it('drops the tool when the user turned its skill off', () => {
    const calendar = getDeploymentSkillByName('persian-calendar')!;
    expect(
      getSkillPersianTools({
        accessibleSkillIds: [calendar._id],
        skillStates: { [calendar._id.toString()]: false },
        userId: 'u1',
      }),
    ).toEqual([]);
  });
});

describe('Persian tools in ordinary chats', () => {
  const withConfig = (persianTools: unknown) =>
    ({ config: { persianTools } }) as unknown as AppConfig;

  it('are on by default and off when the admin says so', () => {
    expect(getChatPersianTools(undefined)).toEqual([PersianTools.calendar, PersianTools.normalize]);
    expect(getChatPersianTools(withConfig({ chat: false }))).toEqual([]);
  });

  it('stay out of confidential and local specs', () => {
    expect(getChatPersianTools(undefined, { privacy: 'private' })).toEqual([]);
    expect(getChatPersianTools(undefined, { privacy: 'local' })).toEqual([]);
  });

  it('fall back to the defaults for an invalid section', () => {
    expect(getPersianConfig(withConfig({ holidays: 'nope' }))).toEqual({
      chat: true,
      timezone: 'Asia/Tehran',
      holidays: [],
    });
  });
});
