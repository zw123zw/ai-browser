use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2;
use sha2::Sha256;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

const PBKDF2_ITERATIONS: u32 = 100_000;
const SALT: &[u8] = b"aib-license-salt-v1";

/// Derive a 32-byte key from a seed string using PBKDF2
pub fn derive_key(seed: &str) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(seed.as_bytes(), SALT, PBKDF2_ITERATIONS, &mut key);
    key
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
    encryptor.encrypt_padded_vec_mut::<Pkcs7>(data)
}

/// AES-256-CBC decrypt with PKCS7 padding
pub fn decrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, &'static str> {
    let iv = derive_iv(key, b"encrypt-iv");
    let decryptor = Aes256CbcDec::new(key.into(), &iv.into());
    decryptor
        .decrypt_padded_vec_mut::<Pkcs7>(data)
        .map_err(|_| "decryption failed")
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

/// Simple base64 encode (using base32 crate as fallback, or manual)
pub fn base64_encode(data: &[u8]) -> String {
    // Use standard base64 via manual implementation
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Simple base64 decode
pub fn base64_decode(data: &str) -> Option<Vec<u8>> {
    let data: String = data.chars().filter(|c| *c != '=').collect();
    let mut result = Vec::new();
    let chars: Vec<u8> = data
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => 0,
        })
        .collect();

    for chunk in chars.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let b0 = chunk[0] as u32;
        let b1 = chunk[1] as u32;
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 18) | (b1 << 12) | (b2 << 6);
        result.push((triple >> 16) as u8);
        if chunk.len() > 2 {
            result.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk.len() > 3 {
            result.push((triple & 0xFF) as u8);
        }
    }
    Some(result)
}
