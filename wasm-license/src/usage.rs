use serde::{Deserialize, Serialize};

/// Usage statistics stored in encrypted blob
#[derive(Serialize, Deserialize, Clone)]
pub struct UsageBlob {
    pub total_hours: f64,
    pub total_actions: u32,
    pub daily_used: u32,
    pub daily_reset_date: String,
    pub last_tick_ts: u64,
    pub next_check_threshold: f64,
}

/// Track usage and determine if stealth check should trigger
pub fn track_usage(blob: &str, action: &str, ts: u64) -> String {
    // Parse usage data from blob (simplified - in production this reads from encrypted storage)
    // For now, return a basic response
    let should_check = should_trigger_check(blob, ts);

    format!(
        r#"{{"totalHours":0,"totalActions":0,"shouldCheck":{}}}"#,
        should_check
    )
}

/// Determine if a stealth check should be triggered
fn should_trigger_check(blob: &str, ts: u64) -> bool {
    // Use a deterministic but unpredictable trigger based on timestamp
    // This creates a ~5% chance per tick
    let hash = simple_hash(blob.as_bytes());
    let ts_hash = simple_hash(&ts.to_le_bytes());
    let combined = hash.wrapping_add(ts_hash);
    (combined % 100) < 5
}

/// Simple hash function
fn simple_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 5381;
    for &b in data {
        hash = hash.wrapping_mul(33).wrapping_add(b as u64);
    }
    hash
}
