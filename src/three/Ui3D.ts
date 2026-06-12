// Ui3D — DOM/CSS UI overlay for the Three.js 3D rewrite. Renders the HUD,
// dialogue box, list menus (pause / shop / save / options), an intro card, and
// fade transitions on top of the WebGL canvas. Pure DOM so it stays crisp at any
// resolution (the "UI to DOM" half of the rewrite).

export interface MenuItem {
  label: string;
  sub?: string;
  disabled?: boolean;
  onPick: () => void;
}

export interface DialogPage {
  speaker?: string | null;
  text: string;
  portrait?: string; // "portrait-saka" -> assets/portraits/saka.png
  // Cinematic directives (consumed by the cutscene director + cineLine).
  emote?: "shake" | "bob" | "nod" | "flash" | "rise";
  fx?: "flash" | "shake" | "rumble" | "to-black" | "from-black";
  sfx?: string;
  music?: string;
  shot?: "player" | "boss" | "ally" | "wide" | "two-shot" | [number, number];
  zoom?: number;
  hold?: number;
}

// One row of the exploration party HUD (live HP strip, top-left).
export interface PartyHudMember {
  id: string;   // character id -> assets/portraits/<id>.png
  name: string;
  level: number;
  hpCur: number;
  hpMax: number;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Spectral:wght@400;500;600&display=swap');
.u3d{position:fixed;inset:0;font-family:'Spectral',Georgia,serif;color:#ece6ff;pointer-events:none;z-index:10;
  text-shadow:0 1px 3px #05030d;}
.u3d .ser{font-family:'Cinzel',serif;letter-spacing:2px;}
/* ---- ornate panel system (gold-on-deep-violet, gem corners) ---- */
.u3d .panel{position:relative;background:linear-gradient(160deg,rgba(30,22,58,.95),rgba(14,10,30,.97));
  border:1px solid rgba(214,182,122,.75);border-radius:5px;
  box-shadow:0 10px 34px #000a, inset 0 0 0 3px rgba(26,20,60,.92), inset 0 0 26px rgba(122,104,210,.22);}
.u3d .panel::before,.u3d .panel::after{content:"\\2756";position:absolute;color:#e7c884;font-size:11px;
  text-shadow:0 0 6px rgba(231,200,132,.7);pointer-events:none;}
.u3d .panel::before{top:3px;left:6px;} .u3d .panel::after{bottom:1px;right:6px;}
.u3d .bar{position:absolute;left:0;right:0;display:flex;justify-content:space-between;padding:12px 20px;}
.u3d .top{top:0;font-size:15px;}
.u3d .loc{font-family:'Cinzel',serif;color:#efe6ff;letter-spacing:2px;font-weight:600;
  background:linear-gradient(180deg,rgba(24,18,46,.7),rgba(14,10,28,.5));padding:5px 14px;border-radius:4px;
  border:1px solid rgba(214,182,122,.35);}
.u3d .gold{font-family:'Cinzel',serif;color:#f4d58d;font-weight:700;letter-spacing:1px;
  background:linear-gradient(180deg,rgba(24,18,46,.7),rgba(14,10,28,.5));padding:5px 14px;border-radius:4px;
  border:1px solid rgba(214,182,122,.35);text-shadow:0 0 8px rgba(244,213,141,.5);}
.u3d .hint{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:12px;color:#a89dd0;letter-spacing:.5px;}
.u3d .prompt{position:absolute;bottom:70px;left:0;right:0;text-align:center;font-size:14px;color:#f4d58d;
  font-weight:600;letter-spacing:1px;text-shadow:0 0 10px rgba(244,213,141,.45);}
/* ---- dialogue ---- */
.u3d .dialog{position:absolute;left:5%;right:5%;bottom:20px;padding:16px 20px;min-height:66px;pointer-events:auto;
  display:flex;gap:16px;animation:u3dRise .28s cubic-bezier(.2,.8,.2,1);}
.u3d .dialog .por{width:68px;height:68px;image-rendering:pixelated;align-self:center;display:none;border-radius:4px;
  border:1px solid rgba(214,182,122,.6);background:#0b0820;box-shadow:0 0 12px #000a;}
.u3d .dialog .txt{flex:1;}
.u3d .dialog .sp{font-family:'Cinzel',serif;color:#f4d58d;font-weight:700;font-size:14px;letter-spacing:1px;
  margin-bottom:7px;text-shadow:0 0 8px rgba(244,213,141,.4);}
.u3d .dialog .bd{font-size:16px;line-height:1.55;color:#ece6ff;}
.u3d .titlebg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;image-rendering:pixelated;}
.u3d .dialog .nx{position:absolute;right:16px;bottom:9px;color:#f4d58d;font-size:13px;animation:u3dblink 1s infinite;}
@keyframes u3dblink{50%{opacity:.2}}
@keyframes u3dRise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:none;}}
@keyframes u3dPop{from{opacity:0;transform:translate(-50%,-50%) scale(.96);}to{opacity:1;transform:translate(-50%,-50%) scale(1);}}
/* ---- list menu ---- */
.u3d .menu{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:320px;max-width:80%;
  padding:18px 18px 14px;pointer-events:auto;animation:u3dPop .26s cubic-bezier(.2,.8,.2,1);}
.u3d .menu h3{font-family:'Cinzel',serif;margin:0 0 12px;color:#f4d58d;font-size:17px;letter-spacing:3px;text-align:center;
  text-shadow:0 0 12px rgba(244,213,141,.4);padding-bottom:10px;border-bottom:1px solid rgba(214,182,122,.3);}
.u3d .row{display:flex;justify-content:space-between;gap:18px;padding:7px 14px;font-size:15px;cursor:pointer;
  border-radius:4px;border:1px solid transparent;transition:background .12s,color .12s;}
.u3d .row .sub{color:#a89dd0;font-size:12px;align-self:center;}
.u3d .row.sel{background:linear-gradient(90deg,rgba(244,213,141,.26),rgba(244,213,141,.04));color:#ffe9b0;
  box-shadow:inset 0 0 12px rgba(244,213,141,.22);}
.u3d .row.dis{color:#6a6088;cursor:default;}
.u3d .menu .ft{margin-top:12px;padding-top:8px;text-align:center;color:#a89dd0;font-size:12px;
  border-top:1px solid rgba(214,182,122,.22);}
/* ---- intro card + fade ---- */
.u3d .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,#0a0820cc,#05030dee);opacity:0;transition:opacity .4s;}
.u3d .card .t{font-family:'Cinzel',serif;font-size:40px;font-weight:700;color:#f4ecff;letter-spacing:4px;
  text-shadow:0 0 26px rgba(160,140,255,.6),0 3px 6px #05030d;}
.u3d .card .s{font-family:'Spectral',serif;font-size:17px;color:#cdbcff;margin-top:12px;letter-spacing:2px;font-style:italic;}
.u3d .fade{position:absolute;inset:0;background:#05030d;opacity:0;transition:opacity .3s;pointer-events:none;}
/* ---- floating party / status button ---- */
.u3d .charbtn{position:absolute;right:18px;bottom:62px;width:58px;height:60px;border-radius:11px;
  pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  background:radial-gradient(circle at 38% 30%,rgba(58,44,108,.96),rgba(16,11,34,.98));
  border:1px solid rgba(214,182,122,.8);color:#f4d58d;
  box-shadow:0 6px 20px #000a, inset 0 0 14px rgba(122,104,210,.35), 0 0 14px rgba(244,213,141,.22);
  transition:transform .12s ease, box-shadow .12s ease;animation:u3dGlow 3.2s ease-in-out infinite;}
.u3d .charbtn:hover{transform:translateY(-2px) scale(1.06);
  box-shadow:0 9px 26px #000c, inset 0 0 18px rgba(160,140,255,.5), 0 0 22px rgba(244,213,141,.5);}
.u3d .charbtn .g{font-family:'Cinzel',serif;font-size:22px;line-height:1;text-shadow:0 0 10px rgba(244,213,141,.6);}
.u3d .charbtn .cap{font-family:'Cinzel',serif;font-size:8px;letter-spacing:1.5px;color:#cdbcff;}
@keyframes u3dGlow{50%{box-shadow:0 6px 20px #000a, inset 0 0 16px rgba(150,130,240,.5), 0 0 20px rgba(244,213,141,.4);}}
/* ---- on-screen touch controls (mobile) ---- */
.u3d .touch{position:absolute;inset:0;pointer-events:none;z-index:11;}
.u3d .tj{position:absolute;left:0;bottom:0;width:46%;height:58%;pointer-events:auto;touch-action:none;}
.u3d .tj-base{position:absolute;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;display:none;
  background:radial-gradient(circle,rgba(40,30,74,.34),rgba(16,11,34,.18));border:2px solid rgba(214,182,122,.5);
  box-shadow:0 0 18px rgba(122,104,210,.3), inset 0 0 18px rgba(122,104,210,.25);pointer-events:none;}
.u3d .tj-knob{position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;display:none;pointer-events:none;
  background:radial-gradient(circle at 38% 30%,rgba(244,213,141,.95),rgba(150,110,40,.92));
  border:1px solid rgba(255,236,180,.9);box-shadow:0 4px 14px #000a, 0 0 18px rgba(244,213,141,.6);}
.u3d .tb{position:absolute;width:62px;height:62px;border-radius:50%;pointer-events:auto;touch-action:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;-webkit-user-select:none;user-select:none;
  background:radial-gradient(circle at 38% 30%,rgba(58,44,108,.96),rgba(16,11,34,.98));
  border:1px solid rgba(214,182,122,.8);color:#f4d58d;font-family:'Cinzel',serif;
  box-shadow:0 6px 20px #000a, inset 0 0 14px rgba(122,104,210,.35), 0 0 14px rgba(244,213,141,.22);
  transition:transform .08s ease, box-shadow .08s ease;}
.u3d .tb:active{transform:scale(.9);box-shadow:0 3px 10px #000c, inset 0 0 20px rgba(160,140,255,.6), 0 0 22px rgba(244,213,141,.6);}
.u3d .tb-a{right:84px;bottom:62px;width:72px;height:72px;font-size:26px;font-weight:700;}
.u3d .tb-menu{right:18px;bottom:140px;font-size:24px;}
.u3d .tb-mount{right:90px;bottom:144px;font-size:11px;letter-spacing:1px;}
/* ---- character sheet (status + inline equip) ---- */
.u3d .sheet{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(540px,92vw);max-height:88vh;overflow-y:auto;padding:16px 18px 12px;pointer-events:auto;
  animation:u3dPop .26s cubic-bezier(.2,.8,.2,1);}
.u3d .sheet .tabs{display:flex;gap:8px;margin-bottom:14px;border-bottom:1px solid rgba(214,182,122,.3);padding-bottom:12px;}
.u3d .sheet .tab{flex:1;text-align:center;font-family:'Cinzel',serif;font-size:14px;letter-spacing:1px;
  padding:7px 6px;border-radius:5px;cursor:pointer;color:#b6a9dd;border:1px solid rgba(214,182,122,.25);
  background:linear-gradient(180deg,rgba(24,18,46,.5),rgba(14,10,28,.35));transition:color .12s,background .12s,border-color .12s;}
.u3d .sheet .tab:hover{color:#ece6ff;}
.u3d .sheet .tab.on{color:#15102a;font-weight:700;border-color:var(--th,#f4d58d);
  background:linear-gradient(180deg,var(--th,#f4d58d),rgba(244,213,141,.72));box-shadow:0 0 14px rgba(244,213,141,.4);}
.u3d .sheet .hd{display:flex;gap:16px;align-items:center;margin-bottom:12px;}
.u3d .sheet .por{width:88px;height:88px;image-rendering:pixelated;border-radius:6px;flex-shrink:0;
  border:1px solid rgba(214,182,122,.6);background:#0b0820;box-shadow:0 0 14px #000a;object-fit:cover;}
.u3d .sheet .id .nm{font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:#f4ecff;letter-spacing:1px;}
.u3d .sheet .id .ti{font-style:italic;color:#cdbcff;font-size:13px;margin:2px 0 6px;}
.u3d .sheet .id .cl{font-family:'Cinzel',serif;color:#f4d58d;font-size:13px;letter-spacing:1px;}
.u3d .sheet .id .af{color:#9fe0ff;font-size:12px;margin-top:3px;}
.u3d .sheet .vit{display:flex;gap:10px;margin-bottom:8px;}
.u3d .sheet .vit .st{flex:1;}
.u3d .sheet .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;}
.u3d .sheet .st{display:flex;justify-content:space-between;align-items:center;padding:6px 11px;border-radius:5px;
  background:linear-gradient(180deg,rgba(24,18,46,.6),rgba(14,10,28,.4));border:1px solid rgba(214,182,122,.2);}
.u3d .sheet .st .k{font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;color:#a89dd0;}
.u3d .sheet .st .v{font-size:16px;font-weight:600;color:#ece6ff;}
.u3d .sheet .st .slash{color:#6a6088;margin:0 1px;font-weight:400;}
.u3d .sheet .bn{font-size:11px;font-weight:700;margin-left:5px;}
.u3d .sheet .bn.up{color:#7dffb0;} .u3d .sheet .bn.dn{color:#ff8aa0;}
.u3d .sheet .seclbl{font-family:'Cinzel',serif;font-size:12px;letter-spacing:2px;color:#f4d58d;margin:8px 0 8px;
  text-align:center;border-top:1px solid rgba(214,182,122,.22);padding-top:12px;}
.u3d .sheet .slots,.u3d .sheet .picklist{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;}
.u3d .sheet .slot,.u3d .sheet .pick{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:5px;cursor:pointer;
  background:linear-gradient(90deg,rgba(30,22,58,.6),rgba(14,10,28,.4));border:1px solid rgba(214,182,122,.25);
  transition:border-color .12s,background .12s;}
.u3d .sheet .slot:hover,.u3d .sheet .pick:hover{border-color:rgba(244,213,141,.7);
  background:linear-gradient(90deg,rgba(244,213,141,.18),rgba(244,213,141,.03));}
.u3d .sheet .slot .sl-k{font-family:'Cinzel',serif;font-size:11px;letter-spacing:1px;color:#a89dd0;width:78px;flex-shrink:0;}
.u3d .sheet .slot .sl-n{flex:1;color:#ece6ff;font-size:14px;}
.u3d .sheet .slot .sl-b{color:#7dffb0;font-size:12px;}
.u3d .sheet .slot .sl-go{color:#f4d58d;font-size:13px;}
.u3d .sheet .pick.on{border-color:rgba(125,255,176,.6);}
.u3d .sheet .pick.dis{opacity:.5;cursor:default;}
.u3d .sheet .pick .pk-n{flex:1;color:#ece6ff;font-size:14px;}
.u3d .sheet .pick .pk-b{color:#7dffb0;font-size:12px;}
.u3d .sheet .bio{font-size:13px;line-height:1.6;color:#cdc4ea;font-style:italic;
  background:rgba(14,10,28,.4);border-left:2px solid rgba(214,182,122,.5);padding:9px 13px;border-radius:4px;margin-bottom:4px;}
.u3d .sheet .ft{text-align:center;color:#a89dd0;font-size:11px;border-top:1px solid rgba(214,182,122,.22);padding-top:9px;margin-top:8px;}
/* ---- party HUD strip (live HP while exploring) ---- */
.u3d .party{position:absolute;top:56px;left:20px;display:none;flex-direction:column;gap:6px;width:208px;pointer-events:none;}
.u3d .pmember{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:5px;
  background:linear-gradient(160deg,rgba(30,22,58,.86),rgba(14,10,30,.9));border:1px solid rgba(214,182,122,.5);
  box-shadow:0 5px 16px #0007, inset 0 0 14px rgba(122,104,210,.18);animation:u3dRise .3s cubic-bezier(.2,.8,.2,1);}
.u3d .pmember.down{filter:grayscale(.55) brightness(.82);border-color:rgba(224,86,63,.6);}
.u3d .pmember .pf{width:32px;height:32px;image-rendering:pixelated;border-radius:4px;flex-shrink:0;object-fit:cover;
  border:1px solid rgba(214,182,122,.55);background:#0b0820;}
.u3d .pmember .pinfo{flex:1;min-width:0;}
.u3d .pmember .prow1{display:flex;justify-content:space-between;align-items:baseline;gap:6px;}
.u3d .pmember .pn{font-family:'Cinzel',serif;font-size:12px;color:#f4ecff;letter-spacing:.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.u3d .pmember .plv{font-family:'Cinzel',serif;font-size:10px;color:#cdbcff;flex-shrink:0;text-shadow:0 0 6px rgba(160,140,255,.4);}
.u3d .pmember .hpbar{position:relative;height:11px;border-radius:6px;margin-top:4px;overflow:hidden;
  background:rgba(8,6,20,.9);border:1px solid rgba(214,182,122,.3);}
.u3d .pmember .hpfill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;transition:width .35s ease,background .35s;}
.u3d .pmember .hptxt{position:absolute;right:6px;top:0;bottom:0;display:flex;align-items:center;
  font-family:'Cinzel',serif;font-size:8px;font-weight:600;color:#fff;letter-spacing:.5px;text-shadow:0 1px 2px #000,0 0 3px #000;}
/* ---- cinematic letterbox + dialogue ---- */
.u3d .cinebars{position:absolute;inset:0;pointer-events:none;z-index:6;}
.u3d .cb{position:absolute;left:0;right:0;height:11%;background:#04030a;
  transition:transform .55s cubic-bezier(.4,0,.2,1);box-shadow:0 0 26px #000c;}
.u3d .cb-t{top:0;transform:translateY(-100%);} .u3d .cb-b{bottom:0;transform:translateY(100%);}
.u3d .cinebars.on .cb-t,.u3d .cinebars.on .cb-b{transform:translateY(0);}
.u3d .cine{position:absolute;left:6%;right:6%;bottom:13.5%;display:none;align-items:flex-end;gap:14px;
  pointer-events:auto;z-index:7;}
.u3d .cpor{width:104px;height:120px;object-fit:cover;image-rendering:pixelated;border-radius:6px;flex-shrink:0;
  border:1px solid rgba(214,182,122,.55);background:#0b0820;box-shadow:0 6px 22px #000b;display:none;
  opacity:.42;filter:grayscale(.55) brightness(.6);transform:translateY(8px);
  transition:opacity .3s ease,filter .3s ease,transform .3s ease;}
.u3d .cpor.shown{display:block;}
.u3d .cpor.on{opacity:1;filter:none;transform:translateY(0);}
.u3d .cbox{flex:1;position:relative;background:linear-gradient(160deg,rgba(30,22,58,.96),rgba(12,9,26,.98));
  border:1px solid rgba(214,182,122,.7);border-radius:6px;padding:14px 18px 18px;min-height:72px;
  box-shadow:0 10px 30px #000b, inset 0 0 0 2px rgba(26,20,60,.9), inset 0 0 22px rgba(122,104,210,.2);}
.u3d .cbox.r{text-align:right;}
.u3d .csp{font-family:'Cinzel',serif;color:#f4d58d;font-weight:700;font-size:15px;letter-spacing:1.5px;
  margin-bottom:7px;text-shadow:0 0 10px rgba(244,213,141,.5);min-height:1em;}
.u3d .cbd{font-size:17px;line-height:1.55;color:#f3edff;min-height:1.5em;}
.u3d .cnx{position:absolute;right:14px;bottom:7px;color:#f4d58d;font-size:14px;animation:u3dblink 1s infinite;}
.em-shake{animation:emShake .5s ease;} .em-bob{animation:emBob .62s ease;}
.em-nod{animation:emNod .55s ease;} .em-rise{animation:emRise .55s ease;} .em-flash{animation:emFlash .5s ease;}
@keyframes emShake{10%,90%{transform:translateX(-2px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}
@keyframes emBob{0%,100%{transform:translateY(0)}32%{transform:translateY(-10px)}64%{transform:translateY(-3px)}}
@keyframes emNod{0%,100%{transform:translateY(0)}45%{transform:translateY(6px)}}
@keyframes emRise{from{transform:translateY(14px);opacity:.35}to{transform:translateY(0);opacity:1}}
@keyframes emFlash{0%,100%{filter:none}40%{filter:brightness(2.1) drop-shadow(0 0 12px #fff6cf)}}
/* white flash + epilogue card */
.u3d .flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:8;}
.u3d .epi{position:absolute;inset:0;z-index:9;display:none;flex-direction:column;align-items:center;justify-content:center;
  gap:20px;padding:8% 12%;text-align:center;background:radial-gradient(ellipse at center,#0a0820,#04030a);
  opacity:0;transition:opacity .8s ease;pointer-events:auto;}
.u3d .epi .epi-k{font-family:'Cinzel',serif;font-size:13px;letter-spacing:5px;color:#a89dd0;}
.u3d .epi .epi-t{font-family:'Spectral',serif;font-size:23px;line-height:1.75;color:#efe7ff;font-style:italic;
  max-width:760px;text-shadow:0 2px 14px #000a;}
.u3d .epi .epi-t span{display:block;opacity:0;animation:emRise 1s ease forwards;}
.u3d .epi .epi-s{font-family:'Cinzel',serif;font-size:14px;letter-spacing:3px;color:#f4d58d;animation:u3dblink 1.8s infinite;}
.u3d .epi.on{opacity:1;}
/* ---- responsive: phones / touch ---- */
@media (max-width: 680px), (pointer: coarse) {
  .u3d .top{font-size:12px;padding:8px 12px;}
  .u3d .loc{font-size:12px;letter-spacing:1px;}
  .u3d .gold{font-size:13px;}
  .u3d .hint{display:none;}
  .u3d .dialog{left:3%;right:3%;bottom:14px;padding:12px 14px;min-height:58px;}
  .u3d .dialog .bd{font-size:15px;line-height:1.45;}
  .u3d .dialog .por{width:54px;height:54px;}
  .u3d .menu{min-width:0;width:90%;max-width:none;}
  .u3d .row{font-size:15px;padding:10px 12px;}
  .u3d .card .t{font-size:30px;letter-spacing:2px;}
  .u3d .card .s{font-size:14px;}
  .u3d .epi .epi-t{font-size:18px;line-height:1.6;}
}
`;

export class Ui3D {
  private root: HTMLDivElement;
  private locEl: HTMLDivElement;
  private goldEl: HTMLDivElement;
  private partyEl!: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private dialogEl: HTMLDivElement;
  private menuEl: HTMLDivElement;
  private sheetEl!: HTMLDivElement;
  private charBtnEl!: HTMLDivElement;
  private cardEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private sheetCancel?: () => void;
  private charBtnEnabled = false;
  private partyMembers: PartyHudMember[] = [];

  private dlgPages: DialogPage[] = [];
  private dlgIndex = 0;
  private dlgDone?: () => void;
  private dlgLock = 0;

  // ---- cinematic dialogue ----
  private barsEl!: HTMLDivElement;
  private cineEl!: HTMLDivElement;
  private cporL!: HTMLImageElement;
  private cporR!: HTMLImageElement;
  private cboxEl!: HTMLDivElement;
  private cspEl!: HTMLDivElement;
  private cbdEl!: HTMLDivElement;
  private cnxEl!: HTMLDivElement;
  private flashEl!: HTMLDivElement;
  private epiEl!: HTMLDivElement;
  private cineSides: Record<string, "l" | "r"> = {};
  private cineNextSide: "l" | "r" = "l";
  private cineResolve?: () => void;
  private cineLock = 0;
  private cineFull = "";
  private cineTyped = 0;
  private cineTyping = false;
  private cineTimer = 0;
  private epiResolve?: () => void;
  private epiLock = 0;

  private menuItems: () => MenuItem[] = () => [];
  private menuIndex = 0;
  private menuCancel?: () => void;

  onModalChange: (open: boolean) => void = () => {};
  // Fired when the player opens the floating party/status button (or presses P).
  onCharButton: () => void = () => {};
  onCharKey: () => void = () => {};

  // ---- touch controls (mobile) — wired by the scene controller to World3D ----
  onTouchMove: (x: number, z: number) => void = () => {};
  onTouchInteract: () => void = () => {};
  onTouchMenu: () => void = () => {};
  onTouchMount: () => void = () => {};
  private touchEl?: HTMLDivElement;
  private joyBase?: HTMLElement;
  private joyKnob?: HTMLElement;
  private joyId = -1;
  private joyOX = 0;
  private joyOY = 0;
  private touchEnabled = false;
  private mountAvailable = false;

  constructor(parent: HTMLElement = document.body) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el("div", "u3d");
    this.root.innerHTML = `
      <div class="bar top"><div class="loc"></div><div class="gold"></div></div>
      <div class="party"></div>
      <div class="prompt"></div>
      <div class="hint"></div>
      <div class="panel dialog" style="display:none"><img class="por"><div class="txt"><div class="sp"></div><div class="bd"></div></div><div class="nx">▼</div></div>
      <div class="panel menu" style="display:none"></div>
      <div class="panel sheet" style="display:none"></div>
      <div class="charbtn" title="Party & Equipment (P)"><span class="g">&#10070;</span><span class="cap">PARTY</span></div>
      <div class="touch" style="display:none">
        <div class="tj"><div class="tj-base"></div><div class="tj-knob"></div></div>
        <div class="tb tb-a" title="Interact">A</div>
        <div class="tb tb-menu" title="Menu">&#9776;</div>
        <div class="tb tb-mount" title="Chocobo" style="display:none">RIDE</div>
      </div>
      <div class="card"><div class="t"></div><div class="s"></div></div>
      <div class="cinebars"><div class="cb cb-t"></div><div class="cb cb-b"></div></div>
      <div class="cine"><img class="cpor cpor-l"><div class="panel cbox"><div class="csp"></div><div class="cbd"></div><div class="cnx">▼</div></div><img class="cpor cpor-r"></div>
      <div class="flash"></div>
      <div class="epi"><div class="epi-k"></div><div class="epi-t"></div><div class="epi-s">— to be continued —</div></div>
      <div class="fade"></div>`;
    parent.appendChild(this.root);

    this.locEl = this.q(".loc"); this.goldEl = this.q(".gold");
    this.partyEl = this.q(".party");
    this.hintEl = this.q(".hint"); this.promptEl = this.q(".prompt");
    this.dialogEl = this.q(".dialog"); this.menuEl = this.q(".menu");
    this.sheetEl = this.q(".sheet"); this.charBtnEl = this.q(".charbtn");
    this.cardEl = this.q(".card"); this.fadeEl = this.q(".fade");
    this.barsEl = this.q(".cinebars"); this.cineEl = this.q(".cine");
    this.cporL = this.root.querySelector(".cpor-l") as HTMLImageElement;
    this.cporR = this.root.querySelector(".cpor-r") as HTMLImageElement;
    this.cboxEl = this.q(".cbox"); this.cspEl = this.q(".csp"); this.cbdEl = this.q(".cbd"); this.cnxEl = this.q(".cnx");
    this.flashEl = this.q(".flash"); this.epiEl = this.q(".epi");

    this.dialogEl.addEventListener("pointerdown", () => this.advance());
    this.cineEl.addEventListener("pointerdown", () => this.cineAdvance());
    this.epiEl.addEventListener("pointerdown", () => this.epiAdvance());
    this.charBtnEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!this.charBtnEnabled || this.isModalOpen()) return;
      this.onCharButton();
    });
    this.refreshCharBtn();
    this.initTouch();
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private q(sel: string): HTMLDivElement { return this.root.querySelector(sel) as HTMLDivElement; }

  setVisible(v: boolean): void { this.root.style.display = v ? "block" : "none"; }

  isModalOpen(): boolean {
    return this.dialogEl.style.display !== "none" || this.menuEl.style.display !== "none" || this.sheetEl.style.display !== "none";
  }

  // Emits modal state to listeners (world lock) and updates the floating button.
  private syncModal(): void {
    this.onModalChange(this.isModalOpen());
    this.refreshCharBtn();
    this.syncTouch();
  }
  private refreshCharBtn(): void {
    this.charBtnEl.style.display = (this.charBtnEnabled && !this.isModalOpen()) ? "flex" : "none";
    this.renderPartyHud(); // party strip shares the char button's exploration/modal visibility
  }
  // Exploration scenes enable the button; title/battle disable it.
  setCharButtonEnabled(on: boolean): void {
    this.charBtnEnabled = on;
    this.refreshCharBtn();
    this.syncTouch();
  }
  isSheetOpen(): boolean { return this.sheetEl.style.display !== "none"; }

  // ---- on-screen touch controls (mobile) --------------------------------
  // Build the joystick + button wiring. The layer only appears on touch
  // devices (coarse pointer), or when forced with ?touch=1 / setTouchControls.
  private initTouch(): void {
    this.touchEl = this.q(".touch");
    this.joyBase = this.root.querySelector(".tj-base") as HTMLElement;
    this.joyKnob = this.root.querySelector(".tj-knob") as HTMLElement;
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const forced = new URLSearchParams(location.search).has("touch");
    this.touchEnabled = coarse || forced;

    const tj = this.root.querySelector(".tj") as HTMLElement;
    const R = 56;
    tj.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.joyId = e.pointerId; this.joyOX = e.clientX; this.joyOY = e.clientY;
      try { tj.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      for (const n of [this.joyBase!, this.joyKnob!]) { n.style.left = `${e.clientX}px`; n.style.top = `${e.clientY}px`; n.style.display = "block"; }
    });
    tj.addEventListener("pointermove", (e) => {
      if (this.joyId !== e.pointerId) return;
      let dx = e.clientX - this.joyOX, dy = e.clientY - this.joyOY;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joyKnob!.style.left = `${this.joyOX + dx}px`; this.joyKnob!.style.top = `${this.joyOY + dy}px`;
      this.onTouchMove(dx / R, dy / R); // up (dy<0) = forward, matches W/↑
    });
    const end = (e: PointerEvent) => { if (this.joyId === e.pointerId) this.endJoystick(); };
    tj.addEventListener("pointerup", end);
    tj.addEventListener("pointercancel", end);

    const btn = (sel: string, fn: () => void) =>
      (this.root.querySelector(sel) as HTMLElement).addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); });
    btn(".tb-a", () => this.onTouchInteract());
    btn(".tb-menu", () => this.onTouchMenu());
    btn(".tb-mount", () => this.onTouchMount());
    this.syncTouch();
  }
  private endJoystick(): void {
    this.joyId = -1;
    if (this.joyBase) this.joyBase.style.display = "none";
    if (this.joyKnob) this.joyKnob.style.display = "none";
    this.onTouchMove(0, 0);
  }
  // Controls show only during free exploration (same gate as the PARTY button):
  // hidden in battle, dialogs, menus, sheets, cutscenes, and the title screen.
  private syncTouch(): void {
    if (!this.touchEl) return;
    // Use computed display: the cine/epi panels are hidden via CSS (inline style
    // is "" until a cutscene runs), so an inline-style check would misread them.
    const shown = (e: HTMLElement) => getComputedStyle(e).display !== "none";
    const overlay = this.isModalOpen() || shown(this.cineEl) || shown(this.epiEl);
    const show = this.touchEnabled && this.charBtnEnabled && !overlay;
    this.touchEl.style.display = show ? "block" : "none";
    (this.root.querySelector(".tb-mount") as HTMLElement).style.display = this.mountAvailable ? "flex" : "none";
    if (!show) this.endJoystick();
  }
  // Force the touch layer on/off (e.g. an options toggle); auto-detected otherwise.
  setTouchControls(on: boolean): void { this.touchEnabled = on; this.syncTouch(); }
  // Show/hide the chocobo button as mounting becomes available per scene.
  setMountButton(on: boolean): void { this.mountAvailable = on; this.syncTouch(); }

  // ---- HUD --------------------------------------------------------------
  setLocation(t: string): void { this.locEl.textContent = t; }
  setGold(n: number): void { this.goldEl.textContent = `◆ ${n}`; }
  setHint(t: string): void { this.hintEl.textContent = t; }
  setPrompt(label: string | null): void {
    this.promptEl.textContent = label ? `[E] ${label}` : "";
  }
  // Live party HP strip (top-left). Pass the current roster; visibility follows
  // the floating party button (exploration scenes only, hidden behind modals).
  setPartyHud(members: PartyHudMember[]): void {
    this.partyMembers = members;
    this.renderPartyHud();
  }
  private renderPartyHud(): void {
    const show = this.partyMembers.length > 0 && this.charBtnEnabled && !this.isModalOpen();
    this.partyEl.style.display = show ? "flex" : "none";
    if (!show) return;
    this.partyEl.innerHTML = this.partyMembers.map((m) => {
      const ratio = m.hpMax > 0 ? Math.max(0, Math.min(1, m.hpCur / m.hpMax)) : 0;
      const down = m.hpCur <= 0;
      const fill = down
        ? "linear-gradient(90deg,#5a2030,#7a2a3a)"
        : ratio > 0.5 ? "linear-gradient(90deg,#3fe08a,#7dffb0)"
        : ratio > 0.25 ? "linear-gradient(90deg,#e8b54a,#f4d58d)"
        : "linear-gradient(90deg,#e0563f,#ff8a6a)";
      return `<div class="pmember${down ? " down" : ""}">
        <img class="pf" src="assets/portraits/${m.id}.png" alt="">
        <div class="pinfo">
          <div class="prow1"><span class="pn">${m.name}</span><span class="plv">Lv ${m.level}</span></div>
          <div class="hpbar"><div class="hpfill" style="width:${Math.round(ratio * 100)}%;background:${fill}"></div><span class="hptxt">${down ? "DOWN" : `${m.hpCur} / ${m.hpMax}`}</span></div>
        </div>
      </div>`;
    }).join("");
  }

  // ---- dialogue ---------------------------------------------------------
  showDialog(pages: DialogPage[], onDone?: () => void): void {
    this.dlgPages = pages.length ? pages : [{ text: "" }];
    this.dlgIndex = 0; this.dlgDone = onDone;
    this.dialogEl.style.display = "block";
    this.dlgLock = performance.now() + 140;
    this.renderDialog();
    this.syncModal();
  }
  private renderDialog(): void {
    const p = this.dlgPages[this.dlgIndex];
    (this.q(".dialog .sp")).textContent = p.speaker ?? "";
    (this.q(".dialog .sp")).style.display = p.speaker ? "block" : "none";
    (this.q(".dialog .bd")).textContent = p.text;
    const por = this.root.querySelector(".dialog .por") as HTMLImageElement;
    if (p.portrait) { por.src = `assets/portraits/${p.portrait.replace("portrait-", "")}.png`; por.style.display = "block"; }
    else por.style.display = "none";
  }

  // ---- title background -------------------------------------------------
  private titleBgEl?: HTMLImageElement;
  showTitleBg(url: string): void {
    if (!this.titleBgEl) { this.titleBgEl = document.createElement("img"); this.titleBgEl.className = "titlebg"; this.root.insertBefore(this.titleBgEl, this.root.firstChild); }
    this.titleBgEl.src = url;
    this.titleBgEl.style.display = "block";
  }
  hideTitleBg(): void { if (this.titleBgEl) this.titleBgEl.style.display = "none"; }
  private advance(): void {
    if (this.dialogEl.style.display === "none" || performance.now() < this.dlgLock) return;
    this.dlgIndex += 1;
    if (this.dlgIndex >= this.dlgPages.length) {
      this.dialogEl.style.display = "none";
      const cb = this.dlgDone; this.dlgDone = undefined;
      this.syncModal();
      cb?.();
      return;
    }
    this.dlgLock = performance.now() + 120;
    this.renderDialog();
  }

  // ---- list menu --------------------------------------------------------
  openMenu(title: string, items: () => MenuItem[], onCancel?: () => void): void {
    this.menuItems = items; this.menuIndex = 0; this.menuCancel = onCancel;
    this.menuEl.style.display = "block";
    this.renderMenu(title);
    this.syncModal();
  }
  private currentTitle = "";
  private renderMenu(title?: string): void {
    if (title !== undefined) this.currentTitle = title;
    const items = this.menuItems();
    if (this.menuIndex >= items.length) this.menuIndex = Math.max(0, items.length - 1);
    const rows = items.map((it, i) =>
      `<div class="row ${i === this.menuIndex ? "sel" : ""} ${it.disabled ? "dis" : ""}" data-i="${i}">
        <span>${i === this.menuIndex ? "◈ " : "   " }${it.label}</span>${it.sub ? `<span class="sub">${it.sub}</span>` : ""}</div>`).join("");
    this.menuEl.innerHTML = `<h3>${this.currentTitle}</h3>${rows}<div class="ft">↑↓ select · [Enter] choose · [Esc] back</div>`;
    this.menuEl.querySelectorAll(".row").forEach((r) => {
      const i = Number((r as HTMLElement).dataset.i);
      r.addEventListener("pointerenter", () => { this.menuIndex = i; this.renderMenu(); });
      r.addEventListener("pointerdown", () => { this.menuIndex = i; this.pickMenu(); });
    });
  }
  private pickMenu(): void {
    const items = this.menuItems();
    const it = items[this.menuIndex];
    if (!it || it.disabled) return;
    it.onPick();
    if (this.menuEl.style.display !== "none") this.renderMenu(); // refresh if still open
  }
  closeMenu(): void {
    this.menuEl.style.display = "none";
    this.syncModal();
  }

  // ---- character sheet (rich custom panel; content owned by the caller) -
  openSheet(html: string, wire?: (root: HTMLElement) => void, onCancel?: () => void): void {
    this.sheetEl.innerHTML = html;
    this.sheetEl.style.display = "block";
    this.sheetEl.scrollTop = 0;
    this.sheetCancel = onCancel;
    wire?.(this.sheetEl);
    this.syncModal();
  }
  // Re-render the open sheet in place (hero switch / after an equip change).
  updateSheet(html: string, wire?: (root: HTMLElement) => void, onCancel?: () => void): void {
    if (this.sheetEl.style.display === "none") return;
    this.sheetEl.innerHTML = html;
    if (onCancel !== undefined) this.sheetCancel = onCancel;
    wire?.(this.sheetEl);
  }
  closeSheet(): void {
    this.sheetEl.style.display = "none";
    this.sheetEl.innerHTML = "";
    this.sheetCancel = undefined;
    this.syncModal();
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (this.epiEl.style.display !== "none") {
      if (k === "enter" || k === " " || k === "e") { this.epiAdvance(); e.preventDefault(); }
      return;
    }
    if (this.cineEl.style.display !== "none") {
      if (k === "enter" || k === " " || k === "e") { this.cineAdvance(); e.preventDefault(); }
      return;
    }
    if (this.sheetEl.style.display !== "none") {
      if (k === "escape" || k === "x" || k === "m" || k === "p") { this.sheetCancel?.(); e.preventDefault(); }
      return;
    }
    if (this.menuEl.style.display !== "none") {
      const items = this.menuItems();
      if (k === "arrowup" || k === "w") { this.menuIndex = (this.menuIndex - 1 + items.length) % items.length; this.renderMenu(); }
      else if (k === "arrowdown" || k === "s") { this.menuIndex = (this.menuIndex + 1) % items.length; this.renderMenu(); }
      else if (k === "enter" || k === " ") this.pickMenu();
      else if (k === "escape" || k === "x" || k === "m") { const c = this.menuCancel; this.closeMenu(); c?.(); }
      e.preventDefault();
      return;
    }
    if (this.dialogEl.style.display !== "none") {
      if (k === "enter" || k === " " || k === "e") { this.advance(); e.preventDefault(); }
      return;
    }
    // exploration shortcut: open the party / status sheet
    if (k === "p" && this.charBtnEnabled) { this.onCharKey(); e.preventDefault(); }
  }

  // ---- cinematic cutscene presentation ---------------------------------
  // Slides the letterbox bars in/out — the cinematic "frame" held for a whole scene.
  setLetterbox(on: boolean): void { this.barsEl.classList.toggle("on", on); }

  // Shows one cinematic line with a typewriter reveal, the speaker's portrait
  // slid in + lit (the other speaker dimmed), and an optional emote beat.
  // Resolves when the player advances (Enter/Space/E/click).
  cineLine(page: DialogPage): Promise<void> {
    this.cineEl.style.display = "flex";
    this.syncTouch();
    const side = this.applyCineSpeaker(page);
    this.cnxEl.style.display = "none";
    this.cineLock = performance.now() + 130;
    if (page.emote) this.playEmote(page.emote, side);
    return new Promise<void>((res) => { this.cineResolve = res; this.startType(page.text); });
  }

  // Tears down the cinematic dialogue (call once at scene end).
  hideCine(): void {
    if (this.cineTimer) { clearInterval(this.cineTimer); this.cineTimer = 0; }
    this.cineTyping = false;
    this.cineEl.style.display = "none";
    this.cporL.className = "cpor cpor-l"; this.cporL.removeAttribute("src");
    this.cporR.className = "cpor cpor-r"; this.cporR.removeAttribute("src");
    this.cboxEl.classList.remove("r");
    this.cspEl.textContent = ""; this.cbdEl.textContent = "";
    this.cineSides = {}; this.cineNextSide = "l";
    this.cineResolve = undefined;
    this.syncTouch();
  }

  // Assigns the speaker a stable left/right slot, lights it, dims the other.
  // Faceless voices (bosses / unnamed narration) show the name with no portrait.
  private applyCineSpeaker(page: DialogPage): "l" | "r" | null {
    const name = page.speaker ?? null;
    this.cspEl.textContent = name ?? "";
    this.cspEl.style.display = name ? "block" : "none";
    if (name && page.portrait) {
      let side = this.cineSides[name];
      if (!side) { side = this.cineNextSide; this.cineSides[name] = side; this.cineNextSide = side === "l" ? "r" : "l"; }
      const url = `assets/portraits/${page.portrait.replace("portrait-", "")}.png`;
      const active = side === "l" ? this.cporL : this.cporR;
      const other = side === "l" ? this.cporR : this.cporL;
      if (active.getAttribute("src") !== url) active.src = url;
      active.classList.add("shown", "on");
      other.classList.remove("on");
      this.cboxEl.classList.toggle("r", side === "r");
      return side;
    }
    this.cporL.classList.remove("on");
    this.cporR.classList.remove("on");
    this.cboxEl.classList.remove("r");
    return null;
  }

  private startType(text: string): void {
    this.cineFull = text; this.cineTyped = 0; this.cineTyping = true;
    this.cbdEl.textContent = "";
    if (this.cineTimer) { clearInterval(this.cineTimer); this.cineTimer = 0; }
    if (!text) { this.finishType(); return; }
    this.cineTimer = window.setInterval(() => {
      this.cineTyped++;
      this.cbdEl.textContent = this.cineFull.slice(0, this.cineTyped);
      if (this.cineTyped >= this.cineFull.length) this.finishType();
    }, 22);
  }
  private finishType(): void {
    if (this.cineTimer) { clearInterval(this.cineTimer); this.cineTimer = 0; }
    this.cineTyping = false;
    this.cbdEl.textContent = this.cineFull;
    this.cnxEl.style.display = "block";
  }
  private cineAdvance(): void {
    if (this.cineEl.style.display === "none" || performance.now() < this.cineLock) return;
    if (this.cineTyping) { this.finishType(); this.cineLock = performance.now() + 110; return; }
    const res = this.cineResolve; this.cineResolve = undefined; res?.();
  }
  private playEmote(kind: string, side: "l" | "r" | null): void {
    const target: HTMLElement = side === "l" ? this.cporL : side === "r" ? this.cporR : this.cboxEl;
    const cls = `em-${kind}`;
    target.classList.remove(cls); void target.offsetWidth; target.classList.add(cls);
    window.setTimeout(() => target.classList.remove(cls), 720);
  }

  // A brief white screen flash (impact / revelation beat).
  flashScreen(): void {
    this.flashEl.style.transition = "none";
    this.flashEl.style.opacity = "0.82";
    void this.flashEl.offsetWidth;
    this.flashEl.style.transition = "opacity .42s ease-out";
    this.flashEl.style.opacity = "0";
  }

  // The reflective "to be continued" epilogue card shown after a chapter outro.
  // Reveals each line in turn and resolves when the player advances.
  showEpilogue(chapterLabel: string, lines: string[]): Promise<void> {
    (this.q(".epi-k")).textContent = chapterLabel;
    (this.q(".epi-t")).innerHTML = lines
      .map((l, i) => `<span style="animation-delay:${(0.2 + i * 0.9).toFixed(2)}s">${escapeHtml(l)}</span>`)
      .join("");
    this.epiEl.style.display = "flex";
    void this.epiEl.offsetWidth;
    this.epiEl.classList.add("on");
    this.syncTouch();
    this.epiLock = performance.now() + 800 + lines.length * 320;
    return new Promise<void>((res) => { this.epiResolve = res; });
  }
  private epiAdvance(): void {
    if (this.epiEl.style.display === "none" || performance.now() < this.epiLock) return;
    const res = this.epiResolve; this.epiResolve = undefined;
    this.epiEl.classList.remove("on");
    window.setTimeout(() => { this.epiEl.style.display = "none"; this.syncTouch(); res?.(); }, 800);
  }

  // ---- card + fade ------------------------------------------------------
  showCard(title: string, subtitle: string, ms = 1500): void {
    (this.q(".card .t")).textContent = title;
    (this.q(".card .s")).textContent = subtitle;
    this.cardEl.style.opacity = "1";
    setTimeout(() => { this.cardEl.style.opacity = "0"; }, ms);
  }
  fadeOut(cb?: () => void): void { this.fadeEl.style.opacity = "1"; setTimeout(() => cb?.(), 300); }
  fadeIn(): void { this.fadeEl.style.opacity = "0"; }
}

function el(tag: string, cls: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
