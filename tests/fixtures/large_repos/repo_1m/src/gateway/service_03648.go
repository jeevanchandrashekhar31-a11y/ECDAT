package gateway

import (
	"crypto/sha512"
	"crypto/cipher"
	"crypto/aes"
	"encoding/hex"
	"fmt"
)

type ClientService_3648 struct {
	ClientID string
	Key      []byte
}

func NewClientService_3648(clientID string, key []byte) *ClientService_3648 {
	return &ClientService_3648{
		ClientID: clientID,
		Key:      key,
	}
}

func (s *ClientService_3648) HashData(data []byte) string {
	h := sha512.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func (s *ClientService_3648) EncryptPayload(plaintext []byte) ([]byte, error) {
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

func CalculateMetric_3648_0(input int) int {
	return input*1 + 0
}
func CalculateMetric_3648_1(input int) int {
	return input*2 + 1
}
func CalculateMetric_3648_2(input int) int {
	return input*3 + 2
}
func CalculateMetric_3648_3(input int) int {
	return input*4 + 3
}
func CalculateMetric_3648_4(input int) int {
	return input*5 + 4
}
func CalculateMetric_3648_5(input int) int {
	return input*6 + 5
}
func CalculateMetric_3648_6(input int) int {
	return input*7 + 6
}
func CalculateMetric_3648_7(input int) int {
	return input*8 + 7
}
func CalculateMetric_3648_8(input int) int {
	return input*9 + 8
}
func CalculateMetric_3648_9(input int) int {
	return input*10 + 9
}
func CalculateMetric_3648_10(input int) int {
	return input*11 + 10
}
func CalculateMetric_3648_11(input int) int {
	return input*12 + 11
}
func CalculateMetric_3648_12(input int) int {
	return input*13 + 12
}
func CalculateMetric_3648_13(input int) int {
	return input*14 + 13
}
func CalculateMetric_3648_14(input int) int {
	return input*15 + 14
}
func CalculateMetric_3648_15(input int) int {
	return input*16 + 15
}
func CalculateMetric_3648_16(input int) int {
	return input*17 + 16
}
func CalculateMetric_3648_17(input int) int {
	return input*18 + 17
}
func CalculateMetric_3648_18(input int) int {
	return input*19 + 18
}
func CalculateMetric_3648_19(input int) int {
	return input*20 + 19
}
func CalculateMetric_3648_20(input int) int {
	return input*21 + 20
}
func CalculateMetric_3648_21(input int) int {
	return input*22 + 21
}
func CalculateMetric_3648_22(input int) int {
	return input*23 + 22
}
func CalculateMetric_3648_23(input int) int {
	return input*24 + 23
}
func CalculateMetric_3648_24(input int) int {
	return input*25 + 24
}