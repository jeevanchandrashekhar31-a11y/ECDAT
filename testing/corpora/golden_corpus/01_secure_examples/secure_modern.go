package main

// Category: Secure Examples (Phase 22.3 Golden Corpus)
// Go crypto primitives:
// - AES-GCM (crypto/cipher)
// - Ed25519 (crypto/ed25519)
// - SHA-512 (crypto/sha512)

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha512"
	"io"
)

func EncryptAESGCM(plaintext, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func HashSHA512(data []byte) [64]byte {
	return sha512.Sum512(data)
}

func SignEd25519(priv ed25519.PrivateKey, message []byte) []byte {
	return ed25519.Sign(priv, message)
}
