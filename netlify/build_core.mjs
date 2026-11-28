// Netlify build step: copy the gate builder's own script out of 3d-gate-builder.html, so the payment server prices orders
// with exactly the code customers see. Runs on every deploy, so the two can never drift apart.
import {readFileSync,writeFileSync} from 'node:fs';
const html=readFileSync(new URL('../3d-gate-builder.html',import.meta.url),'utf8');
const a=html.indexOf('<script>'),b=html.indexOf('</script>',a);
if(a<0||b<0)throw new Error('no <script> in 3d-gate-builder.html');
const code=html.slice(a+8,b);
if(!code.includes('__PRICE_HOOK__'))throw new Error('3d-gate-builder.html has no __PRICE_HOOK__, so the server cannot price orders');
writeFileSync(new URL('./lib/page_script.cjs',import.meta.url),'module.exports='+JSON.stringify(code)+';\n');
// the Netlify site also shows the builder itself, so it can be checked there
import {mkdirSync} from 'node:fs';mkdirSync(new URL('./site/',import.meta.url),{recursive:true});
writeFileSync(new URL('./site/index.html',import.meta.url),html);
console.log('page script copied for the payment server:',code.length,'characters');
