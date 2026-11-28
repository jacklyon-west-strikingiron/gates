// Runs the gate builder's page script with no screen and asks it to price an order (see the __PRICE_HOOK__ block in the page).
// Only postcodes.io is reachable from inside the page; nothing else it tries to load goes anywhere.
import vm from 'node:vm';
import script from './page_script.cjs';
let HOOK=null;
function stubPage(){
  function mk(name){const f=function(){};return new Proxy(f,{get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(k==='length')return 0;
    if(k==='getContext')return()=>mk('gl');if(k==='children'||k==='childNodes')return[];if(k==='firstChild'||k==='lastChild'||k==='firstElementChild')return null;
    if(k===Symbol.iterator)return function*(){};if(k==='style'||k==='dataset')return t[k]||(t[k]={});if(k==='closest'||k==='querySelector')return()=>mk(name+'>');if(k==='querySelectorAll')return()=>[];
    if(Object.prototype.hasOwnProperty.call(t,k)&&k!=='name'&&k!=='length')return t[k];return mk(name+'.'+String(k));},
    set(t,k,v){try{t[k]=v;}catch(e){}return true;},apply(){return mk(name+'()');},construct(){return mk('new '+name);}});}
  const el=()=>mk('el');
  const document={getElementById:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],createElement:()=>el(),createElementNS:()=>el(),addEventListener(){},
    body:el(),documentElement:el(),head:el(),fonts:{ready:Promise.resolve()},visibilityState:'visible'};
  const pcFetch=(u,o)=>String(u).startsWith('https://api.postcodes.io/postcodes/')?fetch(u,{...o,signal:AbortSignal.timeout(5000)}):new Promise(()=>{});
  const ctx={console:{log(){},warn(){},error(){},info(){}},Math,JSON,Date,Promise,Float32Array,Float64Array,Uint32Array,Uint16Array,Uint8Array,Int32Array,Array,Object,Number,String,Symbol,Map,Set,WeakMap,RegExp,Error,
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    document,navigator:{userAgent:'node',clipboard:{}},location:{search:'',hash:'',href:'https://server/',hostname:'server',pathname:'/',protocol:'file:'},history:{replaceState(){}},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
    addEventListener(){},removeEventListener(){},devicePixelRatio:1,innerWidth:1280,innerHeight:800,fetch:pcFetch,performance:{now:()=>0},
    ResizeObserver:function(){return{observe(){},disconnect(){}}},IntersectionObserver:function(){return{observe(){}}},Image:function(){return el();},URL,URLSearchParams,
    Blob:function(){},FileReader:function(){return el();},FormData:function(){return el();},getComputedStyle:()=>({}),scrollTo(){},alert(){},open:()=>null,CSS:{supports:()=>false},HTMLElement:function(){},Event:function(){},DataTransfer:function(){return el();}};
  ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.top=ctx;ctx.__PRICE_HOOK__=api=>{HOOK=api;};
  vm.createContext(ctx);vm.runInContext(script,ctx,{timeout:20000});
  if(!HOOK)throw new Error('the page did not hand over its pricing');}
// price an order exactly as the page does: delivery from the postcode (looked up here, never taken from the browser), then every line
export async function reprice(cfg){
  if(!HOOK)stubPage();
  const deliv=cfg.postcode?await HOOK.delivery(cfg.postcode):null;
  return {...HOOK.price(cfg,deliv),deliv};}
// load the page's pricing without pricing anything (wakes a cold server)
export async function warm(){if(!HOOK)stubPage();}
// for tests: price with a delivery result given directly
export function priceWith(cfg,deliv){if(!HOOK)stubPage();return HOOK.price(cfg,deliv);}
