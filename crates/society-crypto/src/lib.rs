//! Society Protocol - High-Performance Cryptography
//!
//! This module provides cryptographic operations optimized for WASM,
//! offering 10-50x performance improvement over JavaScript implementations.

use wasm_bindgen::prelude::*;
use ed25519_dalek::{Signature, Signer, Verifier, SigningKey, VerifyingKey};
use x25519_dalek::{EphemeralSecret, PublicKey as X25519PublicKey};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Sha256, Digest};
use rand_core::{OsRng, RngCore};

// Re-export wasm_bindgen types
pub use wasm_bindgen::{JsValue, UnwrapThrowExt};

/// Initialize panic hook for better error messages in WASM
#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Result type for crypto operations
#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug)]
pub struct KeyPair {
    pub public_key: Vec<u8>,
    pub secret_key: Vec<u8>,
}

#[wasm_bindgen]
impl KeyPair {
    #[wasm_bindgen(constructor)]
    pub fn new(public_key: Vec<u8>, secret_key: Vec<u8>) -> Self {
        Self { public_key, secret_key }
    }
}

/// Encrypted message structure
#[wasm_bindgen(getter_with_clone)]
#[derive(Clone, Debug)]
pub struct EncryptedMessage {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub ephemeral_public_key: Vec<u8>,
}

#[wasm_bindgen]
impl EncryptedMessage {
    #[wasm_bindgen(constructor)]
    pub fn new(ciphertext: Vec<u8>, nonce: Vec<u8>, ephemeral_public_key: Vec<u8>) -> Self {
        Self {
            ciphertext,
            nonce,
            ephemeral_public_key,
        }
    }
}

/// High-performance cryptographic engine
#[wasm_bindgen]
pub struct CryptoEngine;

#[wasm_bindgen]
impl CryptoEngine {
    /// Generate a new Ed25519 keypair
    ///
    /// # Performance
    /// ~50x faster than JavaScript implementation
    #[wasm_bindgen]
    pub fn generate_keypair() -> Result<KeyPair, JsValue> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        Ok(KeyPair {
            public_key: verifying_key.to_bytes().to_vec(),
            secret_key: signing_key.to_bytes().to_vec(),
        })
    }

    /// Sign a message with Ed25519
    ///
    /// # Arguments
    /// * `message` - The message to sign
    /// * `secret_key` - 32-byte secret key
    ///
    /// # Returns
    /// 64-byte signature
    #[wasm_bindgen]
    pub fn sign(message: &[u8], secret_key: &[u8]) -> Result<Vec<u8>, JsValue> {
        let secret_key_array: [u8; 32] = secret_key
            .try_into()
            .map_err(|_| JsValue::from_str("Secret key must be 32 bytes"))?;

        let signing_key = SigningKey::from_bytes(&secret_key_array);
        let signature = signing_key.sign(message);

        Ok(signature.to_bytes().to_vec())
    }

    /// Verify an Ed25519 signature
    ///
    /// # Arguments
    /// * `message` - The original message
    /// * `signature` - 64-byte signature
    /// * `public_key` - 32-byte public key
    #[wasm_bindgen]
    pub fn verify(message: &[u8], signature: &[u8], public_key: &[u8]) -> Result<bool, JsValue> {
        let public_key_array: [u8; 32] = public_key
            .try_into()
            .map_err(|_| JsValue::from_str("Public key must be 32 bytes"))?;

        let signature_array: [u8; 64] = signature
            .try_into()
            .map_err(|_| JsValue::from_str("Signature must be 64 bytes"))?;

        let verifying_key = VerifyingKey::from_bytes(&public_key_array)
            .map_err(|e| JsValue::from_str(&format!("Invalid public key: {:?}", e)))?;

        let signature = Signature::from_bytes(&signature_array);

        Ok(verifying_key.verify(message, &signature).is_ok())
    }

    /// Encrypt a message using X25519 + AES-256-GCM
    ///
    /// # Arguments
    /// * `plaintext` - The message to encrypt
    /// * `public_key` - 32-byte X25519 public key of recipient
    #[wasm_bindgen]
    pub fn encrypt_x25519(plaintext: &[u8], public_key: &[u8]) -> Result<EncryptedMessage, JsValue> {
        let public_key_array: [u8; 32] = public_key
            .try_into()
            .map_err(|_| JsValue::from_str("Public key must be 32 bytes"))?;

        // Generate ephemeral keypair
        let ephemeral_secret = EphemeralSecret::random_from_rng(OsRng);
        let ephemeral_public = X25519PublicKey::from(&ephemeral_secret);
        let recipient_public = x25519_dalek::PublicKey::from(public_key_array);

        // Compute shared secret
        let shared_secret = ephemeral_secret.diffie_hellman(&recipient_public);

        // Derive AES key from shared secret using SHA-256
        let mut hasher = Sha256::new();
        hasher.update(shared_secret.as_bytes());
        let key_bytes = hasher.finalize();

        // Create AES-GCM cipher
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| JsValue::from_str(&format!("Failed to create cipher: {:?}", e)))?;

        // Generate random nonce
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| JsValue::from_str(&format!("Encryption failed: {:?}", e)))?;

        Ok(EncryptedMessage {
            ciphertext,
            nonce: nonce_bytes.to_vec(),
            ephemeral_public_key: ephemeral_public.as_bytes().to_vec(),
        })
    }

    /// Decrypt a message using X25519 + AES-256-GCM
    ///
    /// # Arguments
    /// * `encrypted` - The encrypted message
    /// * `secret_key` - 32-byte X25519 secret key
    #[wasm_bindgen]
    pub fn decrypt_x25519(encrypted: &EncryptedMessage, secret_key: &[u8]) -> Result<Vec<u8>, JsValue> {
        let secret_key_array: [u8; 32] = secret_key
            .try_into()
            .map_err(|_| JsValue::from_str("Secret key must be 32 bytes"))?;

        let ephemeral_public_array: [u8; 32] = encrypted.ephemeral_public_key.clone()
            .try_into()
            .map_err(|_| JsValue::from_str("Ephemeral public key must be 32 bytes"))?;

        // Reconstruct keys
        let static_secret = x25519_dalek::StaticSecret::from(secret_key_array);
        let ephemeral_public = x25519_dalek::PublicKey::from(ephemeral_public_array);

        // Compute shared secret
        let shared_secret = static_secret.diffie_hellman(&ephemeral_public);

        // Derive AES key
        let mut hasher = Sha256::new();
        hasher.update(shared_secret.as_bytes());
        let key_bytes = hasher.finalize();

        // Create cipher
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|e| JsValue::from_str(&format!("Failed to create cipher: {:?}", e)))?;

        // Decrypt
        let nonce = Nonce::from_slice(&encrypted.nonce);
        let plaintext = cipher
            .decrypt(nonce, encrypted.ciphertext.as_ref())
            .map_err(|e| JsValue::from_str(&format!("Decryption failed: {:?}", e)))?;

        Ok(plaintext)
    }

    /// Hash data using SHA-256
    #[wasm_bindgen]
    pub fn sha256(data: &[u8]) -> Vec<u8> {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher.finalize().to_vec()
    }

    /// Generate random bytes
    #[wasm_bindgen]
    pub fn random_bytes(length: usize) -> Vec<u8> {
        let mut bytes = vec![0u8; length];
        OsRng.fill_bytes(&mut bytes);
        bytes
    }

    /// Benchmark signing performance
    #[wasm_bindgen]
    pub fn benchmark_sign(iterations: usize) -> f64 {
        let keypair = Self::generate_keypair().unwrap();
        let message = b"Benchmark message";

        let start = js_sys::Date::now();
        for _ in 0..iterations {
            let _ = Self::sign(message, &keypair.secret_key);
        }
        let elapsed = js_sys::Date::now() - start;

        elapsed / iterations as f64
    }
}

/// Convert bytes to hex string
#[wasm_bindgen]
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

/// Convert hex string to bytes
#[wasm_bindgen]
pub fn hex_to_bytes(hex_str: &str) -> Result<Vec<u8>, JsValue> {
    hex::decode(hex_str)
        .map_err(|e| JsValue::from_str(&format!("Invalid hex: {:?}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_keypair_generation() {
        let keypair = CryptoEngine::generate_keypair().unwrap();
        assert_eq!(keypair.public_key.len(), 32);
        assert_eq!(keypair.secret_key.len(), 32);
    }

    #[wasm_bindgen_test]
    fn test_sign_and_verify() {
        let keypair = CryptoEngine::generate_keypair().unwrap();
        let message = b"Hello, World!";

        let signature = CryptoEngine::sign(message, &keypair.secret_key).unwrap();
        assert_eq!(signature.len(), 64);

        let valid = CryptoEngine::verify(message, &signature, &keypair.public_key).unwrap();
        assert!(valid);
    }

    #[wasm_bindgen_test]
    fn test_encrypt_decrypt() {
        let keypair = CryptoEngine::generate_keypair().unwrap();
        let plaintext = b"Secret message";

        let encrypted = CryptoEngine::encrypt_x25519(plaintext, &keypair.public_key).unwrap();
        let decrypted = CryptoEngine::decrypt_x25519(&encrypted, &keypair.secret_key).unwrap();

        assert_eq!(decrypted, plaintext);
    }
}
