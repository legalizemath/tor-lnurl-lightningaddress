// https://nolife.cyou/setup-tor-hidden-service-on-node-js/
import { Socket } from 'net'
import fs from 'fs'

// creates detached onion hidden service
// returns { serviceId, keyType, privateKey, socket }
// socket.destroy() will close the connection
export const addAttachedOnion = async ({
  // connecting to control set in torrc settings like ControlPort 10.21.21.11:29051 or localhost:9051
  torControlAddress = '0.0.0.0:9051',
  // control password to match torrc setting hash like
  // HashedControlPassword 16:6C76EEF0EA80542E60FBFCD0019B51C3074F0B28EED866FDF3F22CAEB3
  torControlPassword = '',
  // port for the onion service/address (80 http, 443 https)
  portForOnion = '80',
  // port for the thing that you want to show up for onion service/address
  clearnetAddressAndPort = '0.0.0.0:3000',
  // optional hidden service private key to recreate same onion address again
  hsPrivateKey = ''
}) => {
  console.log({ torControlAddress, torControlPassword, portForOnion, clearnetAddressAndPort })
  // connect to tor control
  const socket = await connect(torControlAddress)

  // authenticacte tor control
  const resAuth = await authenticate(socket, torControlPassword)
  console.log(`${time()} tor: ${resAuth}`)

  // add onion address
  console.log('add_onion: new')
  const onionInputValues = `${portForOnion},${clearnetAddressAndPort}`
  const resAddOnion = await addOnion(socket, {
    // keyType: 'ED25519-V3', //'ED25519-V3' or 'BEST'
    // flags: 'Detach',
    port: onionInputValues,
    hsPrivateKey
  })
  fs.writeFileSync(`_${resAddOnion.serviceId}.json`, JSON.stringify(resAddOnion, null, 2))
  console.log(`${time()} tor: ${JSON.stringify(resAddOnion, null, 2)}`)

  // list onions
  // https://github.com/torproject/torspec/blob/main/control-spec.txt#L1116
  const resList2 = await getInfo(socket, 'onions/current')
  console.log(`${time()} tor: ${resList2}`)
  const resList3 = await getInfo(socket, 'onions/detached')
  console.log(`${time()} tor: ${resList3}`)

  // deleting an onion service
  // console.log(await sendCommand(socket, 'DEL_ONION lgpibnn7w2tvrwhahprwrqzm7gxk5y3ayux2xp5gp6uxvo6hvuk6hkid'))

  // close connection
  // console.log(`${time()} socket.destroy()`)
  // socket.destroy()

  return {
    ...resAddOnion,
    socket
  }
}

// add onion service
// https://github.com/torproject/torspec/blob/main/control-spec.txt#L1749
export const addOnion = async (socket, options) => {
  let { keyType, privateKey, flags, port, hsPrivateKey } = options

  // always need keyType for provided privateKey
  if (privateKey && !keyType) {
    throw new Error('Set keyType when you provide privateKey')
  }

  let keyArgument
  if (hsPrivateKey) {
    keyArgument = hsPrivateKey
  } else {
    if (keyType) {
      keyArgument = privateKey
        ? `${keyType}:${privateKey}` // use provided keyType and privateKey
        : `NEW:${keyType}` // generate new private key of provided keyType
    } else {
      keyArgument = 'NEW:BEST' // if keyType not provided, use 'BEST'
    }
  }

  const flagsArgument = flags ? `Flags=${flags} ` : ''
  const portArgument = `Port=${port}`
  const command = `ADD_ONION ${keyArgument} ${flagsArgument}${portArgument}`
  console.log(`${time()} command: ${command}\n`)
  const result = await sendCommand(socket, command)
  console.log(`${time()} tor: ${result}`)

  // parse through returned text
  const lines = result.split('\r\n')
  // example 250-ServiceID=pismseqxalmmrdgwy6orjwt5xs36bepp4gekudhpgtmclyvc2a6i6sid
  const serviceId = lines[0].split('250-ServiceID=')[1]

  // return service id and all needed to control it

  if (lines[1].startsWith('250-PrivateKey=')) {
    // if private key was generated get the info about it
    const privateKeyResult = lines[1].split('250-PrivateKey=')[1].split(':')
    // example 250-PrivateKey=ED25519-V3:wDnhv3eEu5CfBUNZhzOMlEZI9pSZBH9vvvYhJsLMjUcMpzj9HCFmjef52KyfmelhGfN72CaY2RsSqHE60huxtQ==
    keyType = privateKeyResult[0]
    privateKey = privateKeyResult[1]
  }

  //   console.log(`${time()} new onion service information to save
  // serviceId: ${serviceId}
  // keyType: ${keyType}
  // privateKey: ${privateKey}
  //   `)

  return {
    serviceId,
    keyType,
    privateKey,
    hsPrivateKey: hsPrivateKey || `${keyType}:${privateKey}`
  }
}

// connect to tor control at address and port torControlAddress
// returns socket to use later for further commands
export const connect = torControlAddress => {
  const [host, port] = torControlAddress.split(':')
  return new Promise(resolve => {
    const socket = new Socket()
    console.log(`${time()} connecting to ${host}:${port} socket`)
    socket.on('ready', () => console.log(`${time()} socket: ready`))
    socket.on('timeout', () => console.log(`${time()} socket: timeout`))
    socket.on('error', err => console.log(`${time()} socket: error`, err))
    socket.on('end', () => console.log(`${time()} socket: end`))
    socket.on('close', () => console.log(`${time()} socket: close`))
    socket.on('ADDRMAP', v => console.log(`${time()} socket: ADDMAP:`, v))

    socket.connect(+port, host, () => resolve(socket))
  })
}

// send a command to tor control
export const sendCommand = (socket, command) => {
  return new Promise((resolve, reject) => {
    socket.once('data', data => {
      const result = data.toString()
      if (result.includes('250 OK')) {
        resolve(result)
      } else {
        reject(new Error(result))
      }
    })
    socket.write(`${command}\n`)
  })
}

// submit password to tor control
export const authenticate = (socket, password) => {
  console.log(`AUTHENTICATE "${'*'.repeat(password.length)}"`)
  return sendCommand(socket, `AUTHENTICATE "${password}"`)
}

// submit GETINFO [keyword] command to tor control
export const getInfo = (socket, keyword) => {
  console.log(`GETINFO ${keyword}`)
  return sendCommand(socket, `GETINFO ${keyword}`)
}

const time = timestamp => (timestamp !== undefined ? new Date(timestamp) : new Date()).toISOString()

/*
To create a new onion service (the address and private key are returned to you):

ADD_ONION NEW:BEST Port=80

To shut down a currently-running onion service:

DEL_ONION exampleonion1234

To restart a previously-created onion service:

ADD_ONION [PrivateKeyString] Port=80
*/
