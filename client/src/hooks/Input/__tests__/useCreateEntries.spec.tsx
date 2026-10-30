import { renderHook } from '@testing-library/react';
import type { TMediaAvailability } from 'librechat-data-provider';
import useCreateEntries from '../useCreateEntries';

const mockStatus = jest.fn();
jest.mock('~/data-provider', () => ({
  useMediaStatusQuery: (enabled: boolean) => mockStatus(enabled),
}));

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

const availability = (ways: TMediaAvailability['ways']): { data: TMediaAvailability } => ({
  data: { paidOnly: true, hasPack: false, userSwitch: null, ways },
});

describe('useCreateEntries', () => {
  const onCompose = jest.fn();
  const onShowAll = jest.fn();
  const render = (enabled = true) =>
    renderHook(() => useCreateEntries({ enabled, onCompose, onShowAll })).result.current;

  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(render(false)).toEqual([]);
    expect(mockStatus).toHaveBeenCalledWith(false);
  });
});
