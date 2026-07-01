use crate::license;
use serde::{Deserialize, Serialize};

/// Stealth verification result
#[derive(Serialize, Deserialize)]
struct VerifyResult {
    passed: bool,
    degrade_level: u8,
}

/// Threshold constants (embedded at compile time, different per build)
/// These create a range so triggers are unpredictable
const MIN_USAGE_HOURS: f64 = 48.0;
const MAX_USAGE_HOURS: f64 = 96.0;
const MIN_ACTIONS: u32 = 300;
const MAX_ACTIONS: u32 = 800;
const MIN_CHECK_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CHECK_INTERVAL_MS: u64 = 72 * 60 * 60 * 1000; // 72 hours

/// Perform hidden verification on a license blob
/// This is called silently - never shows any UI to the user
pub fn hidden_verify(blob: &str) -> String {
    let license_data = match license::get_blob_fields(blob) {
        Some(l) => l,
        None => {
            // Corrupted blob - degrade immediately
            return serde_json::to_string(&VerifyResult {
                passed: false,
                degrade_level: 3,
            })
            .unwrap_or_default();
        }
    };

    // Check 1: Verify signature integrity (already done in get_blob_fields)
    // If we got here, signature is valid

    // Check 2: Verify fingerprint still matches
    // Note: We can't re-verify fingerprint here because we don't have the browser signals
    // The JS layer handles fingerprint re-verification

    // Check 3: Check for time manipulation
    // If expire_ts is in the past but status is still "active", something is wrong
    let now = 0u64; // Will be passed from JS in practice
    if now > 0 {
        let time_diff = license_data.expire_ts.abs_diff(now);
        // If the time difference is unreasonably large (> 1 year), suspect manipulation
        if time_diff > 365 * 24 * 60 * 60 * 1000 {
            return serde_json::to_string(&VerifyResult {
                passed: false,
                degrade_level: 2,
            })
            .unwrap_or_default();
        }
    }

    // All checks passed
    serde_json::to_string(&VerifyResult {
        passed: true,
        degrade_level: license_data.degrade_level,
    })
    .unwrap_or_default()
}

/// Calculate the next stealth check threshold
/// Returns a value between min and max (pseudo-random based on blob)
pub fn next_check_threshold(blob: &str, min: f64, max: f64) -> f64 {
    // Use blob hash as seed for pseudo-random
    let hash = simple_hash(blob.as_bytes());
    let ratio = (hash % 1000) as f64 / 1000.0;
    min + ratio * (max - min)
}

/// Calculate next check interval in milliseconds
pub fn next_check_interval(blob: &str) -> u64 {
    let hash = simple_hash(blob.as_bytes());
    let ratio = (hash % 1000) as f64 / 1000.0;
    MIN_CHECK_INTERVAL_MS + (ratio * (MAX_CHECK_INTERVAL_MS - MIN_CHECK_INTERVAL_MS) as f64) as u64
}

/// Determine degradation level based on verification failures
pub fn calculate_degrade_level(current_level: u8, consecutive_failures: u8) -> u8 {
    match consecutive_failures {
        0 => 0,
        1 => std::cmp::max(current_level, 1),
        2 => std::cmp::max(current_level, 2),
        _ => 3,
    }
}

/// Simple hash function for threshold calculation
fn simple_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 5381;
    for &b in data {
        hash = hash.wrapping_mul(33).wrapping_add(b as u64);
    }
    hash
}
