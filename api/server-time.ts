export default function handler(_request: any, response: any) {
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  return response.status(200).json({ now: new Date().toISOString() })
}
