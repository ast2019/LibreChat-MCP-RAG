import path from 'path';
import { Types } from 'mongoose';
import { OfficeTools } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import {
  getOfficeConfig,
  getChatOfficeTools,
  getSkillOfficeTools,
  buildOfficeToolContext,
  getOfficeStartupConfig,
} from './config';
import { getDeploymentSkillByName, initializeDeploymentSkills } from '~/skills/deployment';

const repositoryRoot = path.resolve(__dirname, '../../../..');
const withConfig = (officeTools: unknown) => ({ config: { officeTools } }) as unknown as AppConfig;

describe('Office tools in ordinary chats', () => {
  it('offers both builders by default and follows the admin switches', () => {
    expect(getChatOfficeTools(undefined)).toEqual([OfficeTools.word, OfficeTools.slides]);
    expect(getChatOfficeTools(withConfig({ slides: false }))).toEqual([OfficeTools.word]);
    expect(getChatOfficeTools(withConfig({ word: false, slides: false }))).toEqual([]);
  });

  it('keeps them out of confidential and local specs', () => {
    expect(getChatOfficeTools(undefined, { privacy: 'private' })).toEqual([]);
    expect(getChatOfficeTools(undefined, { privacy: 'local' })).toEqual([]);
  });

  it('falls back to the defaults for an invalid section', () => {
    expect(getOfficeConfig(withConfig({ maxSlides: 'many' }))).toMatchObject({
      word: true,
      slides: true,
      maxSlides: 40,
      embedFonts: true,
    });
  });

  it('tells the composer which «ساختن» rows to show', () => {
    expect(getOfficeStartupConfig(undefined)).toEqual({ word: true, slides: true });
    expect(getOfficeStartupConfig(withConfig({ word: false }))).toEqual({
      word: false,
      slides: true,
    });
  });
});

describe('buildOfficeToolContext', () => {
  it('lists the images of this request for the tools that are loaded', () => {
    const context = buildOfficeToolContext(
      [OfficeTools.slides],
      [{ file_id: 'logo-123456', filename: 'logo.png' }, { file_id: '' }],
    );
    expect(Object.keys(context)).toEqual([OfficeTools.slides]);
    expect(context[OfficeTools.slides]).toContain('- logo-123456 (logo.png)');
    expect(context[OfficeTools.slides]).toContain('logo_image_id');
  });

  it('says nothing without images', () => {
    expect(buildOfficeToolContext([OfficeTools.word, OfficeTools.slides], [])).toEqual({});
    expect(buildOfficeToolContext([OfficeTools.word], undefined)).toEqual({});
  });
});

describe('shipped article and slide skills', () => {
  beforeAll(async () => {
    await initializeDeploymentSkills({ projectRoot: repositoryRoot, env: {} });
  });

  it.each([
    ['article-writer', 'ویزارد مقاله', [OfficeTools.word]],
    ['slide-builder', 'ساخت پاورپوینت', [OfficeTools.slides]],
  ])('loads %s with its Persian title and tool', (name, title, tools) => {
    expect(getDeploymentSkillByName(name)).toMatchObject({
      name,
      displayTitle: title,
      allowedTools: tools,
    });
  });

  it('gives a saved agent the builder of each skill in its scope, when it is on', () => {
    const article = getDeploymentSkillByName('article-writer')!;
    const slides = getDeploymentSkillByName('slide-builder')!;
    const scope = { accessibleSkillIds: [article._id, slides._id], userId: 'u1' };
    expect(getSkillOfficeTools(undefined, scope)).toEqual([OfficeTools.word, OfficeTools.slides]);
    expect(getSkillOfficeTools(withConfig({ word: false }), scope)).toEqual([OfficeTools.slides]);
    expect(
      getSkillOfficeTools(undefined, { accessibleSkillIds: [new Types.ObjectId()], userId: 'u1' }),
    ).toEqual([]);
  });
});
