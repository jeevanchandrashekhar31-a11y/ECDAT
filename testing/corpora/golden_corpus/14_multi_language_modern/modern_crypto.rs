// @ecdat-synthetic-corpus
//! Golden Corpus Fixture: 14_multi_language_modern/modern_crypto.rs
//! Category: 14_multi_language_modern
//! Modern Rust cryptography leveraging `ring` and modern primitives:
//! - ChaCha20Poly1305 AEAD
//! - AES-256-GCM AEAD
//! - Ed25519 digital signatures
//! - SHA-512 cryptographic digest

use ring::aead::{self, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM, CHACHA20_POLY1305};
use ring::digest::{self, SHA512};
use ring::signature::{self, Ed25519KeyPair, KeyPair};

pub fn hash_payload(data: &[u8]) -> digest::Digest {
    digest::digest(&SHA512, data)
}

pub fn create_chacha_sealing_key(key_bytes: &[u8]) -> Result<UnboundKey, ring::error::Unspecified> {
    UnboundKey::new(&CHACHA20_POLY1305, key_bytes)
}

pub fn create_aes_gcm_key(key_bytes: &[u8]) -> Result<UnboundKey, ring::error::Unspecified> {
    UnboundKey::new(&AES_256_GCM, key_bytes)
}

pub fn generate_ed25519_keypair(rng: &ring::rand::SystemRandom) -> Result<Ed25519KeyPair, ring::error::Unspecified> {
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(rng)?;
    Ed25519KeyPair::from_pkcs8(pkcs8.as_ref())
}
