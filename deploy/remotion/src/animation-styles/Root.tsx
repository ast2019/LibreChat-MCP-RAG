import React from "react";
import { Composition } from "remotion";
import { DUR, FPS, H, W } from "./story";
import { STYLES } from "./catalog";
import { FILMS } from "./films";

// One composition per style: 1080x1350 (4:5), 30 fps, 150 frames (5 s), silent.
// Render with --scale=2 for the 2160x2700 final. Your own films (src/films) are listed after the styles.
export const Root: React.FC = () => (
  <>
    {STYLES.map((s) => (
      <Composition key={s.id} id={s.id} component={s.component} durationInFrames={DUR} fps={FPS} width={W} height={H} />
    ))}
    {FILMS.map((f) => (
      <Composition
        key={f.id}
        id={f.id}
        component={f.component}
        durationInFrames={f.durationInFrames ?? DUR}
        fps={FPS}
        width={f.width ?? W}
        height={f.height ?? H}
      />
    ))}
  </>
);
