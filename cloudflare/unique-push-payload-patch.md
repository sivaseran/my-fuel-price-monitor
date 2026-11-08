# Cloudflare Worker: unique encrypted payload per push

This Worker is edited **in the Cloudflare dashboard**, not deployed from GitHub.
Make a backup of the current working Worker before changing it. Keep the
already-deployed station-matching fix.

## 1. Replace the complete `sendEmptyWebPush(env,endpoint)` function

Replace that function (up to, but not including, `function pushProvider`) with:

```javascript
// A separate encrypted payload prevents /push/latest overwriting an earlier alert.
function decodeBase64Url(value){
  const base64=value.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(base64+'='.repeat((4-base64.length%4)%4));
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
function concatBytes(...arrays){
  const bytes=arrays.map(value=>new Uint8Array(value));
  const output=new Uint8Array(bytes.reduce((sum,value)=>sum+value.length,0));
  let offset=0;
  for(const value of bytes){output.set(value,offset);offset+=value.length;}
  return output;
}
async function hmacSha256(keyBytes,bytes){
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes));
}
async function hkdfExpand(prk,info,length){
  return (await hmacSha256(prk,concatBytes(info,Uint8Array.of(1)))).slice(0,length);
}
async function encryptWebPushAlert(subscription,alert){
  const keys=subscription?.keys;
  if(!keys?.p256dh||!keys?.auth)throw new Error('Subscription encryption keys are missing. Re-enable notifications on this device.');
  const uaPublic=decodeBase64Url(keys.p256dh);
  const auth=decodeBase64Url(keys.auth);
  if(uaPublic.length!==65||auth.length!==16)throw new Error('Invalid Web Push subscription encryption keys.');
  const asKeys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const asPublic=new Uint8Array(await crypto.subtle.exportKey('raw',asKeys.publicKey));
  const uaKey=await crypto.subtle.importKey('raw',uaPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},asKeys.privateKey,256));
  const ikm=await hkdfExpand(await hmacSha256(auth,shared),
    concatBytes(encoder.encode('WebPush: info\0'),uaPublic,asPublic),32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const prk=await hmacSha256(salt,ikm);
  const cek=await hkdfExpand(prk,encoder.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdfExpand(prk,encoder.encode('Content-Encoding: nonce\0'),12);
  const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const plain=concatBytes(encoder.encode(JSON.stringify({alert})),Uint8Array.of(2));
  const recordSize=4096;
  if(plain.length+16>recordSize)throw new Error('Push alert payload exceeds the Web Push record size.');
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,plain);
  const header=new Uint8Array(21);
  header.set(salt,0);
  new DataView(header.buffer).setUint32(16,recordSize,false);
  header[20]=asPublic.length;
  return concatBytes(header,asPublic,encrypted);
}
async function sendWebPushAlert(env,subscription,alert){
  if(!pushConfigured(env))return{ok:false,status:0,error:'VAPID not configured'};
  const endpoint=subscription?.endpoint;
  if(!endpoint)throw new Error('Missing push endpoint.');
  const payload=await encryptWebPushAlert(subscription,alert);
  const jwt=await createVapidJwt(env,endpoint);
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      TTL:'120',
      Urgency:'normal',
      'Content-Encoding':'aes128gcm',
      'Content-Type':'application/octet-stream',
      Authorization:`vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
    },
    body:payload
  });
  return{ok:response.ok,status:response.status};
}
```

## 2. In `notifyPrioritySubscriptions`

Find:

```javascript
const sent=await sendEmptyWebPush(env,record.endpoint);
```

Replace with:

```javascript
const sent=await sendWebPushAlert(env,record.subscription,alert);
```

## 3. In `runPushTest`

Add a unique ID to the `record.latestAlert` object:

```javascript
record.latestAlert={
  id:crypto.randomUUID(),
  title:'Fuel Price Monitor',
  body:'Test notification successful.',
  createdAt:new Date().toISOString(),
  test:true
};
```

Find its other call to `sendEmptyWebPush`, and replace it with:

```javascript
const result=await sendWebPushAlert(env,record.subscription,record.latestAlert);
```

You may also add `record.latestAlert.id` to `record.recentAlertIds` before
saving the record, to keep test-alert acknowledgements.

## 4. Deploy and verify

1. Confirm GitHub Pages has deployed PR #6 (service worker reads encrypted payloads).
2. Deploy this Worker patch in Cloudflare.
3. Reopen the installed PWA on both receiving phones **once** to activate the updated service worker.
4. Send two simulations to both devices, e.g. E10 139.9→137.9, then 137.9→136.9.
5. Check two distinct notifications on each phone and open each. Both must show
   their original price change, including when opened in reverse order.
6. In Admin, expand each entry in **Simulation history** and refresh its delivery report.

Notes: Simulation reports already live in Cloudflare KV for 24 hours. The Admin
history list is stored on the testing phone, not synced across devices. Push
service acceptance is not proof of delivery. Keep the existing `/push/latest`
endpoint for older service workers during migration.
