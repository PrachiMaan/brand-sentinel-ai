import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
const img = decodePng(readFileSync("demo-assets/decks/png/clean-p1.png"));
let minX=1e9,minY=1e9,maxX=0,maxY=0,count=0;
for (let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){
  const p=(y*img.width+x)*4; const r=img.data[p],g=img.data[p+1],b=img.data[p+2];
  if (r<80&&g<80&&b<80){count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
}
console.log({w:img.width,h:img.height,count,minX,minY,maxX,maxY});
console.log("corner", [...img.data.slice(0,4)]);
