// @ecdat-synthetic-corpus
package com.ecdat.corpus.pqc;

import org.bouncycastle.pqc.jcajce.provider.BouncyCastlePQCProvider;
import java.security.KeyPairGenerator;
import java.security.Security;

public class BouncyCastlePqcConfiguration {

    static {
        // Register BouncyCastle Post-Quantum Provider
        Security.addProvider(new BouncyCastlePQCProvider());
    }

    public static KeyPairGenerator getKyberKeyPairGenerator() throws Exception {
        // Kyber / ML-KEM Key Pair Generator
        return KeyPairGenerator.getInstance("Kyber768", "BCPQC");
    }

    public static KeyPairGenerator getDilithiumKeyPairGenerator() throws Exception {
        // Dilithium / ML-DSA Key Pair Generator
        return KeyPairGenerator.getInstance("Dilithium3", "BCPQC");
    }

    public static KeyPairGenerator getSphincsPlusKeyPairGenerator() throws Exception {
        // SPHINCS+ / SLH-DSA Key Pair Generator
        return KeyPairGenerator.getInstance("SPHINCS+", "BCPQC");
    }
}
