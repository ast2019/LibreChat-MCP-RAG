// Canvas host for the 3D family: one float frame per Remotion frame, drawn synchronously.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { H, W } from "../../story";
import { Target, makeTarget } from "./mesh";

export type Draw = (f: number, t: Target, ctx: CanvasRenderingContext2D) => void;

const GLView: React.FC<{ draw: Draw; ss: number }> = ({ draw, ss }) => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.round(W * ss);
  const h = Math.round(H * ss);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    draw(f, makeTarget(w, h, ss), ctx);
  }, [f, draw, w, h, ss]);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <canvas ref={ref} width={w} height={h} style={{ width: W, height: H, position: "absolute", left: 0, top: 0 }} />
    </AbsoluteFill>
  );
};

// Wraps a 3D draw function as a Remotion component. `ss` is the internal canvas scale
// (1 = drawn at 1080x1350). HiveGPT worker change: upstream used 1.5 (1620x2025), which is a
// CPU software rasterizer and rendered at about 1-2.5 s per frame; 1 is ~2.2x cheaper.
export const glView = (draw: Draw, ss = 1): React.FC => {
  const C: React.FC = () => <GLView draw={draw} ss={ss} />;
  return C;
};
