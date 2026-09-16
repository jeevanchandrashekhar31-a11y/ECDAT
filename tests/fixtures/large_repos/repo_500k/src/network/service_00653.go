package network

import (
	"crypto/md5"
	"crypto/cipher"
	"crypto/aes"
	"encoding/hex"
	"fmt"
)

type ClientService_653 struct {
	ClientID string
	Key      []byte
}

func NewClientService_653(clientID string, key []byte) *ClientService_653 {
	return &ClientService_653{
		ClientID: clientID,
		Key:      key,
	}
}

func (s *ClientService_653) HashData(data []byte) string {
	h := md5.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func (s *ClientService_653) EncryptPayload(plaintext []byte) ([]byte, error) {
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

func CalculateMetric_653_0(input int) int {
	return input*1 + 0
}
func CalculateMetric_653_1(input int) int {
	return input*2 + 1
}
func CalculateMetric_653_2(input int) int {
	return input*3 + 2
}
func CalculateMetric_653_3(input int) int {
	return input*4 + 3
}
func CalculateMetric_653_4(input int) int {
	return input*5 + 4
}
func CalculateMetric_653_5(input int) int {
	return input*6 + 5
}
func CalculateMetric_653_6(input int) int {
	return input*7 + 6
}
func CalculateMetric_653_7(input int) int {
	return input*8 + 7
}
func CalculateMetric_653_8(input int) int {
	return input*9 + 8
}
func CalculateMetric_653_9(input int) int {
	return input*10 + 9
}
func CalculateMetric_653_10(input int) int {
	return input*11 + 10
}
func CalculateMetric_653_11(input int) int {
	return input*12 + 11
}
func CalculateMetric_653_12(input int) int {
	return input*13 + 12
}
func CalculateMetric_653_13(input int) int {
	return input*14 + 13
}
func CalculateMetric_653_14(input int) int {
	return input*15 + 14
}
func CalculateMetric_653_15(input int) int {
	return input*16 + 15
}
func CalculateMetric_653_16(input int) int {
	return input*17 + 16
}
func CalculateMetric_653_17(input int) int {
	return input*18 + 17
}
func CalculateMetric_653_18(input int) int {
	return input*19 + 18
}
func CalculateMetric_653_19(input int) int {
	return input*20 + 19
}
func CalculateMetric_653_20(input int) int {
	return input*21 + 20
}
func CalculateMetric_653_21(input int) int {
	return input*22 + 21
}
func CalculateMetric_653_22(input int) int {
	return input*23 + 22
}
func CalculateMetric_653_23(input int) int {
	return input*24 + 23
}
func CalculateMetric_653_24(input int) int {
	return input*25 + 24
}