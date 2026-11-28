// POST /api/gocardless-webhook — GoCardless tells us how a "Pay by bank" payment is going.
// Set up in GoCardless: Developers > Webhook endpoints > create, URL https://<site>/api/gocardless-webhook. Its secret goes in GOCARDLESS_WEBHOOK_SECRET.
// billing request fulfilled = the customer approved it in their bank; payment confirmed = the money has been collected.
import {gcSigOk,getOrder,saveOrder,updateOrder} from '../lib/pay.mjs';
export default async (req)=>{
  if(req.method!=='POST')return new Response('POST only',{status:405});
  const body=await req.text();
  if(!gcSigOk(body,req.headers.get('webhook-signature'),process.env.GOCARDLESS_WEBHOOK_SECRET))return new Response('bad signature',{status:498});
  for(const ev of (JSON.parse(body).events||[])){const L=ev.links||{};
    if(ev.resource_type==='billing_requests'){const map=L.billing_request&&await getOrder('gc-br-'+L.billing_request);if(!map)continue;
      if(ev.action==='fulfilled'){if(L.payment_request_payment)await saveOrder('gc-pay-'+L.payment_request_payment,{ref:map.ref});
        await updateOrder(map.ref,{status:'bank payment approved',gcPayment:L.payment_request_payment||null});}
      else if(['cancelled','failed'].includes(ev.action))await updateOrder(map.ref,{status:'bank payment '+ev.action});}
    else if(ev.resource_type==='payments'){const map=L.payment&&await getOrder('gc-pay-'+L.payment);if(!map)continue;
      if(['confirmed','paid_out'].includes(ev.action)){await updateOrder(map.ref,{status:'paid',paidBy:'bank',gcEvent:ev.action});console.log('paid by bank',map.ref,ev.action);
        // next step (step 7): send the order to monday, build the order pack and email the customer and the workshop
      }else if(['failed','cancelled','charged_back'].includes(ev.action))await updateOrder(map.ref,{status:'bank payment '+ev.action});}}
  return new Response('ok');
};
export const config={path:'/api/gocardless-webhook'};
