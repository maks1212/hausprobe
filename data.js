/* Stammdaten: Produkte, Formate und Farben aus öffentlichen PREFA Unterlagen.
   Quellen: Farbsortiment 2026 (Farbnummern, RAL-Näherungen, Verfügbarkeit je Produktgruppe),
   Farbkarte 2022 (deutsche Farbnamen), Planungsleitfaden Dach und Ausschreibungstext Fassade (Formate).
   Die hex-Werte sind Bildschirm-Näherungen der angegebenen RAL-Töne und stammen nicht von PREFA.
   Nicht enthalten: Holzdekore (38, 39, 40), Naturblank (13), PREFABOND, Strangpressprofile, Raute klein. */
(function(root){
"use strict";
var colors={
  "01":{name:"P.10 Braun",ral:"7013",hex:"#575044"},
  "02":{name:"P.10 Anthrazit",ral:"7016",hex:"#383e42"},
  "03":{name:"P.10 Schwarz",ral:"9005",hex:"#111214"},
  "04":{name:"P.10 Ziegelrot",ral:"8004",hex:"#8d4931"},
  "05":{name:"P.10 Oxydrot",ral:"3009",hex:"#6d342d"},
  "06":{name:"P.10 Moosgrün",ral:"6005",hex:"#114232"},
  "07":{name:"P.10 Hellgrau",ral:"7005",hex:"#6c6e6b"},
  "08":{name:"P.10 Zinkgrau",ral:"7030",hex:"#939388"},
  "10":{name:"P.10 Prefaweiß",ral:"9002",hex:"#d7d5cb"},
  "11":{name:"P.10 Nussbraun",ral:"8019",hex:"#3d3635"},
  "12":{name:"Silbermetallic",ral:"9006",hex:"#a1a1a0"},
  "17":{name:"P.10 Reinweiß",ral:"9010",hex:"#f1ece1"},
  "19":{name:"P.10 Dunkelgrau",ral:"7043",hex:"#4f5250"},
  "20":{name:"Rauchsilber",ral:"9007",hex:"#878581"},
  "23":{name:"Schwarzgrau",ral:"7022",hex:"#4c4a44"},
  "28":{name:"P.10 Prefa Bronze",ral:"7048",hex:"#7f7b73"},
  "42":{name:"P.10 Sandbraun",ral:"1019",hex:"#a48f7a"},
  "43":{name:"P.10 Steingrau",ral:"7031",hex:"#5d6970"},
  "45":{name:"Bronze",ral:"7048",hex:"#7f7b73"},
  "46":{name:"P.10 Patinagrün",ral:"6027",hex:"#7ebab5"},
  "47":{name:"Patinagrau",ral:"7042",hex:"#8e9291"}
};
var palettes={
  dachKlein:["02","01","03","04","05","06","07","11","19","28","43"],
  prefalz:["02","01","03","04","05","06","07","08","10","11","12","17","19","23","28","43","45","46","47"],
  fassadeKlein:["02","01","03","04","05","06","07","10","11","12","19","28","43"],
  siding:["02","01","03","04","05","06","07","10","11","12","17","19","20","23","28","42","43","45","47"]
};
/* pat: seam = Falze von First zu Traufe, offset = versetzte Platten, raute = Spitzdeckung, hline = waagrechte Bahnen.
   w/h: Format in mm; cell: Rastermaß in mm in Zählrichtung (bei Rauten die Diagonale). */
var products=[
  {id:"prefalz",kind:"dach",name:"PREFALZ",pat:"seam",w:430,cell:430,pal:"prefalz",info:"Band 500 mm, Falzabstand 430 mm"},
  {id:"dachplatte",kind:"dach",name:"Dachplatte",pat:"offset",w:600,h:420,cell:600,pal:"dachKlein",info:"600 × 420 mm"},
  {id:"r16",kind:"dach",name:"Dachplatte R.16",pat:"offset",w:700,h:420,cell:700,pal:"dachKlein",info:"700 × 420 mm"},
  {id:"schindel",kind:"dach",name:"Dachschindel",pat:"offset",w:420,h:240,cell:420,pal:"dachKlein",info:"420 × 240 mm"},
  {id:"ds19",kind:"dach",name:"Dachschindel DS.19",pat:"offset",w:480,h:262,cell:480,pal:"dachKlein",info:"480 × 262 mm"},
  {id:"fx12",smooth:true,kind:"dach",name:"Dachpaneel FX.12",pat:"offset",w:1400,h:420,cell:1400,shift:.37,pal:"dachKlein",info:"1.400 × 420 und 700 × 420 mm"},
  {id:"raute29",kind:"dach",name:"Dachraute 29 × 29",pat:"raute",w:290,cell:410,pal:"dachKlein",info:"290 × 290 mm"},
  {id:"raute44",kind:"dach",name:"Dachraute 44 × 44",pat:"raute",w:437,cell:618,pal:"dachKlein",info:"437 × 437 mm"},
  {id:"siding",kind:"fassade",name:"Siding",pat:"hline",w:200,cell:200,pal:"siding",info:"Baubreite 200 mm (auch 138 bis 600 mm)"},
  {id:"sidingx",smooth:true,kind:"fassade",name:"Siding.X",pat:"hline",w:260,cell:260,mix:[200,138,300,138,400,200,300],pal:"siding",info:"Baubreiten 138, 200, 300, 400 mm gemischt"},
  {id:"wandschindel",kind:"fassade",name:"Wandschindel",pat:"offset",w:420,h:240,cell:420,pal:"fassadeKlein",info:"420 × 240 mm"},
  {id:"fx12f",smooth:true,kind:"fassade",name:"Fassadenpaneel FX.12",pat:"offset",w:1400,h:420,cell:1400,shift:.37,pal:"fassadeKlein",info:"1.400 × 420 und 700 × 420 mm"},
  {id:"wandraute20",kind:"fassade",name:"Wandraute 20 × 20",pat:"raute",w:200,cell:283,pal:"fassadeKlein",info:"200 × 200 mm"},
  {id:"wandraute29",kind:"fassade",name:"Wandraute 29 × 29",pat:"raute",w:290,cell:410,pal:"fassadeKlein",info:"290 × 290 mm"},
  {id:"wandraute44",kind:"fassade",name:"Wandraute 44 × 44",pat:"raute",w:437,cell:618,pal:"fassadeKlein",info:"437 × 437 mm"},
  {id:"prefalzf",kind:"fassade",name:"PREFALZ Fassade",pat:"seam",w:430,cell:430,pal:"prefalz",info:"Band 500 mm, Falzabstand 430 mm"}
];
var byId={};products.forEach(function(p){byId[p.id]=p;});
var api={colors:colors,palettes:palettes,products:products,byId:byId};
if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.HausData=api;
})(typeof window!=="undefined"?window:this);
