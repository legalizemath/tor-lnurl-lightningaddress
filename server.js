// https://github.com/mefatbear/lightning-address-nodejs/blob/master/src/server.ts

import express from 'express'
import crypto from 'crypto'
import bos from './bos.js'
import fs from 'fs'
import { bech32 } from 'balanceofsatoshis/node_modules/bech32/dist/index.js'
import { addAttachedOnion } from './tor.js'
const app = express()

// where to setup local network web server
const LOCAL_SERVER_PORT = 7890
const LOCAL_SERVER_ADDRESS = '0.0.0.0'
const USER_NAME = 'btc' // give username to use for lnurl and lightning address
const TEXT_MESSAGE = `Send sats. ${USER_NAME}` // text to show senders

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
  const lnurlp = bech32.encode('lnurl', bech32.toWords(Buffer.from(lnurl_utf8, 'utf8')), 2000)
  const lightningAddress = `${USER_NAME}@${url_root}`

  infoText = `resources available at: <br><br>
    url: ${lnurl_utf8} add &amount=123 to charge specific amount <br><br>
    lnurlp: ${lnurlp} (works on SWB) <br><br>
    lightningAddress: ${lightningAddress} (doesn't work anywhere yet) <br><br>
  `
  console.log(infoText)

  // backup private key into settings.json so it's re-used next run
  fs.writeFileSync(
    './settings.json',
    JSON.stringify(
      {
        controlPassword,
        hsPrivateKey: torRes.hsPrivateKey
      },
      null,
      2
    )
  )
}

// ---------- set up local webserver ----------

// lnurl pay path for lightning address
app.get([`/.wellknown/lnurlp/${USER_NAME}`, `/.wellknown/lnurlp/${USER_NAME}@*`], async (req, res) => {
  // const username = req.params.username // if :username used in get so anything works

  console.log(`\nget request received for /.wellknown/lnurlp/${USER_NAME}\n`)

  const callback = `http://${req.hostname}/.wellknown/lnurlp/${USER_NAME}`
  const identifier = `${USER_NAME}@${req.hostname}`

  const metadata = [
    ['text/identifier', identifier],
    ['text/plain', TEXT_MESSAGE]
  ]
  const msat = req?.query?.amount

  const hash = crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex')

  if (msat) {
    const invoice = await bos.lnService.createInvoice({
      mtokens: String(msat),
      description_hash: hash,
      lnd
    })

    console.log(`\nnew payment request: ${invoice.request}\n`)
    // decoded request
    console.log(
      'decoded payment request:',
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

  console.log('amountless request')

  return res.status(200).json({
    status: 'OK',
    callback: callback,
    tag: 'payRequest',
    maxSendable: 250000000,
    minSendable: 1000,
    metadata: JSON.stringify(metadata),
    commentsAllowed: 160
  })
})

app.disable('x-powered-by')

// root access
app.get('/', async (req, res) => {
  console.log("\nget request received for '/'\n")
  // console.log(req)

  res.send(infoText)
})

app.listen(LOCAL_SERVER_PORT, LOCAL_SERVER_ADDRESS, () => {
  console.log(`local server running at ${LOCAL_SERVER_ADDRESS}:${LOCAL_SERVER_PORT}`)
})

app.on('error', err => {
  console.log('local server error', err)
})

run()
