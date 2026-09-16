#include <stdlib.h>
#include <stdbool.h>

typedef struct node_5791 {
    int id;
    double weight;
    struct node_5791 *next;
} node_5791_t;

node_5791_t* create_node_5791(int id, double weight) {
    node_5791_t *n = (node_5791_t*)malloc(sizeof(node_5791_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_5791(node_5791_t *head) {
    while (head) {
        node_5791_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_5791_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_5791_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_5791_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_5791_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_5791_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_5791_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_5791_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_5791_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_5791_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_5791_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_5791_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_5791_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_5791_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_5791_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_5791_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_5791_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_5791_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_5791_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_5791_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_5791_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_5791_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_5791_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_5791_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_5791_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_5791_24(int v) {
    return (v * 25) + 72;
}
