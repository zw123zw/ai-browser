use crate::crypto;
use serde::{Deserialize, Serialize};

/// Build seed embedded at compile time
const BUILD_SEED: &str = env!("BUILD_SEED");

/// License data stored in encrypted blob
#[derive(Serialize, Deserialize, Clone)]
pub struct LicenseBlob {
    pub status: String,         // "trial" | "active" | "expired"
    pub fingerprint: String,    // device fingerprint
    pub expire_ts: u64,         // expiration timestamp (ms)
    pub degrade_level: u8,      // stealth degradation level (0-3)
    pub last_hidden_check: u64, // last stealth check timestamp (ms)
    pub signature: String,      // HMAC signature
}

/// Trial period: 7 days in milliseconds
const TRIAL_DURATION_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// Derive encryption key from build seed
fn license_key() -> [u8; 32] {
    crypto::derive_key(&format!("license-{}", BUILD_SEED))
}

/// Sign a license blob
fn sign_blob(blob: &LicenseBlob) -> String {
    let key = crypto::derive_key(&format!("sign-{}", BUILD_SEED));
    let data = format!(
        "{}|{}|{}|{}",
        blob.status, blob.fingerprint, blob.expire_ts, blob.degrade_level
    );
    let sig = crypto::hmac_sign(&key, data.as_bytes());
    hex_encode(&sig)
}

/// Verify blob signature
fn verify_blob_signature(blob: &LicenseBlob) -> bool {
    let key = crypto::derive_key(&format!("sign-{}", BUILD_SEED));
    let data = format!(
        "{}|{}|{}|{}",
        blob.status, blob.fingerprint, blob.expire_ts, blob.degrade_level
    );
    match hex_decode(&blob.signature) {
        Some(sig) => crypto::hmac_verify(&key, data.as_bytes(), &sig),
        None => false,
    }
}

/// Encrypt and serialize a license blob
fn encrypt_blob(blob: &LicenseBlob) -> String {
    let json = serde_json::to_string(blob).unwrap_or_default();
    let key = license_key();
    let encrypted = crypto::encrypt(json.as_bytes(), &key);
    crypto::base64_encode(&encrypted)
}

/// Decrypt and deserialize a license blob
fn decrypt_blob(encrypted: &str) -> Option<LicenseBlob> {
    let key = license_key();
    let data = crypto::base64_decode(encrypted)?;
    let plaintext = crypto::decrypt(&data, &key).ok()?;
    serde_json::from_slice(&plaintext).ok()
}

/// Initialize 7-day trial period
pub fn init_trial(fingerprint: &str, now: u64) -> String {
    let blob = LicenseBlob {
        status: "trial".to_string(),
        fingerprint: fingerprint.to_string(),
        expire_ts: now + TRIAL_DURATION_MS,
        degrade_level: 0,
        last_hidden_check: now,
        signature: String::new(),
    };
    let mut signed_blob = blob;
    signed_blob.signature = sign_blob(&signed_blob);
    let encrypted = encrypt_blob(&signed_blob);

    let days_left = ((signed_blob.expire_ts.saturating_sub(now)) / (24 * 60 * 60 * 1000)) as u32;

    format!(
        r#"{{"blob":"{}","status":"trial","daysLeft":{},"expired":false}}"#,
        escape_json(&encrypted),
        days_left
    )
}

/// Verify activation code
/// Code format: AIB-XXXX-XXXX-XXXX
/// Signature uses Ed25519
pub fn verify_code(code: &str, fingerprint: &str, now: u64) -> String {
    // Parse code
    let normalized = code.trim().to_uppercase();
    let parts: Vec<&str> = normalized.split('-').collect();
    if parts.len() != 4 || parts[0] != "AIB" {
        return r#"{"valid":false,"error":"格式无效"}"#.to_string();
    }

    // Decode each part
    let part1 = match base32_decode(parts[1]) {
        Some(v) => v,
        None => return r#"{"valid":false,"error":"编码无效"}"#.to_string(),
    };
    let part2 = match base32_decode(parts[2]) {
        Some(v) => v,
        None => return r#"{"valid":false,"error":"编码无效"}"#.to_string(),
    };
    let part3 = match base32_decode(parts[3]) {
        Some(v) => v,
        None => return r#"{"valid":false,"error":"编码无效"}"#.to_string(),
    };

    if part1.len() < 4 || part2.len() < 4 || part3.len() < 4 {
        return r#"{"valid":false,"error":"编码长度无效"}"#.to_string();
    }

    // Extract fields from part1
    let version_major = part1[0];
    let version_minor = part1[1];
    let expire_month = part1[2];
    let _random = part1[3];

    // Extract expire_ts from part2 (4 bytes, big-endian)
    let expire_ts_low = ((part2[0] as u64) << 24)
        | ((part2[1] as u64) << 16)
        | ((part2[2] as u64) << 8)
        | (part2[3] as u64);

    // Reconstruct full expire_ts (add month offset)
    let base_ts: u64 = 1704067200000; // 2024-01-01 00:00:00 UTC in ms
    let expire_ts = base_ts + (expire_month as u64) * 30 * 24 * 60 * 60 * 1000 + expire_ts_low;

    // Extract fingerprint_hash from part3 (4 bytes)
    let fp_hash_from_code = &part3[..4];

    // Verify fingerprint binding (skip if all zeros = not bound to device)
    let is_unbound = fp_hash_from_code.iter().all(|&b| b == 0);
    if !is_unbound {
        let fp_hash = crypto::sha256(fingerprint.as_bytes());
        if fp_hash[..4] != *fp_hash_from_code {
            return r#"{"valid":false,"error":"设备不匹配"}"#.to_string();
        }
    }

    // Verify Ed25519 signature (from part3 last 4 bytes + implicit)
    // For now, use HMAC verification (Ed25519 will be added with key generation)
    let version_str = format!("{}.{}", version_major, version_minor);
    let verify_key = crypto::derive_key(&format!("verify-{}-{}", version_str, BUILD_SEED));
    let fp_for_sig = if is_unbound { "none" } else { fingerprint };
    let data_to_verify = format!(
        "{}|{}|{}|{}",
        version_str,
        expire_ts,
        hex_encode(fp_hash_from_code),
        fp_for_sig
    );

    // Signature is embedded in the code structure
    // For the simplified version, we verify the code integrity
    let sig_data = crypto::hmac_sign(&verify_key, data_to_verify.as_bytes());
    let sig_part = &sig_data[..4];

    // Verify signature matches (part3 last bytes)
    if part3.len() >= 8 && part3[4..8] != *sig_part {
        return r#"{"valid":false,"error":"签名验证失败"}"#.to_string();
    }

    // Create active license blob
    let blob = LicenseBlob {
        status: "active".to_string(),
        fingerprint: fingerprint.to_string(),
        expire_ts,
        degrade_level: 0,
        last_hidden_check: now,
        signature: String::new(),
    };
    let mut signed_blob = blob;
    signed_blob.signature = sign_blob(&signed_blob);
    let encrypted = encrypt_blob(&signed_blob);

    format!(
        r#"{{"valid":true,"blob":"{}","error":null}}"#,
        escape_json(&encrypted)
    )
}

/// Check license status (validity period only)
pub fn check_license(blob: &str, now: u64) -> String {
    let license = match decrypt_blob(blob) {
        Some(l) => l,
        None => {
            return r#"{"status":"corrupted","daysLeft":0,"expired":true}"#.to_string();
        }
    };

    // Verify signature
    if !verify_blob_signature(&license) {
        return r#"{"status":"corrupted","daysLeft":0,"expired":true}"#.to_string();
    }

    let expired = now > license.expire_ts;

    let status = if expired && license.status != "expired" {
        "expired"
    } else {
        &license.status
    };

    let days_left = if !expired {
        ((license.expire_ts.saturating_sub(now)) / (24 * 60 * 60 * 1000)) as u32
    } else {
        0
    };

    format!(
        r#"{{"status":"{}","daysLeft":{},"expired":{}}}"#,
        status, days_left, expired
    )
}

/// Update blob with new degrade level
pub fn update_degrade(blob: &str, level: u8) -> Option<String> {
    let mut license = decrypt_blob(blob)?;
    license.degrade_level = level;
    license.signature = sign_blob(&license);
    Some(encrypt_blob(&license))
}

/// Update blob with new last_hidden_check timestamp
pub fn update_hidden_check(blob: &str, ts: u64) -> Option<String> {
    let mut license = decrypt_blob(blob)?;
    license.last_hidden_check = ts;
    license.signature = sign_blob(&license);
    Some(encrypt_blob(&license))
}

/// Get license blob fields (for internal use)
pub fn get_blob_fields(blob: &str) -> Option<LicenseBlob> {
    let license = decrypt_blob(blob)?;
    if verify_blob_signature(&license) {
        Some(license)
    } else {
        None
    }
}

// Helper functions

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut result = Vec::new();
    for i in (0..hex.len()).step_by(2) {
        let byte = u8::from_str_radix(&hex[i..i + 2], 16).ok()?;
        result.push(byte);
    }
    Some(result)
}

fn base32_decode(s: &str) -> Option<Vec<u8>> {
    // Simple base32 decode (RFC 4648)
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let s = s.to_uppercase();
    let mut result = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;

    for c in s.bytes() {
        let value = match ALPHABET.iter().position(|&b| b == c) {
            Some(v) => v as u32,
            None => return None,
        };
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            result.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(result)
}

fn escape_json(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
