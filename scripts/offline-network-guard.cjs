const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const forbidden = () => {
  throw new Error('Pronunciation offline tests forbid network requests');
};
http.request = http.get = https.request = https.get = forbidden;
net.Socket.prototype.connect = forbidden;
globalThis.fetch = forbidden;
