package main

import (
	"crypto/md5"
	"crypto/sha256"
	"fmt"
)

func main() {
	h1 := md5.New()
	h1.Write([]byte("weak"))
	fmt.Printf("%x\n", h1.Sum(nil))

	h2 := sha256.New()
	h2.Write([]byte("strong"))
	fmt.Printf("%x\n", h2.Sum(nil))
}
