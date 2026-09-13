package com.example.crypto;

import java.security.*;
import javax.crypto.*;
import javax.net.ssl.*;
import java.security.cert.X509Certificate;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class InsecureCrypto {
    public void testInsecureJca() throws Exception {
        Security.addProvider(new BouncyCastleProvider());

        // 1. Insecure Ciphers & Modes
        String weakCipherAlgo = "DES/ECB/PKCS5Padding";
        Cipher c1 = Cipher.getInstance(weakCipherAlgo, "BC");
        Cipher c2 = Cipher.getInstance("AES/ECB/NoPadding");

        // 2. Weak Hashes & Mac
        MessageDigest md1 = MessageDigest.getInstance("MD5");
        MessageDigest md2 = MessageDigest.getInstance("SHA-1");
        Mac mac = Mac.getInstance("HmacMD5");

        // 3. Weak Signature
        Signature sig = Signature.getInstance("SHA1withRSA");

        // 4. Weak Key Generator & KeyPairGenerator with small key size
        KeyGenerator kg = KeyGenerator.getInstance("DES");
        int weakKeySize = 1024;
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(weakKeySize);

        // 5. Weak SecretKeyFactory
        SecretKeyFactory skf = SecretKeyFactory.getInstance("PBEWithMD5AndDES");

        // 6. Insecure TLS & KeyStore
        SSLContext sslContext = SSLContext.getInstance("TLSv1.0");
        KeyStore ks = KeyStore.getInstance("JKS");
    }

    // 7. TrustManager Bypass
    public static class BlindTrustManager implements X509TrustManager {
        public X509Certificate[] getAcceptedIssuers() { return null; }
        public void checkClientTrusted(X509Certificate[] certs, String authType) {}
        public void checkServerTrusted(X509Certificate[] certs, String authType) {
            // Empty body trusts any server cert
        }
    }

    // 8. HostnameVerifier Bypass
    public static HostnameVerifier trustAllHostnames() {
        return new HostnameVerifier() {
            public boolean verify(String hostname, SSLSession session) {
                return true;
            }
        };
    }
}
