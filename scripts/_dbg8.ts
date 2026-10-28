import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { scanLogo, findLogo } from "../src/convex/lib/visual";
const img = decodePng(readFileSync("demo-assets/decks/png/clean-p1.png"));
const s = scanLogo(img)!;
console.log(s, "px", s.bbox.x*960, s.bbox.y*540, s.bbox.w*960, s.bbox.h*540);
console.log(findLogo(img));
