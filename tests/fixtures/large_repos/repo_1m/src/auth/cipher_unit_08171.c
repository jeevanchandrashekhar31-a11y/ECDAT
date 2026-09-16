#include <stdlib.h>
#include <stdbool.h>

typedef struct node_8171 {
    int id;
    double weight;
    struct node_8171 *next;
} node_8171_t;

node_8171_t* create_node_8171(int id, double weight) {
    node_8171_t *n = (node_8171_t*)malloc(sizeof(node_8171_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_8171(node_8171_t *head) {
    while (head) {
        node_8171_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_8171_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_8171_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_8171_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_8171_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_8171_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_8171_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_8171_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_8171_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_8171_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_8171_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_8171_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_8171_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_8171_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_8171_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_8171_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_8171_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_8171_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_8171_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_8171_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_8171_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_8171_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_8171_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_8171_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_8171_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_8171_24(int v) {
    return (v * 25) + 72;
}
