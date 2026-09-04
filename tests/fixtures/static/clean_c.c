#include <iostream>

void EVP_sha1();

class Crypto {
public:
    void do_something() {
        EVP_sha1();
    }
};

int main() {
    Crypto c;
    c.do_something();
    return 0;
}
