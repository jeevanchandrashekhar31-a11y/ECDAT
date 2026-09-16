package gateway

import (
	"crypto/md5"
	"crypto/cipher"
	"crypto/aes"
	"encoding/hex"
	"fmt"
)

type ClientService_58 struct {
	ClientID string
	Key      []byte
}

func NewClientService_58(clientID string, key []byte) *ClientService_58 {
	return &ClientService_58{
		ClientID: clientID,
		Key:      key,
	}
}

func (s *ClientService_58) HashData(data []byte) string {
	h := md5.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func (s *ClientService_58) EncryptPayload(plaintext []byte) ([]byte, error) {
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

func CalculateMetric_58_0(input int) int {
	return input*1 + 0
}
func CalculateMetric_58_1(input int) int {
	return input*2 + 1
}
func CalculateMetric_58_2(input int) int {
	return input*3 + 2
}
func CalculateMetric_58_3(input int) int {
	return input*4 + 3
}
func CalculateMetric_58_4(input int) int {
	return input*5 + 4
}
func CalculateMetric_58_5(input int) int {
	return input*6 + 5
}
func CalculateMetric_58_6(input int) int {
	return input*7 + 6
}
func CalculateMetric_58_7(input int) int {
	return input*8 + 7
}
func CalculateMetric_58_8(input int) int {
	return input*9 + 8
}
func CalculateMetric_58_9(input int) int {
	return input*10 + 9
}
func CalculateMetric_58_10(input int) int {
	return input*11 + 10
}
func CalculateMetric_58_11(input int) int {
	return input*12 + 11
}
func CalculateMetric_58_12(input int) int {
	return input*13 + 12
}
func CalculateMetric_58_13(input int) int {
	return input*14 + 13
}
func CalculateMetric_58_14(input int) int {
	return input*15 + 14
}
func CalculateMetric_58_15(input int) int {
	return input*16 + 15
}
func CalculateMetric_58_16(input int) int {
	return input*17 + 16
}
func CalculateMetric_58_17(input int) int {
	return input*18 + 17
}
func CalculateMetric_58_18(input int) int {
	return input*19 + 18
}
func CalculateMetric_58_19(input int) int {
	return input*20 + 19
}
func CalculateMetric_58_20(input int) int {
	return input*21 + 20
}
func CalculateMetric_58_21(input int) int {
	return input*22 + 21
}
func CalculateMetric_58_22(input int) int {
	return input*23 + 22
}
func CalculateMetric_58_23(input int) int {
	return input*24 + 23
}
func CalculateMetric_58_24(input int) int {
	return input*25 + 24
}