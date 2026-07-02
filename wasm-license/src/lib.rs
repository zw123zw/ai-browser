mod crypto;
mod fingerprint;
mod license;
mod stealth;
mod usage;

use wasm_bindgen::prelude::*;

/// Initialize 7-day trial period
/// now: current timestamp in milliseconds (Date.now())
/// Returns JSON: { blob, status, daysLeft }
#[wasm_bindgen]
pub fn init_trial(fingerprint: &str, now: u64) -> String {
    license::init_trial(fingerprint, now)
}

/// Verify activation code (Ed25519 signature verification)
/// now: current timestamp in milliseconds (Date.now())
/// Returns JSON: { valid, blob, error }
#[wasm_bindgen]
pub fn verify_code(code: &str, fingerprint: &str, now: u64) -> String {
    license::verify_code(code, fingerprint, now)
}

/// Check license status (validity period only)
/// now: current timestamp in milliseconds (Date.now())
/// Returns JSON: { status, daysLeft, expired }
#[wasm_bindgen]
pub fn check_license(blob: &str, now: u64) -> String {
    license::check_license(blob, now)
}

/// Track usage and check if stealth verification should trigger
/// Returns JSON: { totalHours, totalActions, shouldCheck }
#[wasm_bindgen]
pub fn track_usage(blob: &str, action: &str, ts: u64) -> String {
    usage::track_usage(blob, action, ts)
}

/// Stealth secondary verification (silent)
/// Returns JSON: { passed, degradeLevel }
#[wasm_bindgen]
pub fn hidden_verify(blob: &str) -> String {
    stealth::hidden_verify(blob)
}

/// AES-256-CBC encrypt
#[wasm_bindgen]
pub fn encrypt_data(data: &str, key_seed: &str) -> String {
    crypto::encrypt_data(data, key_seed)
}

/// AES-256-CBC decrypt
#[wasm_bindgen]
pub fn decrypt_data(encrypted: &str, key_seed: &str) -> String {
    crypto::decrypt_data(encrypted, key_seed)
}

/// Generate stable fingerprint from browser signals
#[wasm_bindgen]
pub fn generate_fingerprint(
    runtime_id: &str,
    user_agent: &str,
    platform: &str,
    screen: &str,
    cores: &str,
    memory: &str,
    timezone: &str,
    language: &str,
) -> String {
    fingerprint::generate(runtime_id, user_agent, platform, screen, cores, memory, timezone, language)
}
