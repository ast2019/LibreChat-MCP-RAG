import { getAudioLinkSource, getVideoLinkSource } from '../MarkdownComponents';

describe('media links in messages', () => {
  it('plays https and same-site video and audio files', () => {
    expect(getVideoLinkSource('https://cdn.example.com/a.mp4?sig=1')).toBe(
      'https://cdn.example.com/a.mp4?sig=1',
    );
    expect(getVideoLinkSource('/images/u1/abc-video.mp4')).toBe('/images/u1/abc-video.mp4');
    expect(getAudioLinkSource('/images/u1/abc-speech.mp3')).toBe('/images/u1/abc-speech.mp3');
  });

  it('leaves other links alone', () => {
    expect(getVideoLinkSource('http://cdn.example.com/a.mp4')).toBeNull();
    expect(getVideoLinkSource('//evil.example.com/a.mp4')).toBeNull();
    expect(getAudioLinkSource('/images/u1/a.mp4')).toBeNull();
    expect(getVideoLinkSource('https://example.com/page')).toBeNull();
  });
});
