// @ecdat-synthetic-corpus
/**
 * Golden Corpus Fixture: 07_hybrid_examples/hybrid_crypto.go
 * Category: 07_hybrid_examples
 * Go implementation of post-quantum hybrid key exchange:
 * - X25519 + ML-KEM-768 (X25519Kyber768 / X25519MLKEM768 draft)
 * - Combines classical elliptic curve Diffie-Hellman with lattice-based KEM
 */

package main

import (
	"crypto/rand"
	"golang.org/x/crypto/curve25519"
)

type HybridPQCSession struct {
	ClassicalAlgo string
	QuantumAlgo   string
	HybridID      string
}

func NewHybridPQCSession() *HybridPQCSession {
	return &HybridPQCSession{
		ClassicalAlgo: "X25519",
		QuantumAlgo:   "ML-KEM-768",
		HybridID:      "X25519Kyber768Draft00",
	}
}

func (s *HybridPQCSession) GenerateClassicalShare() ([]byte, []byte, error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return nil, nil, err
	}
	var pub [32]byte
	curve25519.ScalarBaseMult(&pub, &priv)
	return priv[:], pub[:], nil
}
