use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2;
use sha2::Sha256;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

const PBKDF2_ITERATIONS: u32 = 100_000;
const SALT: &[u8] = b"aib-license-salt-v1";

/// Derive a 32-byte key from a seed string using SHA-256
pub fn derive_key(seed: &str) -> [u8; 32] {
    sha256(seed.as_bytes())
}

/// Derive a 16-byte IV from key + context
pub fn derive_iv(key: &[u8; 32], context: &[u8]) -> [u8; 16] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key");
    mac.update(context);
    let result = mac.finalize().into_bytes();
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&result[..16]);
    iv
}

/// AES-256-CBC encrypt with PKCS7 padding
pub fn encrypt(data: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let iv = derive_iv(key, b"encrypt-iv");
    let encryptor = Aes256CbcEnc::new(key.into(), &iv.into());
    // Allocate buffer with space for padding
    let mut buf = vec![0u8; data.len() + 16];
    buf[..data.len()].copy_from_slice(data);
    let ct = encryptor.encrypt_padded_mut::<Pkcs7>(&mut buf, data.len())
        .expect("encryption failed");
    ct.to_vec()
}

/// AES-256-CBC decrypt with PKCS7 padding
pub fn decrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, &'static str> {
    let iv = derive_iv(key, b"encrypt-iv");
    let decryptor = Aes256CbcDec::new(key.into(), &iv.into());
    // Create buffer with exact ciphertext size
    let mut buf = vec![0u8; data.len()];
    buf.copy_from_slice(data);
    let pt = decryptor.decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| "decryption failed")?;
    Ok(pt.to_vec())
}

/// HMAC-SHA256 sign
pub fn hmac_sign(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// HMAC-SHA256 verify
pub fn hmac_verify(key: &[u8], data: &[u8], signature: &[u8]) -> bool {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.verify_slice(signature).is_ok()
}

/// SHA-256 hash
pub fn sha256(data: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Encrypt data and return base64 string
pub fn encrypt_data(data: &str, key_seed: &str) -> String {
    let key = derive_key(key_seed);
    let encrypted = encrypt(data.as_bytes(), &key);
    base64_encode(&encrypted)
}

/// Decrypt base64 string and return plaintext
pub fn decrypt_data(encrypted: &str, key_seed: &str) -> String {
    let key = derive_key(key_seed);
    let data = base64_decode(encrypted).unwrap_or_default();
    match decrypt(&data, &key) {
        Ok(plaintext) => String::from_utf8(plaintext).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

/// Base64 encode using standard crate
pub fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Base64 decode using standard crate
pub fn base64_decode(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(data).ok()
}
