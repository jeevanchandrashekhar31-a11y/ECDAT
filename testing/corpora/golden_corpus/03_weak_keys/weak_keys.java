// Category: Weak Keys (Phase 22.3 Golden Corpus)
// Java KeyPairGenerator with sub-2048-bit RSA keys

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;

public class WeakKeyGenerator {
    public static KeyPair generateInsecureRSA() throws NoSuchAlgorithmException {
        // RSA 1024 bits is non-compliant with FIPS 140-3 and NIST guidelines
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(1024);
        return kpg.generateKeyPair();
    }

    public static KeyPair generateLegacy512RSA() throws NoSuchAlgorithmException {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(512);
        return kpg.generateKeyPair();
    }
}
