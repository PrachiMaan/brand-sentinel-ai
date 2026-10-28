import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { scanLogo, isMarkLike, findLogo } from "../src/convex/lib/visual";
const fx = JSON.parse(readFileSync("eval/visual-fixtures.json","utf8"));
for (const deck of fx.decks) {
  for (const p of deck.pages.slice(0, 10)) {
    const img = decodePng(readFileSync(p.png));
    const s = scanLogo(img);
    console.log(deck.deckId, "p"+p.page, s ? `score=${s.score.toFixed(3)} box=${s.bbox.x.toFixed(3)},${s.bbox.y.toFixed(3)},${s.bbox.w.toFixed(3)},${s.bbox.h.toFixed(3)} marklike=${isMarkLike(img,s.bbox)}` : "none", findLogo(img) ? "ACCEPT" : "reject");
  }
}
