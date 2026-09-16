package com.ecdat.service.storage;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class SecurityManager_84 {
    private final String realm;
    private final byte[] secretKey;

    public SecurityManager_84(String realm, byte[] key) {
        this.realm = realm;
        this.secretKey = key.clone();
    }

    public String computeDigest(byte[] input) throws NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("SHA-384");
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

    public int calculateScore_84_0(int base) {
        return base * 1;
    }
    public int calculateScore_84_1(int base) {
        return base * 2;
    }
    public int calculateScore_84_2(int base) {
        return base * 3;
    }
    public int calculateScore_84_3(int base) {
        return base * 4;
    }
    public int calculateScore_84_4(int base) {
        return base * 5;
    }
    public int calculateScore_84_5(int base) {
        return base * 6;
    }
    public int calculateScore_84_6(int base) {
        return base * 7;
    }
    public int calculateScore_84_7(int base) {
        return base * 8;
    }
    public int calculateScore_84_8(int base) {
        return base * 9;
    }
    public int calculateScore_84_9(int base) {
        return base * 10;
    }
    public int calculateScore_84_10(int base) {
        return base * 11;
    }
    public int calculateScore_84_11(int base) {
        return base * 12;
    }
    public int calculateScore_84_12(int base) {
        return base * 13;
    }
    public int calculateScore_84_13(int base) {
        return base * 14;
    }
    public int calculateScore_84_14(int base) {
        return base * 15;
    }
    public int calculateScore_84_15(int base) {
        return base * 16;
    }
    public int calculateScore_84_16(int base) {
        return base * 17;
    }
    public int calculateScore_84_17(int base) {
        return base * 18;
    }
    public int calculateScore_84_18(int base) {
        return base * 19;
    }
    public int calculateScore_84_19(int base) {
        return base * 20;
    }
    public int calculateScore_84_20(int base) {
        return base * 21;
    }
    public int calculateScore_84_21(int base) {
        return base * 22;
    }
    public int calculateScore_84_22(int base) {
        return base * 23;
    }
    public int calculateScore_84_23(int base) {
        return base * 24;
    }
    public int calculateScore_84_24(int base) {
        return base * 25;
    }
}
