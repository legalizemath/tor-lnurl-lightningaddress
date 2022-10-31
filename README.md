# WHAT IS THIS?

server.js creates local server + static onion address accessible through tor to use for lnurlp or lightning addresses.
it includes CORS headers so it can be fetched from random pages like https://codepen.io/legalizemath/full/eYymQKb (from tor browser)

what it creates for me for example:

* lightning address: btc@arihg6tpnvs7qsjtklrybolhcdpjkwj5w4jaacx7flc6vzpiuy42puid.onion
* lnurl-pay code: LNURL1DP68GUP69UHKZUNFDPNNVARSDEM8XDM3WD48G6MVWFUKYMMVDP3KGUR2DDMK5DTHX34XZCTR0QMKVMRRXEM85URFW4UNGVNSW45KGTN0DE5K7M309EMK2MRV944KUMMHDCHKCMN4WFK8QTMZW33SGXWMMV 
* lnurl: http://arihg6tpnvs7qsjtklrybolhcdpjkwj5w4jaacx7flc6vzpiuy42puid.onion/.well-known/lnurlp/btc
* static homepage: http://arihg6tpnvs7qsjtklrybolhcdpjkwj5w4jaacx7flc6vzpiuy42puid.onion


# INFO

for speed just re-used my bos wrappers which means it needs [globally installed balanceofsatoshis](https://github.com/alexbosworth/run-lnd#install-balance-of-satoshis) for lnd (npm i -g balanceofsatoshis)

```sh
# install tor if not yet, tor --version

    sudo apt install tor

# generate password hash with: tor --hash-password "password"

# password hash looks like 16:94D87DAEACD5274060844DAD7AAC00239BBA59C61455407034007C435F

# edit tor settings file (ctrl-x close, ctrl-y yes to save changes, enter to confirm file path), replace nano w/ whatever editor

    sudo nano /etc/tor/torrc # edit torrc file

# add following 2 lines (obviously replace hashed control password w/ output from tor --hash-password):

# ControlPort 39051 # this is for controlling tor service

# HashedControlPassword 16:94D87DAEACD5274060844DAD7AAC00239BBA59C61455407034007C435F

    sudo service tor restart

```

```
git clone https://github.com/legalizemath/tor-lnurl-lightningaddress.git torlnurl
cd torlnurl
npm install
```

edit server.js to set the control port if different

edit settings.json for password for control port, example just uses "password" and corresponding hash

run via
```
npm link balanceofsatoshis
node server.js
# or shortcut via: npm run start
```

ctrl-c to stop both local server and onion hiddenservice

# Manually connecting to tor controller via telnet

```sh
# If local website/server listens at 0.0.0.0:7890, this is how you put it up on onion address while telnet or socket connection is active

# For it to stay after disconnecting from telnet have to use Flag=Detached and then later remove with DEL_ONION serviceId

    telnet 0.0.0.0 39051
    AUTHENTICATE "password"
    ADD_ONION NEW:BEST Port=80,0.0.0.0:7890

# it will respond with serviceId, which is onion address without .onion

# and PrivateKey which can be used to re-host @ identical serviceId later after you remove it via

    ADD_ONION ED25519-V3:privatekey
    
```
