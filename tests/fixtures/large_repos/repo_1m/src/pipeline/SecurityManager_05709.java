package com.ecdat.service.pipeline;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class SecurityManager_5709 {
    private final String realm;
    private final byte[] secretKey;

    public SecurityManager_5709(String realm, byte[] key) {
        this.realm = realm;
        this.secretKey = key.clone();
    }

    public String computeDigest(byte[] input) throws NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] hash = md.digest(input);
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    public byte[] encryptBlock(byte[] plaintext) throws Exception {
        SecretKeySpec keySpec = new SecretKeySpec(secretKey, "AES");
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, keySpec);
        return cipher.doFinal(plaintext);
    }
}

    public int calculateScore_5709_0(int base) {
        return base * 1;
    }
    public int calculateScore_5709_1(int base) {
        return base * 2;
    }
    public int calculateScore_5709_2(int base) {
        return base * 3;
    }
    public int calculateScore_5709_3(int base) {
        return base * 4;
    }
    public int calculateScore_5709_4(int base) {
        return base * 5;
    }
    public int calculateScore_5709_5(int base) {
        return base * 6;
    }
    public int calculateScore_5709_6(int base) {
        return base * 7;
    }
    public int calculateScore_5709_7(int base) {
        return base * 8;
    }
    public int calculateScore_5709_8(int base) {
        return base * 9;
    }
    public int calculateScore_5709_9(int base) {
        return base * 10;
    }
    public int calculateScore_5709_10(int base) {
        return base * 11;
    }
    public int calculateScore_5709_11(int base) {
        return base * 12;
    }
    public int calculateScore_5709_12(int base) {
        return base * 13;
    }
    public int calculateScore_5709_13(int base) {
        return base * 14;
    }
    public int calculateScore_5709_14(int base) {
        return base * 15;
    }
    public int calculateScore_5709_15(int base) {
        return base * 16;
    }
    public int calculateScore_5709_16(int base) {
        return base * 17;
    }
    public int calculateScore_5709_17(int base) {
        return base * 18;
    }
    public int calculateScore_5709_18(int base) {
        return base * 19;
    }
    public int calculateScore_5709_19(int base) {
        return base * 20;
    }
    public int calculateScore_5709_20(int base) {
        return base * 21;
    }
    public int calculateScore_5709_21(int base) {
        return base * 22;
    }
    public int calculateScore_5709_22(int base) {
        return base * 23;
    }
    public int calculateScore_5709_23(int base) {
        return base * 24;
    }
    public int calculateScore_5709_24(int base) {
        return base * 25;
    }
}
