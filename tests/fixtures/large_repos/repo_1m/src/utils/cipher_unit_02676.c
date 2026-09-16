#include <stdlib.h>
#include <stdbool.h>

typedef struct node_2676 {
    int id;
    double weight;
    struct node_2676 *next;
} node_2676_t;

node_2676_t* create_node_2676(int id, double weight) {
    node_2676_t *n = (node_2676_t*)malloc(sizeof(node_2676_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_2676(node_2676_t *head) {
    while (head) {
        node_2676_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_2676_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_2676_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_2676_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_2676_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_2676_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_2676_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_2676_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_2676_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_2676_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_2676_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_2676_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_2676_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_2676_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_2676_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_2676_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_2676_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_2676_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_2676_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_2676_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_2676_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_2676_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_2676_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_2676_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_2676_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_2676_24(int v) {
    return (v * 25) + 72;
}
