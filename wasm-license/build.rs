use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Read build seed from .build-seed file, or use a default for development
    let seed_path = Path::new("../.build-seed");
    let seed = if seed_path.exists() {
        fs::read_to_string(seed_path)
            .expect("Failed to read .build-seed")
            .trim()
            .to_string()
    } else {
        // Default seed for development (not for production builds)
        "dev-default-seed-do-not-use-in-production".to_string()
    };

    println!("cargo:rustc-env=BUILD_SEED={}", seed);

    // Re-run if .build-seed changes
    println!("cargo:rerun-if-changed=../.build-seed");
}
