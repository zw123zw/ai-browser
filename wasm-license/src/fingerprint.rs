use crate::crypto;

/// Generate stable fingerprint from browser hardware signals
/// No timestamp included - same device always produces same fingerprint
pub fn generate(
    runtime_id: &str,
    user_agent: &str,
    platform: &str,
    screen: &str,
    cores: &str,
    memory: &str,
    timezone: &str,
    language: &str,
) -> String {
    let signals = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        runtime_id, user_agent, platform, screen, cores, memory, timezone, language
    );
    let hash = crypto::sha256(signals.as_bytes());
    hex_encode(&hash)
}

/// Verify that a fingerprint matches the current device signals
pub fn verify(
    stored_fingerprint: &str,
    runtime_id: &str,
    user_agent: &str,
    platform: &str,
    screen: &str,
    cores: &str,
    memory: &str,
    timezone: &str,
    language: &str,
) -> bool {
    let current = generate(runtime_id, user_agent, platform, screen, cores, memory, timezone, language);
    current == stored_fingerprint
}

/// Encode bytes as lowercase hex string
fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}
