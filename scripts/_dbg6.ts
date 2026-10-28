import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { analyseDeck, findLogo } from "../src/convex/lib/visual";
import { RULES, PALETTE } from "../src/convex/lib/lumora";
const fx = JSON.parse(readFileSync("eval/visual-fixtures.json","utf8"));
const vr = RULES.filter(r=>r.ruleId.startsWith("VIS-"));
for (const deck of fx.decks) {
  const pages = deck.pages.map(p => ({ page: p.page, image: decodePng(readFileSync(p.png)), text: p.textItems }));
  const r = analyseDeck({ pages, rules: vr, palette: PALETTE.map(p=>p.hex) });
  console.log(deck.deckId, r.findings.map(f=>`${f.ruleId}@p${f.page} ${f.measured} bbox=${JSON.stringify(f.bbox)}`).join("\n  "));
  console.log("logo p3", findLogo(pages[2].image), "logo p6", findLogo(pages[5].image));
}
