export async function generateKey() {
  return await window.crypto.subtle.generateKey(
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
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return base64Data; 
  }
}