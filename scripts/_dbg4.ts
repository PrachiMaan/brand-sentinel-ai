import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { logoMask, resizeGray, toGray } from "../src/convex/lib/visual";
const img = decodePng(readFileSync("demo-assets/decks/png/clean-p1.png"));
const gray = resizeGray(toGray(img), 320, 180);
for (const size of [14,15,16,17,18,19,20,21,22,23,24,26]) {
  const tpl = resizeGray(logoMask(32), size, size);
  const n=size*size;
  const tMean=tpl.data.reduce((a,b)=>a+b,0)/n;
  const tz=tpl.data.map(v=>v-tMean); const tn=Math.sqrt(tz.reduce((a,b)=>a+b*b,0));
  let best={s:-2,x:0,y:0};
  for(let y=8;y<30;y++) for(let x=8;x<40;x++){
    let s=0,sq=0; for(let ty=0;ty<size;ty++) for(let tx=0;tx<size;tx++){const v=gray.data[(y+ty)*320+x+tx]; s+=v; sq+=v*v;}
    const m=s/n; const varr=sq-n*m*m; if(varr/n<0.01) continue;
    let dot=0; for(let ty=0;ty<size;ty++) for(let tx=0;tx<size;tx++) dot+=tz[ty*size+tx]*gray.data[(y+ty)*320+x+tx];
    const sc=dot/(Math.sqrt(varr)*tn+1e-9);
    if(sc>best.s) best={s:sc,x,y};
  }
  console.log(size, best.s.toFixed(3), best.x, best.y);
}
