import { readFileSync } from "node:fs";
import { decodePng } from "./lib/raster.mjs";
import { resizeGray, toGray, scanLogo } from "../src/convex/lib/visual";
const img = decodePng(readFileSync("demo-assets/decks/png/clean-p1.png"));
const gray = resizeGray(toGray(img), 320, 180);
const at=(x:number,y:number)=>gray.data[y*320+x].toFixed(2);
console.log("logo region rows");
for (let y=8;y<34;y++){let row="";for(let x=15;x<42;x++){row+=gray.data[y*320+x]>0.6?".":"#"};console.log(y, row)}
console.log(scanLogo(img));
console.log("samples", at(19,20), at(17,20), at(36,20), at(38,20), at(27,12), at(27,10), at(27,29), at(27,31));
