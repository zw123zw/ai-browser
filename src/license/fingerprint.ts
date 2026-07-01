/**
 * Stable Device Fingerprint Generator
 *
 * Generates a deterministic fingerprint from hardware signals.
 * No timestamps included - same device always produces same fingerprint.
 * Uninstall/reinstall does NOT reset the trial period.
 */

/**
 * Generate stable device fingerprint from browser hardware signals
 * Uses only signals that remain constant across installs on the same device
 */
export async function stableFingerprint(): Promise<string> {
  const signals = [
    chrome.runtime.id, // Extension ID (fixed for this extension)
    navigator.userAgent, // Browser user agent
    navigator.platform, // OS platform ("Win32", "MacIntel", etc.)
    `${screen.width}x${screen.height}x${screen.colorDepth}`, // Screen parameters
    (navigator.hardwareConcurrency || 0).toString(), // CPU core count
    ((navigator as any).deviceMemory || 0).toString(), // Device memory (Chrome only)
    Intl.DateTimeFormat().resolvedOptions().timeZone, // Timezone
    navigator.language, // Language
  ].join('|');

  // SHA-256 hash
  const msgBuffer = new TextEncoder().encode(signals);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate fingerprint using Wasm module (if available)
 * Falls back to pure JS implementation
 */
export async function generateFingerprint(wasmModule?: any): Promise<string> {
  if (wasmModule?.generate_fingerprint) {
    return wasmModule.generate_fingerprint(
      chrome.runtime.id,
      navigator.userAgent,
      navigator.platform,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      (navigator.hardwareConcurrency || 0).toString(),
      ((navigator as any).deviceMemory || 0).toString(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
    );
  }
  return stableFingerprint();
}
