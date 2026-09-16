#include <stdlib.h>
#include <stdbool.h>

typedef struct node_1931 {
    int id;
    double weight;
    struct node_1931 *next;
} node_1931_t;

node_1931_t* create_node_1931(int id, double weight) {
    node_1931_t *n = (node_1931_t*)malloc(sizeof(node_1931_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_1931(node_1931_t *head) {
    while (head) {
        node_1931_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_1931_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_1931_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_1931_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_1931_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_1931_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_1931_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_1931_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_1931_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_1931_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_1931_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_1931_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_1931_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_1931_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_1931_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_1931_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_1931_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_1931_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_1931_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_1931_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_1931_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_1931_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_1931_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_1931_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_1931_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_1931_24(int v) {
    return (v * 25) + 72;
}
