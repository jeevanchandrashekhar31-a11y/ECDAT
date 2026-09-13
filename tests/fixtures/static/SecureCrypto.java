package com.example.crypto;

import java.security.*;
import javax.crypto.*;
import javax.net.ssl.*;

public class SecureCrypto {
    public void testSecureJca() throws Exception {
        // 1. Secure Cipher: AES-GCM
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");

        // 2. Secure Hash & Mac
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        Mac mac = Mac.getInstance("HmacSHA256");

        // 3. Secure Signature
        Signature sig = Signature.getInstance("SHA256withRSA");

        // 4. Secure KeyPairGenerator size (>= 2048)
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(3072);

        // 5. Secure TLS Context & KeyStore
        SSLContext sslContext = SSLContext.getInstance("TLSv1.3");
        KeyStore ks = KeyStore.getInstance("PKCS12");
    }
}
