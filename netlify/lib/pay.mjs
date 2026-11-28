// Shared bits for the payment functions: replies, order references, the order store, Stripe and GoCardless calls, webhook checks.
// No packages are needed apart from @netlify/blobs: Stripe and GoCardless are called straight over HTTPS.
// Keys live only in the Netlify site's environment variables, pasted in by Jack: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// GOCARDLESS_ACCESS_TOKEN, GOCARDLESS_WEBHOOK_SECRET. PAGE_URL (optional) is where customers come back to after paying.
import crypto from 'node:crypto';

export const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
export const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...CORS}});
export const PAGE_URL=()=>process.env.PAGE_URL||'https://jacklyon-west-strikingiron.github.io/gates/3d-gate-builder.html';

// same pattern as the page's quote references: SI-YYMMDD-XXXX
export function newRef(){const d=new Date(),p=n=>String(n).padStart(2,'0'),A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r='';for(const b of crypto.randomBytes(4))r+=A[b%A.length];
  return`SI-${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}-${r}`;}

// orders kept in Netlify Blobs (store "orders", key = reference). If the store can't be reached, payments still go ahead:
// the reference, price and the gate's setup also travel with the payment itself (Stripe metadata, GoCardless metadata).
async function store(){try{const {getStore}=await import('@netlify/blobs');return getStore({name:'orders',consistency:'strong'});}catch(e){return null;}}
export async function saveOrder(ref,data){const s=await store();if(!s)return false;try{await s.setJSON(ref,data);return true;}catch(e){return false;}}
export async function getOrder(ref){const s=await store();if(!s)return null;try{return await s.get(ref,{type:'json'});}catch(e){return null;}}
export async function updateOrder(ref,change){const o=await getOrder(ref);if(!o)return null;const n={...o,...change,history:[...(o.history||[]),{at:new Date().toISOString(),...change}]};await saveOrder(ref,n);return n;}

// the gate's setup, squeezed small enough to ride along with a payment
import zlib from 'node:zlib';
export const packCfg=cfg=>zlib.deflateRawSync(JSON.stringify(cfg),{level:9}).toString('base64');
export const unpackCfg=s=>JSON.parse(zlib.inflateRawSync(Buffer.from(s,'base64')).toString('utf8'));
export const chunks=(s,n)=>{const out=[];for(let i=0;i<s.length;i+=n)out.push(s.slice(i,i+n));return out;};

// ---- Stripe (cards). Checkout Session for the exact amount, card only (Apple Pay and Google Pay come under card).
function form(obj,prefix,out=[]){for(const[k,v]of Object.entries(obj)){if(v===undefined||v===null)continue;const key=prefix?`${prefix}[${k}]`:k;
  if(typeof v==='object')form(v,key,out);else out.push(encodeURIComponent(key)+'='+encodeURIComponent(String(v)));}return out;}
export async function stripe(path,params,idem){const key=process.env.STRIPE_SECRET_KEY;if(!key)throw new Error('STRIPE_SECRET_KEY is not set');
  const r=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded',...(idem?{'Idempotency-Key':idem}:{})},body:form(params).join('&')});
  const j=await r.json();if(!r.ok)throw new Error('Stripe: '+((j.error&&j.error.message)||r.status));return j;}
export const stripeLive=()=>/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY||'');

// Stripe-Signature: t=<time>,v1=<hex HMAC-SHA256 of "t.body">; refused if more than 5 minutes old
export function stripeSigOk(body,header,secret){if(!header||!secret)return false;const parts=Object.fromEntries(header.split(',').map(x=>x.split('=')).map(([k,...v])=>[k,v.join('=')]));
  const sigs=header.split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));const t=+parts.t;if(!t||Math.abs(Date.now()/1000-t)>300)return false;
  const want=crypto.createHmac('sha256',secret).update(`${t}.${body}`).digest('hex');
  return sigs.some(s=>s.length===want.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(want)));}

// ---- GoCardless (Pay by bank: Instant Bank Pay through a Billing Request). Sandbox or live is told apart by the access token.
export async function gocardless(path,body,idem){const tok=process.env.GOCARDLESS_ACCESS_TOKEN;if(!tok)throw new Error('GOCARDLESS_ACCESS_TOKEN is not set');
  const base=tok.startsWith('live_')?'https://api.gocardless.com':'https://api-sandbox.gocardless.com';
  const r=await fetch(base+'/'+path,{method:'POST',headers:{Authorization:'Bearer '+tok,'GoCardless-Version':'2015-07-06','Content-Type':'application/json',Accept:'application/json',...(idem?{'Idempotency-Key':idem}:{})},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error('GoCardless: '+((j.error&&(j.error.message+(j.error.errors?' '+j.error.errors.map(e=>e.field+' '+e.message).join('; '):'')))||r.status));return j;}
// Webhook-Signature: hex HMAC-SHA256 of the body
export function gcSigOk(body,header,secret){if(!header||!secret)return false;const want=crypto.createHmac('sha256',secret).update(body).digest('hex');
  return header.length===want.length&&crypto.timingSafeEqual(Buffer.from(header),Buffer.from(want));}
