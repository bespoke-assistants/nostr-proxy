import fs from 'fs';
import axios from 'axios';
import { relayInit, nip44, getPublicKey } from 'nostr-tools';
import 'websocket-polyfill';

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

// Initialize relay
const relay = relayInit(config.relayUrl);
relay.on('connect', () => console.log(`Connected to ${config.relayUrl}`));
relay.on('error', (err) => console.error(`Error: ${err}`));
await relay.connect();

// Subscribe to direct messages
const sub = relay.sub([{ kinds: [4] }]);
sub.on('event', async (event) => {
  const recipientTag = event.tags.find(tag => tag[0] === 'p');
  if (recipientTag) {
    const recipientPubKey = recipientTag[1];
    const assistant = config.assistants.find(a => a.pubkey === recipientPubKey);
    if (assistant) {
      // Decrypt the message
      const decryptedMessage = decryptMessage(event, assistant.privatekey);
      console.log(`Decrypted message: ${decryptedMessage}`);

      // Forward to AI assistant and wait for response
      try {
        const response = await axios.post(assistant.assistantUrl, { message: decryptedMessage });
        // Encrypt and send back the response
        const encryptedResponse = encryptMessage(response.data, event.pubkey, assistant.privatekey);
        sendResponse(encryptedResponse, assistant, event.pubkey, relay);
      } catch (error) {
        console.error('Error forwarding message to AI assistant:', error);
      }
    } else {
      console.log('Recipient not found among configured assistants.');
    }
  }
});

function decryptMessage(event, privateKey) {
  const senderPubKey = event.pubkey;
  const sharedSecret = nip44.getSharedSecret(privateKey, senderPubKey);
  return nip44.decrypt(sharedSecret, event.content);
}

function encryptMessage(response, recipientPubKey, privateKey) {
  const sharedSecret = nip44.getSharedSecret(privateKey, recipientPubKey);
  return nip44.encrypt(sharedSecret, response);
}

function sendResponse(encryptedResponse, assistant, recipientPubKey, relay) {
  const event = {
    kind: 4,
    pubkey: assistant.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubKey]],
    content: encryptedResponse
  };
  relay.publish(event);
}

// Keep the service running
process.on('SIGINT', () => {
  console.log('Shutting down...');
  relay.close();
  process.exit();
});

