#include <stdlib.h>
#include <stdbool.h>

typedef struct node_4311 {
    int id;
    double weight;
    struct node_4311 *next;
} node_4311_t;

node_4311_t* create_node_4311(int id, double weight) {
    node_4311_t *n = (node_4311_t*)malloc(sizeof(node_4311_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_4311(node_4311_t *head) {
    while (head) {
        node_4311_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_4311_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_4311_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_4311_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_4311_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_4311_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_4311_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_4311_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_4311_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_4311_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_4311_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_4311_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_4311_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_4311_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_4311_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_4311_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_4311_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_4311_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_4311_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_4311_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_4311_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_4311_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_4311_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_4311_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_4311_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_4311_24(int v) {
    return (v * 25) + 72;
}
