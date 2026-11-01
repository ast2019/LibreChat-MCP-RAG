import { renderHook } from '@testing-library/react';
import type { TMediaAvailability, TOfficeToolsStartupConfig } from 'librechat-data-provider';
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

const office = (officeTools?: TOfficeToolsStartupConfig) => ({ data: { officeTools } });

describe('useCreateEntries', () => {
  const onCompose = jest.fn();
  const onShowAll = jest.fn();
  const onStageSkill = jest.fn();
  const render = (enabled = true, stage: typeof onStageSkill | null = onStageSkill) =>
    renderHook(() => useCreateEntries({ enabled, onCompose, onShowAll, onStageSkill: stage }))
      .result.current;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartupConfig.mockReturnValue(office());
  });

  it('starts an available request in the composer and closes the palette', () => {
    mockStatus.mockReturnValue(availability([{ id: 'image', state: 'active' }]));
    const [image, all] = render();
    expect(image).toMatchObject({
      key: 'create:image',
      section: 'create',
      dismiss: true,
      favoritable: false,
      description: 'com_ui_create_image_hint',
    });
    image.onSelect();
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

  it('offers the article wizard and the slide builder, marked experimental, before «all ways»', () => {
    mockStatus.mockReturnValue(availability([{ id: 'image', state: 'active' }]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    const entries = render();
    expect(entries.map((entry) => entry.key)).toEqual([
      'create:image',
      'create:article',
      'create:slides',
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

  it('turns the skill on for the next message and starts the request', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    const slides = render().find((entry) => entry.key === 'create:slides')!;
    slides.onSelect();
    expect(onStageSkill).toHaveBeenCalledWith('slide-builder');
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_slides_starter');
  });

  it('still starts the request when the user cannot use skills', () => {
    mockStatus.mockReturnValue(availability([]));
    mockStartupConfig.mockReturnValue(office({ word: true, slides: false }));
    const entries = render(true, null);
    expect(entries.map((entry) => entry.key)).toEqual(['create:article', 'create:all']);
    entries[0].onSelect();
    expect(onCompose).toHaveBeenCalledWith('com_ui_create_article_starter');
  });

  it('shows the article and slide rows while the media status is still loading', () => {
    mockStatus.mockReturnValue({ data: undefined });
    mockStartupConfig.mockReturnValue(office({ word: true, slides: true }));
    expect(render().map((entry) => entry.key)).toEqual(['create:article', 'create:slides']);
  });
});
