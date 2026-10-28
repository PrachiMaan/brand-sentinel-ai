import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { logoMask, resizeGray, toGray } from "../src/convex/lib/visual";
const img = decodePng(readFileSync("demo-assets/decks/png/clean-p1.png"));
const g = toGray(img);
const gray = resizeGray(g, 320, 180);
const tpl = resizeGray(logoMask(32), 18, 18);
const x = Math.round(0.06*320), y = Math.round(0.07*180);
const n = 18*18;
let s=0,sq=0;
for (let ty=0;ty<18;ty++) for (let tx=0;tx<18;tx++){ const v=gray.data[(y+ty)*320+x+tx]; s+=v; sq+=v*v; }
const mean=s/n, variance=sq-n*mean*mean;
const tMean = tpl.data.reduce((a,b)=>a+b,0)/n;
const tZero = tpl.data.map(v=>v-tMean);
const tNorm = Math.sqrt(tZero.reduce((a,b)=>a+b*b,0));
let dot=0;
for (let ty=0;ty<18;ty++) for (let tx=0;tx<18;tx++) dot += tZero[ty*18+tx]*gray.data[(y+ty)*320+x+tx];
console.log({x,y,mean,std:Math.sqrt(variance/n),tNorm,dot,ncc:dot/(Math.sqrt(variance)*tNorm)});
console.log("tpl sample", Array.from(tpl.data.slice(0,20)));
