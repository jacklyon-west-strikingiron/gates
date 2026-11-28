// POST /api/stripe-webhook — Stripe tells us when a card payment has gone through (or the payment page timed out).
// Set up in Stripe: Developers > Webhooks > add endpoint https://<site>/api/stripe-webhook, events checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.expired. Its signing secret goes in STRIPE_WEBHOOK_SECRET.
import {stripeSigOk,getOrder,saveOrder,updateOrder,unpackCfg} from '../lib/pay.mjs';
export default async (req)=>{
  if(req.method!=='POST')return new Response('POST only',{status:405});
  const body=await req.text();
  if(!stripeSigOk(body,req.headers.get('stripe-signature'),process.env.STRIPE_WEBHOOK_SECRET))return new Response('bad signature',{status:400});
  const ev=JSON.parse(body),s=ev.data&&ev.data.object||{},m=s.metadata||{},ref=m.ref||s.client_reference_id;
  if(!ref)return new Response('ok');
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(ev.type)&&s.payment_status==='paid'){
    let o=await getOrder(ref);
    if(!o){   // the order store missed it: rebuild the order from what travelled with the payment
      let cfg=null;try{const k=Object.keys(m).filter(k=>/^cfg_\d+$/.test(k)).sort((a,b)=>+a.slice(4)-+b.slice(4));cfg=unpackCfg(k.map(x=>m[x]).join(''));}catch(e){}
      await saveOrder(ref,{ref,created:new Date().toISOString(),method:'card',tot:+m.tot,customer:{name:m.name,email:s.customer_details&&s.customer_details.email,phone:m.phone,postcode:m.postcode},discount:m.discount,cfg,rebuiltFromStripe:true});}
    await updateOrder(ref,{status:'paid',paidBy:'card',paid:(s.amount_total||0)/100,stripePayment:s.payment_intent,live:!!ev.livemode});
    console.log('paid by card',ref);
    // next step (step 7): send the order to monday, build the order pack and email the customer and the workshop
  }else if(ev.type==='checkout.session.expired'){await updateOrder(ref,{status:'payment page expired'});}
  return new Response('ok');
};
export const config={path:'/api/stripe-webhook'};
