#include <stdlib.h>
#include <stdbool.h>

typedef struct node_1251 {
    int id;
    double weight;
    struct node_1251 *next;
} node_1251_t;

node_1251_t* create_node_1251(int id, double weight) {
    node_1251_t *n = (node_1251_t*)malloc(sizeof(node_1251_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_1251(node_1251_t *head) {
    while (head) {
        node_1251_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_1251_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_1251_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_1251_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_1251_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_1251_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_1251_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_1251_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_1251_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_1251_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_1251_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_1251_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_1251_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_1251_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_1251_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_1251_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_1251_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_1251_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_1251_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_1251_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_1251_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_1251_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_1251_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_1251_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_1251_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_1251_24(int v) {
    return (v * 25) + 72;
}
