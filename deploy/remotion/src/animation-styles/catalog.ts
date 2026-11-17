// The 39 styles, in one list. This is the only place a style is registered.
// `id` is the Remotion composition id (also the name you pass to `npm run render`).
// `file` is where its drawing code lives, so you can open it and read or change it.
import type React from "react";
import { draw62, draw80 } from "./styles/3d/clay-and-lidar";
import { draw59 } from "./styles/3d/glass";
import { draw57, draw58 } from "./styles/3d/island-and-bricks";
import { glView } from "./styles/3d/view";
import { Blueprint, Chalkboard, Notepad } from "./styles/drawn/boards";
import { CelBoil, OneLine } from "./styles/drawn/line";
import { Crayon, UrbanSketch, Watercolour } from "./styles/drawn/paint";
import { MemphisDiorama, Newsreel, SilentFilm } from "./styles/graphic-and-cinema/graphic-and-cinema";
import { MathDiagram, StickerExplainer } from "./styles/info/info";
import { CutOut, HandDrawn, Whiteboard } from "./styles/originals/originals";
import { Generative, LiquidMotion } from "./styles/print-and-abstract/abstract";
import { ArtDeco, StainedGlass, Ukiyoe } from "./styles/print-and-abstract/craft";
import { Engraving, Silkscreen, Woodcut } from "./styles/print-and-abstract/print";
import { CircuitBoard } from "./styles/screens/circuit";
import { HologramHUD } from "./styles/screens/hologram";
import { Microscope } from "./styles/screens/microscope";
import { PixelRPG } from "./styles/screens/pixel";
import { PaperPopUp, RedPapercut, ShadowPuppet } from "./styles/toon-and-paper/paper";
import { CelAnime80s, FlatVector, StickFigure } from "./styles/toon-and-paper/toon";

export type Family =
  | "Drawn on a board"
  | "Hand-drawn and painted"
  | "Cartoon"
  | "Paper and puppets"
  | "Print and craft"
  | "Graphic and explainer"
  | "3D look"
  | "Cinema eras"
  | "Screens and science"
  | "Abstract";

export type Style = {
  nn: string; // the style's number (kept from the original board of 92, so there are gaps)
  id: string; // composition id, e.g. "33-ukiyo-e"
  name: string;
  family: Family;
  look: string; // one plain sentence: what it looks like
  text: string; // on-screen words this style shows (change them when you change the story), or ""
  file: string;
  component: React.FC;
};

const s = (
  nn: string, slug: string, name: string, family: Family, look: string, text: string, file: string, component: React.FC,
): Style => ({ nn, id: `${nn}-${slug}`, name, family, look, text, file: `src/styles/${file}`, component });

export const STYLES: Style[] = [
  s("01", "whiteboard", "Whiteboard", "Drawn on a board", "A marker hand draws black lines on a white board, then fills the cup with colour.", "", "originals/originals.tsx", Whiteboard),
  s("02", "chalkboard", "Chalkboard", "Drawn on a board", "Dusty coloured chalk on a green-black board in a wooden frame.", "", "drawn/boards.tsx", Chalkboard),
  s("05", "notepad-doodle", "Notepad doodle", "Drawn on a board", "Blue and red ballpoint doodles on lined, spiral-bound notebook paper.", "", "drawn/boards.tsx", Notepad),
  s("06", "blueprint", "Blueprint", "Drawn on a board", "White technical drawing on blueprint blue, with grid, dimensions and a title block.", "", "drawn/boards.tsx", Blueprint),

  s("08", "hand-drawn", "Hand-drawn pencil sketch", "Hand-drawn and painted", "Wobbly graphite lines and soft shading on warm paper, drawn on twos.", "", "originals/originals.tsx", HandDrawn),
  s("09", "urban-sketch", "Urban sketch", "Hand-drawn and painted", "Loose ink lines with watercolour washes and a street in the background.", "", "drawn/paint.tsx", UrbanSketch),
  s("10", "crayon-book", "Crayon book", "Hand-drawn and painted", "Waxy crayon strokes like a child's colouring book, with a sun and crayons.", "", "drawn/paint.tsx", Crayon),
  s("11", "watercolour", "Watercolour", "Hand-drawn and painted", "Soft wet-edged washes and blooms on textured paper.", "", "drawn/paint.tsx", Watercolour),
  s("13", "one-line", "One line", "Hand-drawn and painted", "A single unbroken white line draws everything on a bold flat colour.", "", "drawn/line.tsx", OneLine),
  s("16", "cel-line-boil", "Cel line boil", "Hand-drawn and painted", "Classic frame-by-frame cel look: ink outlines that jitter (boil) every few frames.", "", "drawn/line.tsx", CelBoil),

  s("17", "flat-vector", "Flat vector", "Cartoon", "Clean 2D flat shapes, bright colours and no outlines, like an explainer app.", "", "toon-and-paper/toon.tsx", FlatVector),
  s("21", "cel-anime-80s", "80s cel anime", "Cartoon", "Hard cel shading, a sunset sky and a city skyline, like an 80s anime still.", "", "toon-and-paper/toon.tsx", CelAnime80s),
  s("22", "stick-figure", "Stick figure", "Cartoon", "A white round-head stick figure pours the chai under one hanging lamp.", "", "toon-and-paper/toon.tsx", StickFigure),

  s("23", "cut-out", "Cut-out collage", "Paper and puppets", "Paper shapes with torn edges and drop shadows, moved like a cut-out puppet.", "", "originals/originals.tsx", CutOut),
  s("24", "red-papercut", "Red papercut", "Paper and puppets", "Red cut paper with lacy patterns and flowers on a warm background.", "", "toon-and-paper/paper.tsx", RedPapercut),
  s("25", "paper-pop-up", "Paper pop-up", "Paper and puppets", "A pop-up book page: layered card that stands up with folds and shadows.", "", "toon-and-paper/paper.tsx", PaperPopUp),
  s("27", "shadow-puppet", "Shadow puppet", "Paper and puppets", "Black puppets with cut-out holes on rods, lit from behind on a glowing screen.", "", "toon-and-paper/paper.tsx", ShadowPuppet),

  s("28", "woodcut", "Woodcut", "Print and craft", "Black and white relief print with gouged lines and rough edges.", "", "print-and-abstract/print.tsx", Woodcut),
  s("29", "engraving", "Engraving", "Print and craft", "Fine hatched lines like an old banknote, in a green ornamental frame.", "", "print-and-abstract/print.tsx", Engraving),
  s("31", "silkscreen-poster", "Silkscreen poster", "Print and craft", "Flat ink layers, sunburst rays and slight misregistration, like a screen-printed poster.", "", "print-and-abstract/print.tsx", Silkscreen),
  s("33", "ukiyo-e", "Ukiyo-e", "Print and craft", "Flat colour and ink outlines like a Japanese woodblock print, with clouds and blossom.", "", "print-and-abstract/craft.tsx", Ukiyoe),
  s("34", "art-deco", "Art deco", "Print and craft", "Gold lines, stepped frames and sunrays on deep teal, like a 1920s poster.", "", "print-and-abstract/craft.tsx", ArtDeco),
  s("35", "stained-glass", "Stained glass", "Print and craft", "Coloured glass panes and black lead lines in an arched window.", "", "print-and-abstract/craft.tsx", StainedGlass),

  s("39", "memphis-diorama", "Memphis diorama", "Graphic and explainer", "80s Memphis design: loud patterns, squiggles and a checkered floor in a little room.", "", "graphic-and-cinema/graphic-and-cinema.tsx", MemphisDiorama),
  s("51", "sticker-explainer", "Sticker explainer", "Graphic and explainer", "Die-cut stickers with white borders that pop in, with bold word stickers.", "word stickers: POUR, FILL, READY", "info/info.tsx", StickerExplainer),
  s("52", "math-diagram", "Math diagram", "Graphic and explainer", "A chalk-on-navy maths explainer: angles, points, a dotted pour path and a fill graph.", "maths labels: θ = 38°, A, B, r, h(t), A sin(ωz)", "info/info.tsx", MathDiagram),

  s("57", "low-poly-island", "Low-poly island", "3D look", "Faceted low-poly 3D: the cup sits on a tiny island with palm trees in a polygon sea.", "", "3d/island-and-bricks.ts", glView(draw57)),
  s("58", "brick-toy", "Brick toy", "3D look", "Everything built from toy bricks and studs on a green baseplate.", "", "3d/island-and-bricks.ts", glView(draw58)),
  s("59", "glass-product", "Glass product", "3D look", "A clear glass kettle and cup lit like a product shot, with refraction and glow.", "", "3d/glass.ts", glView(draw59)),
  s("62", "claymation", "Claymation", "3D look", "Lumpy plasticine shapes with fingerprints, stepped like stop-motion.", "", "3d/clay-and-lidar.ts", glView(draw62)),
  s("80", "lidar-survey", "Lidar survey", "3D look", "A glowing 3D point cloud, like a laser scan, in blue and gold.", "", "3d/clay-and-lidar.ts", glView(draw80, 1.25)),

  s("70", "silent-film", "Silent film", "Cinema eras", "Black and white 1920s film: grain, flicker, scratches and a stage curtain.", "intertitles: A CUP OF CHAI / Piping hot!", "graphic-and-cinema/graphic-and-cinema.tsx", SilentFilm),
  s("71", "newsreel", "Newsreel", "Cinema eras", "Sepia 1940s newsreel with a slanted headline banner and film damage.", "headlines: THE POUR BEGINS / CUP FILLS FAST / STEAM RISES, and a CHAI! title card", "graphic-and-cinema/graphic-and-cinema.tsx", Newsreel),

  s("64", "pixel-art-rpg", "Pixel art RPG", "Screens and science", "Chunky pixel sprites and stepped motion in a cosy room, with a game dialogue box.", "dialogue box: THE KETTLE ARRIVES! / IT POURS HOT CHAI... / THE KULHAD IS FULL!", "screens/pixel.tsx", PixelRPG),
  s("81", "microscope", "Microscope", "Screens and science", "The chai seen through a microscope: a round lens view of bubbles and specks.", "", "screens/microscope.tsx", Microscope),
  s("84", "hologram-hud", "Hologram HUD", "Screens and science", "A cyan sci-fi hologram with wireframes, readouts and a fill gauge.", "HUD labels: TILT, POUR, FILL, STEAM, CUP LEVEL, HOT and a % readout", "screens/hologram.tsx", HologramHUD),
  s("85", "circuit-board", "Circuit board", "Screens and science", "A green circuit board where the chai flows along glowing copper traces.", "board labels: CHAI, KETTLE, POUR, KULHAD, FILL", "screens/circuit.tsx", CircuitBoard),

  s("87", "liquid-motion", "Liquid motion", "Abstract", "Smooth, bouncy, glossy shapes that stretch and settle like liquid.", "", "print-and-abstract/abstract.tsx", LiquidMotion),
  s("89", "generative-abstract", "Generative abstract", "Abstract", "Thousands of tiny strokes in a flow field that form the kettle, pour and cup.", "", "print-and-abstract/abstract.tsx", Generative),
];
