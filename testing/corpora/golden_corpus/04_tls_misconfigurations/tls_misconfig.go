// @ecdat-synthetic-corpus
/**
 * Golden Corpus Fixture: 04_tls_misconfigurations/tls_misconfig.go
 * Category: 04_tls_misconfigurations
 * Go implementation of insecure TLS configurations:
 * - InsecureSkipVerify: true (disables certificate validation)
 * - MinVersion: tls.VersionTLS10 (deprecated TLS 1.0 protocol)
 */

package main

import (
	"crypto/tls"
	"net/http"
)

func createInsecureClient() *http.Client {
	// Insecure: Disables certificate chain validation and permits deprecated TLSv1.0
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
			MinVersion:         tls.VersionTLS10,
		},
	}
	return &http.Client{Transport: tr}
}
