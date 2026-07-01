// Reverse-proxies /api/* to the Fly API so browser requests are same-origin.
// Cookie-based auth relies on this: cross-site cookies (nashishei.pages.dev
// calling api-black-silence-6888.fly.dev directly) get blocked by Safari's
// Intelligent Tracking Prevention and Brave's Shields even with
// SameSite=None; Secure set correctly — both treat the API domain as a
// third-party tracker. Proxying through the same origin sidesteps that
// class of restriction entirely instead of trying to convince every browser
// to allow the cross-site cookie.
const API_ORIGIN = 'https://api-black-silence-6888.fly.dev'

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const upstreamUrl = API_ORIGIN + url.pathname.replace(/^\/api/, '') + url.search
  const upstreamRequest = new Request(upstreamUrl, context.request)
  return fetch(upstreamRequest)
}
