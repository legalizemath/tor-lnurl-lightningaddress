// https://github.com/mefatbear/lightning-address-nodejs/blob/master/src/server.ts

import express from 'express'
import crypto from 'crypto'
import bos from './bos.js'
import fs from 'fs'
import { bech32 } from 'balanceofsatoshis/node_modules/bech32/dist/index.js'
import { addAttachedOnion } from './tor.js'
import QRCode from 'qrcode'

const app = express()

// where to setup local network web server
const LOCAL_SERVER_PORT = 7890
const LOCAL_SERVER_ADDRESS = '0.0.0.0'
const USER_NAME = 'btc' // give username to use for lnurl and lightning address
const TEXT_MESSAGE = `Send sats. ${USER_NAME}` // text to show senders
const MAX_SENDABLE = 21e5 * 1e3 // max msats can send
const MIN_SENDABLE = 1e3 // min msats can send

// how to access tor service controller and which port to use for new .onion
const { controlPassword, hsPrivateKey } = JSON.parse(fs.readFileSync('./settings.json'))
const ONION_CONTROL_ADDRESS = '0.0.0.0:39051' // your tor service control port
const ONION_PORT = '80' // port for .onion:port address outsiders will use

let lnd // lnd auth goes here later for ln-service
let infoText = 'My Bitcoin homepage!'

// set up new tor .onion hiddenservice to forward to local webserver
const run = async () => {
  // get lnd authorization for later
  lnd = await bos.initializeAuth()

  // create onion hs
  const torRes = await addAttachedOnion({
    torControlAddress: ONION_CONTROL_ADDRESS,
    torControlPassword: controlPassword,
    portForOnion: ONION_PORT,
    clearnetAddressAndPort: `${LOCAL_SERVER_ADDRESS}:${LOCAL_SERVER_PORT}`,
    hsPrivateKey // if this was available in settings.json, it will use it
  })

  const url_root = `${torRes.serviceId}.onion`
  const lnurl_utf8 = `http://${url_root}/.wellknown/lnurlp/${USER_NAME}`
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
  lightningAddress: ${lightningAddress} <br>
    (doesn't work anywhere yet) <br>
  <br>
  lnurlp: ${lnurlp} <br>
    (works w/ SWB, Bluewallet w/ built-in tor support) <br>
    (works w/ Blixt, Breez when running Orbot VPN mode w/ wallets added to Tor enabled apps) <br>
    (doesn't work with Phoenix, Muun, WoS yet) <br>
  <br>
`

  console.log(`${time()}`, infoText.replace(/<br>/g, ''))
  console.log(await QRCode.toString(lnurlp, { type: 'terminal', small: true }))

  infoText += await QRCode.toString(lnurlp, { type: 'svg', margin: 4, scale: 1, width: 320 })

  // backup private key into settings.json so it's re-used next run
  // leaking tor hidden service private key can let anyone else generate your onion address
  const settingsBackup = {
    controlPassword,
    hsPrivateKey: torRes.hsPrivateKey,
    url_root: url_root,
    lnurl_utf8: lnurl_utf8,
    lnurlp: lnurlp
  }
  fs.writeFileSync('./settings.json', JSON.stringify(settingsBackup, null, 2))
}

// ---------- set up local webserver ----------

// lnurl pay path for lightning address
app.get([`/.wellknown/lnurlp/${USER_NAME}`, `/.wellknown/lnurlp/${USER_NAME}@*`], async (req, res) => {
  // const username = req.params.username // if :username used in get so anything works
  if (!lnd) return res.status(500).json({ status: 'ERROR', reason: 'LN node not ready yet. Try again later.' })

  console.log(`\n${time()} get request received for /.wellknown/lnurlp/${USER_NAME}\n`)

  const callback = `http://${req.hostname}/.wellknown/lnurlp/${USER_NAME}`
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
      console.log(`${time()} Received request for ${msat} msat payment`)
      if (+msat > MAX_SENDABLE || +msat < MIN_SENDABLE) throw new Error(SENDABLE_ERROR)

      const invoice = await bos.lnService.createInvoice({
        mtokens: String(msat),
        description_hash: hash,
        lnd
      })

      console.log(`\n${time()} new payment request: ${invoice.request}\n`)
      // decoded request
      console.log(
        `${time()} decoded payment request:`,
        bos.lnService.parsePaymentRequest({
          request: invoice.request
        })
      )

      return res.status(200).json({
        status: 'OK',
        successAction: { tag: 'message', message: 'Thank You!' },
        routes: [],
        pr: invoice.request,
        disposable: false
      })
    }
  } catch (e) {
    console.log(`${time()} error:`, e.message)
    if (e.message === SENDABLE_ERROR) {
      res.status(500).json({ status: 'ERROR', reason: SENDABLE_ERROR })
      return null
    }
    // otherwise it's likely a problem with lnd auth so refreshing it
    res.status(500).json({ status: 'ERROR', reason: 'Error generating invoice. Try again later.' })
    lnd = undefined
    lnd = await bos.initializeAuth()
    return null
  }

  console.log(`${time()} Received amountless request`)

  return res.status(200).json({
    status: 'OK',
    callback: callback,
    tag: 'payRequest',
    maxSendable: MAX_SENDABLE,
    minSendable: MIN_SENDABLE,
    metadata: JSON.stringify(metadata),
    commentsAllowed: 160
  })
})

app.disable('x-powered-by')

// root access
app.get('/', async (req, res) => {
  console.log(`\n${time()} get request received for '/'\n`)
  // console.log(req)

  res.send(infoText)
})

app.listen(LOCAL_SERVER_PORT, LOCAL_SERVER_ADDRESS, () => {
  console.log(`${time()} local server running at ${LOCAL_SERVER_ADDRESS}:${LOCAL_SERVER_PORT}`)
})

app.on('error', err => {
  console.log(`${time()} local server error`, err)
})

const time = timestamp => (timestamp !== undefined ? new Date(timestamp) : new Date()).toISOString()

run()
