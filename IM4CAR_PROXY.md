# IM4Car partner API proxy

Catalog browser code must not call `api.im4car.by` directly. The Cloudflare Worker exposes `/api/im4car/*` and keeps the upstream token in the Worker Secret `IM4CAR_API_KEY`.

## Cloudflare Secret

In the Cloudflare Worker `red-dragon-car-api` create a secret:

`IM4CAR_API_KEY=<NEW_IM4CAR_PARTNER_KEY>`

Do not put the key into GitHub files, `wrangler.json`, or Tilda JavaScript.

## Allowed endpoints

- `/api/im4car/reference`
- `/api/im4car/brands`
- `/api/im4car/listings`
- `/api/im4car/cars`

The proxy accepts only GET/OPTIONS and allows browser CORS only from `https://red-dragon.by` and `https://www.red-dragon.by`.

## Tilda

Use the Worker URL as `API_BASE`, for example:

`API_BASE:'https://red-dragon-car-api.<YOUR_SUBDOMAIN>.workers.dev/api/im4car'`

Remove `API_KEY` from the Tilda code and remove the browser `Authorization: Bearer ...` header. The Worker adds the Bearer token server-side.

## Deploy

Deploy the existing `worker.js` with Wrangler. The repository already contains `wrangler.json` and the KV binding used by the existing Worker routes.

Set the secret before testing. Then open `/api/im4car/reference`; the response must come from IM4Car while the token remains server-side.