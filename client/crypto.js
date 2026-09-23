export async function generateKey() {
  return await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function generateIdentityKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['wrapKey', 'unwrapKey']
  );
}

export async function exportPublicKey(key) {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function exportPrivateKey(key) {
  const exported = await window.crypto.subtle.exportKey('pkcs8', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPrivateKey(encodedKey) {
  const binary = atob(encodedKey);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return await window.crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['unwrapKey']
  );
}

export async function importPublicKey(encodedKey) {
  const binary = atob(encodedKey);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return await window.crypto.subtle.importKey(
    'spki',
    bytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['wrapKey']
  );
}

export async function wrapConversationKey(key, publicKey) {
  const wrapped = await window.crypto.subtle.wrapKey(
    'raw',
    key,
    publicKey,
    { name: 'RSA-OAEP' }
  );
  return btoa(String.fromCharCode(...new Uint8Array(wrapped)));
}

export async function unwrapConversationKey(encodedKey, privateKey) {
  const binary = atob(encodedKey);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return await window.crypto.subtle.unwrapKey(
    'raw',
    bytes,
    privateKey,
    { name: 'RSA-OAEP' },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportKey(key) {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return Array.from(new Uint8Array(exported));
}

export async function importKey(rawKey) {
  return await window.crypto.subtle.importKey(
    'raw',
    new Uint8Array(rawKey),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(text, key) {
  const encoded = new TextEncoder().encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cipherText = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv},
    key,
    encoded
  );
  const result = new Uint8Array(iv.length + cipherText.byteLength);
  result.set(iv);
  result.set(new Uint8Array(cipherText), iv.length);
  return btoa(String.fromCharCode(...result));
}

export async function decryptText(base64Data, key) {
  if (!key) return base64Data;
  
  try {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const iv = bytes.slice(0, 12);
    const cipherText = bytes.slice(12);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      cipherText
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return base64Data; 
  }
}