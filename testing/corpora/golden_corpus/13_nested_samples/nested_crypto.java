// @ecdat-synthetic-corpus
package com.ecdat.corpus.nested;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.security.MessageDigest;
import java.util.concurrent.Callable;

public class OuterSecurityContainer {

    public static class NestedCryptoProvider {
        public static class DeepCipherFactory {
            public Cipher createAesCipher() throws Exception {
                // Nested static class AES cipher instantiation
                return Cipher.getInstance("AES/GCM/NoPadding");
            }
        }
    }

    public Callable<byte[]> createAnonymousDigestWorker(final byte[] input) {
        // Anonymous inner class encapsulating SHA-512 digest
        return new Callable<byte[]>() {
            @Override
            public byte[] call() throws Exception {
                MessageDigest md = MessageDigest.getInstance("SHA-512");
                return md.digest(input);
            }
        };
    }

    public Runnable createLambdaCryptoWorker(final SecretKey key) {
        // Lambda expression encapsulating AES cipher initialization
        return () -> {
            try {
                Cipher c = Cipher.getInstance("AES");
                c.init(Cipher.ENCRYPT_MODE, key);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
    }
}
