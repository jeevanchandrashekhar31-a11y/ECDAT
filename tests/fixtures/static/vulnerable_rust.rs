// Comprehensive Insecure Rust Test Fixture (Phase 2.7)
use md5::{Md5, Digest};
use des::Des;
use blowfish::Blowfish;

fn main() {
    // 1. Weak Hash: RustCrypto MD5 (OBSERVED / REACHABLE)
    let mut hasher = Md5::new();
    hasher.update(b"vulnerable payload");
    let result = hasher.finalize();
    println!("MD5: {:x}", result);

    // 2. Weak Ciphers: DES & Blowfish (OBSERVED / REACHABLE)
    let _des_cipher = Des::new(&[0u8; 8].into());
    let _bf_cipher = Blowfish::new(&[0u8; 16]);

    // Note: Cargo.toml also declares 'p256', 'chacha20poly1305', 'rustls'
    // which are PRESENT in dependencies but NOT actively invoked in this function.
}
