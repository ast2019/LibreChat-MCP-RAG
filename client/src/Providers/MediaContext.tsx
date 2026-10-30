import { createContext, useContext } from 'react';
import type { TAttachment } from 'librechat-data-provider';

type MediaContext = {
  /**
   * The turn's attachments, addressable by the filename a markdown image
   * names them with. A model that writes `![DTI](5_dti.png)` is referring to
   * a file the run produced, not to a path the browser can fetch, so the
   * markdown renderer resolves the reference through this map.
   */
  attachmentsByName?: ReadonlyMap<string, TAttachment>;
  /**
   * Background video jobs the message already shows as a card drawn from the
   * `generate_video` call, so a job link in the reply text renders nothing more.
   */
  toolMediaJobIds?: ReadonlySet<string>;
};

export const MediaContext = createContext<MediaContext>({});
export const useMediaContext = () => useContext(MediaContext);
