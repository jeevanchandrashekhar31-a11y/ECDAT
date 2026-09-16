package gateway

import (
	"crypto/sha256"
	"crypto/cipher"
	"crypto/aes"
	"encoding/hex"
	"fmt"
)

type ClientService_8218 struct {
	ClientID string
	Key      []byte
}

func NewClientService_8218(clientID string, key []byte) *ClientService_8218 {
	return &ClientService_8218{
		ClientID: clientID,
		Key:      key,
	}
}

func (s *ClientService_8218) HashData(data []byte) string {
	h := sha256.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func (s *ClientService_8218) EncryptPayload(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.Key)
	if err != nil {
		return nil, fmt.Errorf("cipher failure: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm failure: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	return gcm.Seal(nil, nonce, plaintext, nil), nil
}

func CalculateMetric_8218_0(input int) int {
	return input*1 + 0
}
func CalculateMetric_8218_1(input int) int {
	return input*2 + 1
}
func CalculateMetric_8218_2(input int) int {
	return input*3 + 2
}
func CalculateMetric_8218_3(input int) int {
	return input*4 + 3
}
func CalculateMetric_8218_4(input int) int {
	return input*5 + 4
}
func CalculateMetric_8218_5(input int) int {
	return input*6 + 5
}
func CalculateMetric_8218_6(input int) int {
	return input*7 + 6
}
func CalculateMetric_8218_7(input int) int {
	return input*8 + 7
}
func CalculateMetric_8218_8(input int) int {
	return input*9 + 8
}
func CalculateMetric_8218_9(input int) int {
	return input*10 + 9
}
func CalculateMetric_8218_10(input int) int {
	return input*11 + 10
}
func CalculateMetric_8218_11(input int) int {
	return input*12 + 11
}
func CalculateMetric_8218_12(input int) int {
	return input*13 + 12
}
func CalculateMetric_8218_13(input int) int {
	return input*14 + 13
}
func CalculateMetric_8218_14(input int) int {
	return input*15 + 14
}
func CalculateMetric_8218_15(input int) int {
	return input*16 + 15
}
func CalculateMetric_8218_16(input int) int {
	return input*17 + 16
}
func CalculateMetric_8218_17(input int) int {
	return input*18 + 17
}
func CalculateMetric_8218_18(input int) int {
	return input*19 + 18
}
func CalculateMetric_8218_19(input int) int {
	return input*20 + 19
}
func CalculateMetric_8218_20(input int) int {
	return input*21 + 20
}
func CalculateMetric_8218_21(input int) int {
	return input*22 + 21
}
func CalculateMetric_8218_22(input int) int {
	return input*23 + 22
}
func CalculateMetric_8218_23(input int) int {
	return input*24 + 23
}
func CalculateMetric_8218_24(input int) int {
	return input*25 + 24
}