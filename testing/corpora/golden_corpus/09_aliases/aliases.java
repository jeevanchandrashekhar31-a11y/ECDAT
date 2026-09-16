// Category: Algorithm Aliases (Phase 22.3 Golden Corpus)
// Java cryptographic provider aliases

import javax.crypto.Cipher;
import javax.crypto.Mac;
import java.security.Signature;

public class JavaCryptoAliases {
    public static void initializeAliasedEngines() throws Exception {
        // Alias for AES in CBC mode with PKCS5 padding
        Cipher c1 = Cipher.getInstance("AES/CBC/PKCS5Padding");

        // Alias for 3DES / Triple-DES
        Cipher c2 = Cipher.getInstance("DESede/ECB/PKCS5Padding");

        // Combined signature algorithm alias
        Signature sig = Signature.getInstance("SHA256withRSA");

        // HMAC SHA-256 MAC alias
        Mac mac = Mac.getInstance("HmacSHA256");
    }
}
