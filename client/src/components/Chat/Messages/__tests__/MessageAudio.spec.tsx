import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import MessageAudio from '../MessageAudio';
import store from '~/store';

let mockLocal = false;
jest.mock('~/hooks/Input/useSpeechRoute', () => ({
  __esModule: true,
  default: () => ({ fields: {}, local: mockLocal }),
}));

jest.mock('~/components/Audio/TTS', () => ({
  BrowserTTS: () => <div data-testid="browser-tts" />,
  ExternalTTS: () => <div data-testid="external-tts" />,
}));

const renderMessageAudio = ({
  engineTTS,
  initialized,
}: {
  engineTTS: 'browser' | 'external';
  initialized: boolean;
}) =>
  render(
    <RecoilRoot
      initializeState={({ set }) => {
        set(store.engineTTS, engineTTS);
        set(store.speechSettingsInitialized, initialized);
      }}
    >
      <MessageAudio index={0} messageId="message-1" content="Read this" />
    </RecoilRoot>,
  );

describe('MessageAudio speech settings initialization', () => {
  it('does not mount browser TTS before speech settings initialize', () => {
    renderMessageAudio({ engineTTS: 'browser', initialized: false });

    expect(screen.queryByTestId('browser-tts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('external-tts')).not.toBeInTheDocument();
  });

  it('mounts external TTS after its configured engine initializes', () => {
    renderMessageAudio({ engineTTS: 'external', initialized: true });

    expect(screen.getByTestId('external-tts')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-tts')).not.toBeInTheDocument();
  });

  it('keeps a local conversation on browser speech even when server speech is selected', () => {
    mockLocal = true;
    renderMessageAudio({ engineTTS: 'external', initialized: true });

    expect(screen.getByTestId('browser-tts')).toBeInTheDocument();
    expect(screen.queryByTestId('external-tts')).not.toBeInTheDocument();
    mockLocal = false;
  });
});
