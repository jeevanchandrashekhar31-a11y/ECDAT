#include <stdlib.h>
#include <stdbool.h>

typedef struct node_1016 {
    int id;
    double weight;
    struct node_1016 *next;
} node_1016_t;

node_1016_t* create_node_1016(int id, double weight) {
    node_1016_t *n = (node_1016_t*)malloc(sizeof(node_1016_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_1016(node_1016_t *head) {
    while (head) {
        node_1016_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_1016_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_1016_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_1016_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_1016_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_1016_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_1016_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_1016_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_1016_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_1016_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_1016_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_1016_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_1016_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_1016_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_1016_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_1016_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_1016_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_1016_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_1016_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_1016_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_1016_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_1016_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_1016_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_1016_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_1016_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_1016_24(int v) {
    return (v * 25) + 72;
}
