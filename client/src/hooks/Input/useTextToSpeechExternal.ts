import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import type { SpeechRouteFields } from '~/utils/speech';
import {
  sniffAudioType,
  speechErrorKey,
  primeAudioElement,
  readSpeechErrorCode,
  appendSpeechRouteFields,
} from '~/utils/speech';
import {
  getTTSCacheKey,
  setCachedTTSAudio,
  getCachedTTSAudio,
  getTTSCacheGeneration,
} from '~/utils';
import { useTextToSpeechMutation, useVoicesQuery } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import store from '~/store';

const createFormData = (text: string, voice: string, routeFields?: SpeechRouteFields) => {
  const formData = new FormData();
  formData.append('input', text);
  formData.append('voice', voice);
  appendSpeechRouteFields(formData, routeFields);
  return formData;
};

type TUseTTSExternal = {
  setIsSpeaking: React.Dispatch<React.SetStateAction<boolean>>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  messageId?: string;
  isLast: boolean;
  index?: number;
  /** The message's conversation, so the server routes speech like that conversation. */
  routeFields?: SpeechRouteFields;
};

function useTextToSpeechExternal({
  setIsSpeaking,
  audioRef,
  messageId,
  isLast,
  index = 0,
  routeFields,
}: TUseTTSExternal) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const voice = useRecoilValue(store.voice);
  const cacheTTS = useRecoilValue(store.cacheTTS);
  const playbackRate = useRecoilValue(store.playbackRate);

  const [downloadFile, setDownloadFile] = useState(false);

  const promiseAudioRef = useRef<HTMLAudioElement | null>(null);
  /** The cache generation each request started in, so audio from before a logout is not kept. */
  const requestGenerations = useRef(new WeakMap<FormData, number>());

  /* Global Audio Variables */
  const globalIsFetching = useRecoilValue(store.globalAudioFetchingFamily(index));
  const globalIsPlaying = useRecoilValue(store.globalAudioPlayingFamily(index));

  /** Created and primed inside the tap that asked for speech, so iOS lets it play the audio
   *  that arrives after the request. */
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const getPlayer = () => {
    if (playerRef.current == null && typeof Audio !== 'undefined') {
      playerRef.current = new Audio();
    }
    return playerRef.current;
  };

  const playAudioPromise = (blobUrl: string) => {
    const newAudio = getPlayer() ?? new Audio();
    newAudio.src = blobUrl;
    const initializeAudio = () => {
      if (playbackRate != null && playbackRate !== 1 && playbackRate > 0) {
        newAudio.playbackRate = playbackRate;
      }
    };

    initializeAudio();
    const playPromise = () => newAudio.play().then(() => setIsSpeaking(true));

    playPromise().catch((error: Error) => {
      if (
        error.message &&
        error.message.includes('The play() request was interrupted by a call to pause()')
      ) {
        console.log('Play request was interrupted by a call to pause()');
        initializeAudio();
        return playPromise().catch(console.error);
      }
      console.error(error);
      showToast({
        message: localize('com_nav_audio_play_error', { 0: error.message }),
        status: 'error',
      });
    });

    newAudio.onended = () => {
      console.log('Cached message audio ended');
      URL.revokeObjectURL(blobUrl);
      setIsSpeaking(false);
    };

    promiseAudioRef.current = newAudio;
  };

  const downloadAudio = (blobUrl: string, type = 'audio/mpeg') => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = type === 'audio/wav' ? 'audio.wav' : 'audio.mp3';
    a.click();
    setDownloadFile(false);
  };

  const { mutate: processAudio, isLoading } = useTextToSpeechMutation({
    onMutate: (variables) => {
      const inputText = (variables.get('input') ?? '') as string;
      if (inputText.length >= 4096) {
        showToast({
          message: localize('com_nav_long_audio_warning'),
          status: 'warning',
        });
      }
    },
    onSuccess: async (data: ArrayBuffer, variables) => {
      try {
        const inputText = (variables.get('input') ?? '') as string;
        const audioType = sniffAudioType(data);
        const audioBlob = new Blob([data], { type: audioType });

        const generation = requestGenerations.current.get(variables);
        if (cacheTTS && inputText && generation != null) {
          /** Not awaited: caching must never delay playback. */
          void getTTSCacheKey(inputText, (variables.get('voice') ?? '') as string, user?.id).then(
            (cacheKey) => cacheKey && setCachedTTSAudio(cacheKey, audioBlob, generation),
          );
        }

        const blobUrl = URL.createObjectURL(audioBlob);
        if (downloadFile) {
          downloadAudio(blobUrl, audioType);
          return;
        }
        playAudioPromise(blobUrl);
      } catch (error) {
        showToast({
          message: `Error processing audio: ${(error as Error).message}`,
          status: 'error',
        });
      }
    },
    onError: (error: unknown) => {
      const code = readSpeechErrorCode(error);
      showToast({
        message: code
          ? localize(speechErrorKey(code))
          : localize('com_nav_audio_process_error', { 0: (error as Error).message }),
        status: 'error',
      });
    },
  });

  const startMutation = (text: string, download: boolean) => {
    const formData = createFormData(text, voice ?? '', routeFields);
    requestGenerations.current.set(formData, getTTSCacheGeneration());
    setDownloadFile(download);
    processAudio(formData);
  };

  const generateSpeechExternal = (text: string, download: boolean) => {
    const player = download ? null : getPlayer();
    if (player) {
      primeAudioElement(player);
    }
    if (cacheTTS) {
      handleCachedResponse(text, download);
    } else {
      startMutation(text, download);
    }
  };

  const handleCachedResponse = async (text: string, download: boolean) => {
    const cacheKey = await getTTSCacheKey(text, voice ?? '', user?.id);
    const cachedAudio = cacheKey ? getCachedTTSAudio(cacheKey) : undefined;
    if (!cachedAudio) {
      return startMutation(text, download);
    }
    const blobUrl = URL.createObjectURL(cachedAudio);
    if (download) {
      downloadAudio(blobUrl, cachedAudio.type);
    } else {
      playAudioPromise(blobUrl);
    }
  };

  const cancelSpeech = () => {
    const messageAudio = document.getElementById(`audio-${messageId}`) as HTMLAudioElement | null;
    const pauseAudio = (currentElement: HTMLAudioElement | null) => {
      if (currentElement) {
        currentElement.pause();
        currentElement.src && URL.revokeObjectURL(currentElement.src);
        audioRef.current = null;
      }
    };
    pauseAudio(messageAudio);
    pauseAudio(promiseAudioRef.current);
    setIsSpeaking(false);
  };

  const cancelPromiseSpeech = useCallback(() => {
    if (promiseAudioRef.current) {
      promiseAudioRef.current.pause();
      promiseAudioRef.current.src && URL.revokeObjectURL(promiseAudioRef.current.src);
      promiseAudioRef.current = null;
      setIsSpeaking(false);
    }
  }, [setIsSpeaking]);

  useEffect(() => cancelPromiseSpeech, [cancelPromiseSpeech]);

  const isFetching = useMemo(
    () => isLast && globalIsFetching && !globalIsPlaying,
    [globalIsFetching, globalIsPlaying, isLast],
  );

  const { data: voicesData = [] } = useVoicesQuery();

  return {
    generateSpeechExternal,
    cancelSpeech,
    isLoading: isFetching || isLoading,
    audioRef,
    voices: voicesData,
  };
}

export default useTextToSpeechExternal;
