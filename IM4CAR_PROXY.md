# IM4Car partner API proxy

The catalog must not call `api.im4car.by` directly from browser code. The server exposes a restricted proxy at `/api/im4car/*` and keeps the upstream token in the server environment.

## Render environment variable

Create this environment variable on the Render service:

`IM4CAR_API_KEY=<NEW_IM4CAR_PARTNER_KEY>`

Do not put the key into GitHub files or Tilda JavaScript.

## Allowed endpoints

- `/api/im4car/reference`
- `/api/im4car/brands`
- `/api/im4car/listings`
- `/api/im4car/cars`

The proxy only accepts GET/OPTIONS requests and only allows browser CORS from `https://red-dragon.by` and `https://www.red-dragon.by`.

## Tilda

Change the catalog configuration to:

`API_BASE:'https://red-dragon-car-api.onrender.com/api/im4car'`

and remove `API_KEY` from the Tilda code. The existing `fetchJson()` authorization header must also be removed because the server adds the Bearer token itself.

After deployment, test:

`https://red-dragon-car-api.onrender.com/api/im4car/reference`

A successful response means the proxy is forwarding the request with the secret held server-side.