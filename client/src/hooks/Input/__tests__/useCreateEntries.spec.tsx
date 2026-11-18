import { renderHook } from '@testing-library/react';
import type {
  TMediaAvailability,
  TClipToolsStartupConfig,
  TOfficeToolsStartupConfig,
} from 'librechat-data-provider';
import useCreateEntries from '../useCreateEntries';

const mockStatus = jest.fn();
const mockStartupConfig = jest.fn();
jest.mock('~/data-provider', () => ({
  useMediaStatusQuery: (enabled: boolean) => mockStatus(enabled),
  useGetStartupConfig: () => mockStartupConfig(),
}));

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('~/components/ui/ExperimentalBadge', () => ({
  __esModule: true,
  default: () => 'experimental-badge',
}));

const availability = (ways: TMediaAvailability['ways']): { data: TMediaAvailability } => ({
  data: { paidOnly: true, hasPack: false, userSwitch: null, ways },
});

const office = (
  officeTools?: TOfficeToolsStartupConfig,
  clipTools?: TClipToolsStartupConfig,
) => ({ data: { officeTools, clipTools } });

describe('useCreateEntries', () => {
  const onCompose = jest.fn();
  const onShowAll = jest.fn();
  const stage = jest.fn();
  const unstage = jest.fn();
  const setFeatures = jest.fn();
  const skills = (staged: string[] = []) => ({ staged, stage, unstage });
  const features = (flags: { media?: boolean; office?: boolean; clip?: boolean } = {}) => ({
    media: flags.media === true,
    office: flags.office === true,
    clip: flags.clip === true,
    set: setFeatures,
  });
  const render = (
    enabled = true,
    staged: ReturnType<typeof skills> | null = skills(),
    featureFlags: ReturnType<typeof features> | null = features(),
  ) =>
    renderHook(() =>
      useCreateEntries({
        enabled,
        onCompose,
        onShowAll,
        skills: staged,
        features: featureFlags,
      }),
    ).result.current;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartupConfig.mockReturnValue(office());
  });

  it('starts an available request in the composer and equips media tools', () => {
    mockStatus.mockReturnValue(availability([{ id: 'image', state: 'active' }]));
    const [image, all] = render();
    expect(image).toMatchObject({
      key: 'create:image',
      section: 'create',
      dismiss: true,
      favoritable: false,
      description: 'com_ui_create_image_hint',
      active: false,
    });
    image.onSelect();
    expect(setFeatures).toHaveBeenCalledWith({ media: true, ask_user_question: true });
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_image_starter');
    expect(all.key).toBe('create:all');
  });

  it('says why a way is off and opens the media dialog instead', () => {
    mockStatus.mockReturnValue(availability([{ id: 'video', state: 'needs_pack' }]));
    const [video] = render();
    expect(video.description).toBe('com_media_state_needs_pack');
    video.onSelect();
    expect(onShowAll).toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
  });

  it('leaves out ways the deployment has not set up, but keeps «all ways»', () => {
    mockStatus.mockReturnValue(
      availability([
        { id: 'image', state: 'not_configured' },
        { id: 'speech', state: 'active' },
        { id: 'higgsfield_api', state: 'active' },
      ]),
    );
    expect(render().map((entry) => entry.key)).toEqual(['create:speech', 'create:all']);
  });

  it('shows nothing, and fetches nothing, before the palette is opened', () => {
    mockStatus.mockReturnValue({ data: undefined });
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    expect(render(false)).toEqual([]);
    expect(mockStatus).toHaveBeenCalledWith(false);
  });

  it('offers the article wizard, the slide builder and the clip builder, marked experimental, before «all ways»', () => {
    mockStatus.mockReturnValue(availability([{ id: 'image', state: 'active' }]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }, { clip: true }));
    const entries = render();
    expect(entries.map((entry) => entry.key)).toEqual([
      'create:image',
      'create:article',
      'create:slides',
      'create:clip',
      'create:all',
    ]);
    const article = entries[1];
    expect(article).toMatchObject({
      label: 'com_ui_create_article',
      description: 'com_ui_create_article_hint',
      dismiss: true,
      favoritable: false,
    });
    expect(article.badge).toBeTruthy();
  });

  it('turns the skill on for the next message, equips office/clip tools, and starts the request', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }, { clip: true }));
    const slides = render().find((entry) => entry.key === 'create:slides')!;
    slides.onSelect();
    expect(stage).toHaveBeenCalledWith('slide-builder');
    expect(setFeatures).toHaveBeenCalledWith({ office: true, ask_user_question: true });
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_slides_starter');
    const clip = render().find((entry) => entry.key === 'create:clip')!;
    clip.onSelect();
    expect(stage).toHaveBeenCalledWith('clip-builder');
    expect(setFeatures).toHaveBeenCalledWith({ clip: true, ask_user_question: true });
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_clip_starter');
  });

  it('shows equipped office rows as on, and picking a staged one unstages it', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    const entries = render(true, skills(['article-writer']), features({ office: true }));
    const article = entries.find((entry) => entry.key === 'create:article')!;
    const slides = entries.find((entry) => entry.key === 'create:slides')!;
    expect(article.active).toBe(true);
    expect(slides.active).toBe(true);
    article.onSelect();
    expect(unstage).toHaveBeenCalledWith('article-writer');
    expect(setFeatures).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
  });

  it('keeps office/clip rows on after staged skills were drained, and click clears the flag', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }, { clip: true }));
    const entries = render(true, skills([]), features({ office: true, clip: true }));
    const article = entries.find((entry) => entry.key === 'create:article')!;
    const clip = entries.find((entry) => entry.key === 'create:clip')!;
    expect(article.active).toBe(true);
    expect(clip.active).toBe(true);
    article.onSelect();
    expect(unstage).not.toHaveBeenCalled();
    expect(setFeatures).toHaveBeenCalledWith({ office: false });
    expect(stage).not.toHaveBeenCalled();
    clip.onSelect();
    expect(setFeatures).toHaveBeenCalledWith({ clip: false });
  });

  it('still starts the request and equips office tools when the user cannot use skills', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: false }));
    const entries = render(true, null);
    expect(entries.map((entry) => entry.key)).toEqual(['create:article', 'create:all']);
    entries[0].onSelect();
    expect(setFeatures).toHaveBeenCalledWith({ office: true, ask_user_question: true });
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_article_starter');
  });

  it('shows the article and slide rows while the media status is still loading', () => {
    mockStatus.mockReturnValue({ data: undefined });
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    expect(render().map((entry) => entry.key)).toEqual(['create:article', 'create:slides']);
  });
});

describe('useCreateEntries image model row', () => {
  const onOpen = jest.fn();
  const models = [
    {
      id: 'openai/gpt-image-2',
      name: 'GPT Image 2',
      persianText: true,
      estimateUsd: 0.06,
      default: true,
    },
    {
      id: 'black-forest-labs/flux.2-pro',
      name: 'FLUX.2 Pro',
      persianText: false,
      estimateUsd: 0.1,
    },
  ];
  const statusWith = (state: string, imageModels = models) => ({
    data: {
      paidOnly: true,
      hasPack: true,
      userSwitch: null,
      ways: [{ id: 'image', state }],
      imageModels,
    },
  });
  const render = (current?: string) =>
    renderHook(() =>
      useCreateEntries({
        enabled: true,
        onCompose: jest.fn(),
        onShowAll: jest.fn(),
        imageModel: { current, onOpen },
      }),
    ).result.current;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartupConfig.mockReturnValue(office());
  });

  it('names the model pictures use and opens the picker', () => {
    mockStatus.mockReturnValue(statusWith('active'));
    const row = render('black-forest-labs/flux.2-pro').find(
      (entry) => entry.key === 'create:image_model',
    )!;
    expect(row).toMatchObject({ section: 'create', dismiss: true, favoritable: false });
    expect(row.description).toBe('com_ui_create_image_model_hint');
    row.onSelect();
    expect(onOpen).toHaveBeenCalled();
  });

  it('is left out when images are off or there is only one model', () => {
    mockStatus.mockReturnValue(statusWith('needs_pack'));
    expect(render().some((entry) => entry.key === 'create:image_model')).toBe(false);
    mockStatus.mockReturnValue(statusWith('active', models.slice(0, 1)));
    expect(render().some((entry) => entry.key === 'create:image_model')).toBe(false);
  });
});
