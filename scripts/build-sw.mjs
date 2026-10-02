import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";

const assets = readdirSync("apps/web/dist/assets").map((name) => `/assets/${name}`);
const shell = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  ...assets,
];
const version = createHash("sha256").update(JSON.stringify(shell)).digest("hex").slice(0, 12);
writeFileSync(
  "apps/web/dist/sw.js",
  `const CACHE='harness-${version}';const SHELL=${JSON.stringify(shell)};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const path of SHELL){const response=await fetch(path,{redirect:'error',cache:'reload'});if(!response.ok||response.redirected)throw Error('shell unavailable');await cache.put(path,response);}})()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('harness-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api')||url.pathname.startsWith('/cdn-cgi'))return;
if(SHELL.includes(url.pathname)&&!url.search){event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(cached=>cached||fetch(event.request)));return;}
if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(cache=>cache.match('/'))));});
`,
);
