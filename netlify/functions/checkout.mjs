// POST /api/checkout — the gate builder's "Pay by bank" and "Pay by card" buttons.
// 1. Reprice the gate on the server with the builder's own code (delivery from the postcode, looked up here).
// 2. Refuse if anything is unpriced, or if the price differs from the one the customer was shown.
// 3. Save the order, then open a GoCardless Instant Bank Pay page or a Stripe Checkout page for exactly that amount.
import {reprice,warm} from '../lib/pricer.mjs';
import {reply,CORS,PAGE_URL,newRef,saveOrder,stripe,stripeLive,gocardless,packCfg,chunks} from '../lib/pay.mjs';

const clean=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,n);
const pc=v=>String(v||'').replace(/\s/g,'').toUpperCase();
const gbp=v=>'£'+Number(v).toLocaleString('en-GB');
const TEL='0141 473 7656';

export default async (req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(req.method!=='POST')return reply(405,{error:'POST only'});
  const raw=await req.text();if(raw.length>40000)return reply(413,{error:'That order is too big to send.'});
  let b;try{b=JSON.parse(raw);}catch(e){return reply(400,{error:'Bad request.'});}
  if(b&&b.warm){try{await warm();}catch(e){}return reply(200,{ok:true});}   // sent when the customer opens the pay form, so the pricing is loaded by the time they pay
  const method=b.method==='bank'?'bank':b.method==='card'?'card':null;
  const cfg=b.cfg&&typeof b.cfg==='object'&&!Array.isArray(b.cfg)?b.cfg:null;
  const c=b.customer||{};
  const cust={name:clean(c.name,100),email:clean(c.email,150),phone:clean(c.phone,30),addr1:clean(c.addr1,150),addr2:clean(c.addr2,150),town:clean(c.town,80),postcode:clean(c.postcode,10).toUpperCase()};
  if(!method||!cfg||!Number.isFinite(+b.tot))return reply(400,{error:'Bad request.'});
  if(!cust.name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cust.email)||cust.phone.replace(/\D/g,'').length<10||!cust.addr1||!cust.town||pc(cust.postcode).length<5)
    return reply(400,{error:'Please fill in your name, email, phone and address.'});
  if(cfg.deliv!=='collect'&&pc(cust.postcode)!==pc(cfg.postcode))
    return reply(400,{error:'This postcode is different from the one your delivery was priced for. Please change the postcode under Delivery, so the price is right.'});

  // 1-2: the server's own price
  let P;try{P=await reprice(cfg);}catch(e){console.error('reprice failed',e.message);return reply(502,{error:`We couldn't check your price just now. Please try again, or call us on ${TEL}.`});}
  if(!P.ready){const what=P.lines.filter(([,v])=>typeof v!=='number').map(([k,v])=>`${k}: ${v}`).join('. ');
    return reply(400,{error:`Before you can pay, we need a price for everything. ${what}.`,tot:P.tot});}
  if(P.tot!==Math.round(+b.tot))return reply(409,{error:`Your price has changed to ${gbp(P.tot)} since the page loaded. Please check it and press pay again.`,tot:P.tot});
  if(!(P.tot>0))return reply(400,{error:'There is nothing to pay.'});
  const pence=Math.round(P.tot*100);

  // 3: save the order, then open the payment page
  const ref=newRef(),live=method==='card'?stripeLive():(process.env.GOCARDLESS_ACCESS_TOKEN||'').startsWith('live_');
  const summary=Array.isArray(b.summary)?b.summary.slice(0,40).map(r=>[clean(r&&r[0],60),clean(r&&r[1],240)]):[];
  const order={ref,created:new Date().toISOString(),status:'awaiting payment',method,live,tot:P.tot,lines:P.lines,discount:P.disc,sale:P.sale,
    delivery:P.deliv?{zone:P.deliv.zone,area:P.deliv.area,outcode:P.deliv.out}:null,customer:cust,summary,cfg};
  await saveOrder(ref,order);
  const back=PAGE_URL(),join=back.includes('?')?'&':'?';
  const gate=summary.slice(0,6).map(([k,v])=>`${k}: ${v}`).join('; ').slice(0,480)||'Made-to-order gate';
  try{
    if(method==='card'){
      const meta={ref,method,tot:String(P.tot),name:cust.name,phone:cust.phone,postcode:cust.postcode,discount:P.disc||'',salesperson:P.sale?P.sale.rep:''};
      chunks(packCfg(cfg),500).forEach((s,i)=>{meta['cfg_'+i]=s;});   // the gate's setup travels with the payment too
      const s=await stripe('checkout/sessions',{mode:'payment',payment_method_types:['card'],client_reference_id:ref,customer_email:cust.email,
        line_items:[{quantity:1,price_data:{currency:'gbp',unit_amount:pence,product_data:{name:`Striking Iron gate order ${ref}`,description:gate}}}],
        payment_intent_data:{description:`Striking Iron order ${ref}`,metadata:{ref}},metadata:meta,
        success_url:`${back}${join}paid=${ref}&m=card`,cancel_url:`${back}${join}unpaid=${ref}`},ref);
      await saveOrder(ref,{...order,stripe:{session:s.id}});
      return reply(200,{url:s.url,ref,tot:P.tot});}
    // Pay by bank
    const [first,...rest]=cust.name.split(/\s+/);
    const br=await gocardless('billing_requests',{billing_requests:{payment_request:{description:`Striking Iron order ${ref}`,amount:pence,currency:'GBP',metadata:{ref}},metadata:{ref}}},ref+'-br');
    const id=br.billing_requests.id;
    const fl=await gocardless('billing_request_flows',{billing_request_flows:{redirect_uri:`${back}${join}paid=${ref}&m=bank`,exit_uri:`${back}${join}unpaid=${ref}`,
      links:{billing_request:id},prefilled_customer:{given_name:first,family_name:rest.join(' ')||first,email:cust.email,address_line1:cust.addr1,address_line2:cust.addr2||undefined,city:cust.town,postal_code:cust.postcode,country_code:'GB'}}},ref+'-flow');
    await saveOrder(ref,{...order,gocardless:{billing_request:id}});await saveOrder('gc-br-'+id,{ref});
    return reply(200,{url:fl.billing_request_flows.authorisation_url,ref,tot:P.tot});
  }catch(e){console.error('payment page failed',ref,e.message);
    return reply(502,{error:`We couldn't open the payment page just now. Please try again, or call us on ${TEL}.`});}
};
export const config={path:'/api/checkout'};
