import express from 'express'
import QRCode from 'qrcode'
import fs from 'fs'

import crypto from 'crypto'
import bos from './bos.js'

import { bech32 } from 'balanceofsatoshis/node_modules/bech32/dist/index.js'
import {
  // addAttachedOnion,
  addDetachedOnion
} from './tor.js'

const app = express()

const log = (...args) => console.log(...[time().replace(/[TZ]/g, ' '), ...args])
const logn = (...args) => log(...['\n', ...args])

// where to setup local network web server
const LOCAL_SERVER_PORT = 7890
const LOCAL_SERVER_ADDRESS = '0.0.0.0'
const USER_NAME = 'btc' // give username to use for lnurl and lightning address
const TEXT_MESSAGE = 'Send sats O.o' // text to show senders
const MAX_SENDABLE = 21e5 * 1e3 // max msats can send
const MIN_SENDABLE = 1e3 // min msats can send

// how to access tor service controller and which port to use for new .onion
const { controlPassword, hsPrivateKey, serviceId } = JSON.parse(fs.readFileSync('./settings.json'))
const ONION_CONTROL_ADDRESS = '0.0.0.0:39051' // your tor service control port
const ONION_PORT = '80' // port for .onion:port address outsiders will use

let lnd // lnd auth goes here later for ln-service
let infoText = 'My Bitcoin homepage!'

// ---------- set up necessary request response handlers ----------

const handleGetLnurlp = async (req, res) => {
  // const username = req.params.username // if :username used in get so anything works
  if (!lnd) return res.status(200).json({ status: 'ERROR', reason: 'LN node not ready yet. Try again later.' })

  log(`responding to "${req.url}"`)

  const callback = `http://${req.hostname}/.well-known/lnurlp/${USER_NAME}`
  const identifier = `${USER_NAME}@${req.hostname}`

  const metadata = [
    ['text/identifier', identifier],
    ['text/plain', TEXT_MESSAGE]
  ]
  const msat = req?.query?.amount

  const hash = crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
  const SENDABLE_ERROR = `Amount ${msat} outside sendable msat range: ${MIN_SENDABLE}-${MAX_SENDABLE}`

  try {
    if (msat) {
      log(`get request for ${msat} msat payment`)
      if (+msat > MAX_SENDABLE || +msat < MIN_SENDABLE) throw new Error(SENDABLE_ERROR)

      const invoice = await bos.lnService.createInvoice({
        mtokens: String(msat),
        description_hash: hash,
        lnd
      })

      log(`new payment invoice generated: ${invoice.request}`)
      // decoded request
      log(
        'decoded payment request:',
        bos.lnService.parsePaymentRequest({
          request: invoice.request
        })
      )

      return res.status(200).json({
        status: 'OK',
        successAction: { tag: 'message', message: 'Thank You!' }, // shows up once payment succeeds
        routes: [],
        pr: invoice.request,
        disposable: false
      })
    }
  } catch (e) {
    log('error:', e.message)
    if (e.message === SENDABLE_ERROR) {
      res.status(200).json({ status: 'ERROR', reason: SENDABLE_ERROR })
      return null
    }
    // otherwise it's likely a problem with lnd auth so refreshing it
    res.status(200).json({ status: 'ERROR', reason: 'Error generating invoice. Try again later.' })
    lnd = undefined
    lnd = await bos.initializeAuth()
    return null
  }

  log('Received amountless request')

  return res.status(200).json({
    status: 'OK',
    callback: callback,
    tag: 'payRequest',
    maxSendable: MAX_SENDABLE,
    minSendable: MIN_SENDABLE,
    metadata: JSON.stringify(metadata),
    commentsAllowed: 160
  })
}

const handleHomepage = async (req, res) => {
  log(`responding to "${req.url}"`)
  res.send(infoText)
}

// ---------- set up local webserver ----------

app.disable('x-powered-by')
// on every request
app.use((req, res, next) => {
  logn(`received ${req.method} request for ${req.hostname}${req.url} with following query:`, req.query)
  // signal CORS allowed
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS,HEAD',
    'Access-Control-Allow-Headers':
      'Host,User-Agent,Accept,Accept-Language,Accept-Encoding,Content-Type,Origin,Connection,sec-fetch-dest,sec-fetch-mode,sec-fetch-site'
  })
  if (req.method === 'OPTIONS') return res.set({ 'Access-Control-Allow-Methods': 'GET' }).status(200).end()
  // log('request headers:', req.headers)
  // log('response headers', res.getHeaders())
  next()
})

// lnurl pay path for lightning address
app.get([`/.well-known/lnurlp/${USER_NAME}`, `/.well-known/lnurlp/${USER_NAME}*`], handleGetLnurlp)

// root access
app.get('/', handleHomepage)

// fallback
app.get('*', async (req, res) => {
  log(`fallback responding to ${req.url}`)
  return res.status(404).end()
})

app.listen(LOCAL_SERVER_PORT, LOCAL_SERVER_ADDRESS, () => {
  log(`local server running at ${LOCAL_SERVER_ADDRESS}:${LOCAL_SERVER_PORT}`)
})

app.on('error', err => {
  log('local server error', err)
})

// ---------- set up a tor .onion hiddenservice (onion address) to forward to our local webserver ----------

const setupTorAddress = async () => {
  // get lnd authorization for later
  lnd = await bos.initializeAuth()

  // create onion hs
  // const torRes = await addAttachedOnion({
  const torRes = await addDetachedOnion({
    torControlAddress: ONION_CONTROL_ADDRESS,
    torControlPassword: controlPassword,
    portForOnion: ONION_PORT,
    clearnetAddressAndPort: `${LOCAL_SERVER_ADDRESS}:${LOCAL_SERVER_PORT}`,
    hsPrivateKey, // if known, will reuse hidden service onion key to get same onion address
    serviceId // if known, corresponds to hsPrivateKey
  })

  const url_root = `${torRes.serviceId}.onion`
  const lnurl_utf8 = `http://${url_root}/.well-known/lnurlp/${USER_NAME}`
  const lnurlp = bech32.encode('lnurl', bech32.toWords(Buffer.from(lnurl_utf8, 'utf8')), 2000).toUpperCase()
  const lightningAddress = `${USER_NAME}@${url_root}`

  infoText = `
  msats max sendable: ${MAX_SENDABLE}<br>
  msats min sendable: ${MIN_SENDABLE}<br>
  <br>
  resources available at: <br>
  <br>
  homepage: http://${url_root}<br>
  <br>
  url: ${lnurl_utf8} <br>
  <br>
  lightning-address: ${lightningAddress} <br>
    (works with SBW, Bluewallet) <br>
  <br>
  lnurlp/lnurl-pay: ${lnurlp} <br>
    (works w/ SWB, Bluewallet w/ built-in tor support) <br>
    (works w/ Blixt, Breez when running Orbot VPN mode w/ wallets added to Tor enabled apps) <br>
    (doesn't work with Phoenix, Muun, WoS yet) <br>
  <br>
`

  log(infoText.replace(/<br>/g, ''))
  // QR for terminal and svg on homepage have to be different to render right
  log('LNURL qrcode for testing:')
  console.log(await QRCode.toString(lnurlp, { type: 'terminal', small: true }))
  infoText += 'LNURLP QRcode:<br>' + (await QRCode.toString(lnurlp, { type: 'svg', margin: 4, scale: 1, width: 320 }))

  // backup private key into settings.json so it's re-used next run
  // leaking tor hidden service private key can let anyone else generate your onion address
  const settingsBackup = {
    controlPassword,
    serviceId: torRes.serviceId,
    hsPrivateKey: torRes.hsPrivateKey,
    lnurl_utf8: lnurl_utf8,
    lnurlp: lnurlp
  }
  fs.writeFileSync('./settings.json', JSON.stringify(settingsBackup, null, 2))
}

const time = timestamp => (timestamp !== undefined ? new Date(timestamp) : new Date()).toISOString()

setupTorAddress()

// used for reference https://github.com/mefatbear/lightning-address-nodejs/blob/master/src/server.ts
