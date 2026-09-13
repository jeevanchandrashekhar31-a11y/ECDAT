// Comprehensive Insecure Go Test Fixture (Phase 2.5)
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/des"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/tls"
	"crypto/x509"
	"fmt"

	bf "golang.org/x/crypto/blowfish"
)

const (
	WeakRsaKeySize = 1024
	InsecureTLSVal = true
)

func main() {
	// 1. Weak Hashes: MD5 & SHA-1
	h1 := md5.New()
	h1.Write([]byte("data"))
	fmt.Printf("MD5: %x\n", h1.Sum(nil))

	h2 := sha1.New()
	h2.Write([]byte("data"))
	fmt.Printf("SHA1: %x\n", h2.Sum(nil))

	// 2. Insecure HMAC with MD5
	key := []byte("secret-key")
	mac := hmac.New(md5.New, key)
	mac.Write([]byte("message"))

	// 3. Weak RSA Key Generation (<2048) & Legacy PKCS#1 v1.5 Padding
	privKey, err := rsa.GenerateKey(rand.Reader, WeakRsaKeySize)
	if err == nil {
		hashed := md5.Sum([]byte("test"))
		_, _ = rsa.SignPKCS1v15(rand.Reader, privKey, 0, hashed[:])
	}

	// 4. Weak Elliptic Curve P-224
	_, _ = ecdsa.GenerateKey(elliptic.P224(), rand.Reader)

	// 5. Weak Ciphers: DES and Blowfish (correlated with go.mod)
	_, _ = des.NewCipher([]byte("12345678"))
	_, _ = bf.NewCipher([]byte("blowfish-key-16b"))

	// 6. CBC Cipher Mode without built-in authentication
	block, _ := aes.NewCipher(make([]byte, 16))
	_ = cipher.NewCBCEncrypter(block, make([]byte, 16))

	// 7. Insecure TLS Configuration: Disabled verification & TLS 1.0
	tlsCfg := &tls.Config{
		InsecureSkipVerify: InsecureTLSVal,
		MinVersion:         tls.VersionTLS10,
	}
	_ = tlsCfg

	// 8. Broken Certificate Signature Algorithm (MD5WithRSA)
	template := &x509.Certificate{
		SignatureAlgorithm: x509.MD5WithRSA,
	}
	_ = template
}
